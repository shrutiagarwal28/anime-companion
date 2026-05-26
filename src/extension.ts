import * as vscode from "vscode";

// ------------------------------------------------------------
// Types mirroring the VS Code git extension's public API shape.
// We load the extension at runtime — these let TypeScript be
// happy without pulling in a separate @types/vscode-git package.
// ------------------------------------------------------------
interface GitRepository {
  state: {
    HEAD: { commit?: string; ahead?: number; behind?: number } | undefined;
    mergeChanges: unknown[];
    onDidChange: vscode.Event<void>;
  };
}

interface GitAPI {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
}

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

type CompanionEvent = "commit" | "push" | "conflict" | "idle";

// ------------------------------------------------------------
// CompanionViewProvider
// Implements the WebviewViewProvider contract so VS Code can
// mount our sidebar panel inside the Activity Bar container.
// ------------------------------------------------------------
class CompanionViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "animeCompanion.companionView";

  // Stored after resolveWebviewView so we can push messages later
  private _view: vscode.WebviewView | undefined;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  // Called once when the user first reveals the sidebar panel
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    // enableScripts: required for Live2D/PixiJS canvas rendering
    // localResourceRoots: empty because we load everything from CDN
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };

    webviewView.webview.html = this._buildHtml();
  }

  // Post a git event to the WebView so it can trigger the right motion
  postEvent(event: CompanionEvent): void {
    if (!this._view) {
      return;
    }
    this._view.webview.postMessage({ type: event });
  }

  private _buildHtml(): string {
    const modelUrl =
      vscode.workspace
        .getConfiguration("animeCompanion")
        .get<string>("modelUrl") ??
      "https://cdn.jsdelivr.net/gh/iCharlesZ/vscode-live2d-models/models/haru/haru_greeter_t03.model.json";

    // CSP: allow CDN scripts + unsafe-eval (needed by PixiJS shader compiler)
    // and unsafe-inline for the inline <script> block.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="
      default-src 'none';
      script-src https://cubism.live2d.com https://cdn.jsdelivr.net https://raw.githubusercontent.com 'unsafe-eval' 'unsafe-inline';
      style-src 'unsafe-inline';
      img-src https: data: blob:;
      connect-src https:;
      worker-src blob:;
    "
  />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      background: #1e1e2e;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    #status {
      color: #cba6f7;
      font-family: sans-serif;
      font-size: 11px;
      padding: 6px 0 4px;
      opacity: 0.8;
      letter-spacing: 0.04em;
      min-height: 22px;
    }
    #canvas {
      display: block;
      flex: 1;
      width: 100%;
    }
  </style>
</head>
<body>
  <div id="status">Loading model…</div>
  <canvas id="canvas"></canvas>

  <!--
    Load order matters — all four must be sequential:
    1. live2d.min.js      → Cubism 2 runtime (for .model.json models like Haru)
    2. live2dcubismcore   → Cubism 4 runtime (for .model3.json models)
    3. pixi.js            → WebGL renderer
    4. pixi-live2d-display→ bridges both runtimes into PIXI.live2d.Live2DModel
    pixi-live2d-display checks at init which runtimes are present globally;
    both must be registered before that script executes.
  -->
  <script src="https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js"></script>
  <script src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/pixi.js@6.5.2/dist/browser/pixi.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/index.min.js"></script>

  <script>
    (function () {
      'use strict';

      const MODEL_URL = ${JSON.stringify(modelUrl)};
      const statusEl = document.getElementById('status');

      function setStatus(msg) {
        statusEl.textContent = msg;
      }

      // Map VS Code git events → Live2D motion group names (Haru model defaults)
      const EVENT_MOTION_MAP = {
        commit:   'tap_body',
        push:     'flick_head',
        conflict: 'pinch_in',
        idle:     'idle',
      };

      // Verify the libraries loaded before doing anything
      if (typeof PIXI === 'undefined') {
        setStatus('Error: PixiJS failed to load. Check your internet connection.');
        return;
      }
      if (!PIXI.live2d) {
        setStatus('Error: pixi-live2d-display failed to load.');
        return;
      }

      const canvas = document.getElementById('canvas');

      function resizeApp() {
        if (!app) return;
        const w = window.innerWidth;
        const h = window.innerHeight - (statusEl.offsetHeight || 22);
        app.renderer.resize(w, h);
        repositionModel();
      }

      const app = new PIXI.Application({
        view: canvas,
        backgroundAlpha: 0,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
        width: window.innerWidth,
        height: window.innerHeight - 22,
      });

      window.addEventListener('resize', resizeApp);

      let model = null;

      function repositionModel() {
        if (!model || !app) return;
        const scale = Math.min(
          app.screen.width  / (model.internalModel?.originalWidth  || model.width  || 1),
          app.screen.height / (model.internalModel?.originalHeight || model.height || 1)
        ) * 0.92;
        model.scale.set(scale);
        model.x = (app.screen.width  - model.width)  / 2;
        model.y = (app.screen.height - model.height) / 2;
      }

      async function loadModel() {
        setStatus('Connecting to CDN…');
        try {
          setStatus('Loading model…');
          model = await PIXI.live2d.Live2DModel.from(MODEL_URL, {
            autoInteract: false,
          });

          app.stage.addChild(model);
          repositionModel();
          setStatus('Ready ✨');
          playMotion('idle');
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          setStatus('Failed: ' + msg.slice(0, 80));
          console.error('[AnimeCompanion] Load error:', err);
        }
      }

      function playMotion(group) {
        if (!model) return;
        try {
          model.motion(group, undefined, 2);
        } catch (err) {
          console.warn('[AnimeCompanion] Motion not found:', group, err);
        }
      }

      window.addEventListener('message', function (event) {
        const msg = event.data;
        if (!msg || !msg.type) return;
        const group = EVENT_MOTION_MAP[msg.type];
        if (!group) return;
        const labels = {
          commit:   'Committed! 💖',
          push:     'Pushed! 🚀',
          conflict: 'Merge conflict… 😣',
          idle:     'Waiting for you…',
        };
        setStatus(labels[msg.type] || '');
        playMotion(group);
      });

      loadModel();
    })();
  </script>
</body>
</html>`;
  }
}

// ------------------------------------------------------------
// Git event wiring
// ------------------------------------------------------------
function wireGitEvents(
  provider: CompanionViewProvider,
  context: vscode.ExtensionContext
): void {
  const gitExtension =
    vscode.extensions.getExtension<GitExtension>("vscode.git");

  if (!gitExtension) {
    // Git extension not present (unlikely but possible in minimal installs)
    return;
  }

  // The git extension may not be activated yet when our extension starts
  const activate = (): void => {
    const git = gitExtension.exports.getAPI(1);

    const wireRepo = (repo: GitRepository): void => {
      let lastCommit = repo.state.HEAD?.commit;
      let lastAhead = repo.state.HEAD?.ahead ?? 0;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;

      const resetIdle = (): void => {
        if (idleTimer) clearTimeout(idleTimer);
        // Fire idle if no git state change in 5 minutes
        idleTimer = setTimeout(() => provider.postEvent("idle"), 5 * 60 * 1000);
      };

      const disposable = repo.state.onDidChange(() => {
        const head = repo.state.HEAD;
        const currentCommit = head?.commit;
        const currentAhead = head?.ahead ?? 0;

        // Merge conflict takes highest priority
        if (repo.state.mergeChanges.length > 0) {
          provider.postEvent("conflict");
          resetIdle();
          return;
        }

        if (currentCommit !== lastCommit) {
          // If ahead count dropped to 0 while there was a previous ahead count,
          // a push just happened (local commits were pushed upstream).
          // Otherwise it's a new local commit.
          if (lastAhead > 0 && currentAhead === 0) {
            provider.postEvent("push");
          } else {
            provider.postEvent("commit");
          }

          lastCommit = currentCommit;
          lastAhead = currentAhead;
          resetIdle();
        } else if (currentAhead !== lastAhead) {
          // Ahead count changed without a commit hash change — push detected
          if (currentAhead < lastAhead) {
            provider.postEvent("push");
          }
          lastAhead = currentAhead;
          resetIdle();
        }
      });

      context.subscriptions.push(disposable);
      resetIdle();
    };

    // Wire repos already open when the extension activates
    git.repositories.forEach(wireRepo);

    // Wire repos opened later in the session
    const openDisposable = git.onDidOpenRepository(wireRepo);
    context.subscriptions.push(openDisposable);
  };

  if (gitExtension.isActive) {
    activate();
  } else {
    // Wait for the git extension to activate first
    const disposable = gitExtension.activate().then(activate);
    void disposable;
  }
}

// ------------------------------------------------------------
// Extension entry point
// ------------------------------------------------------------
export function activate(context: vscode.ExtensionContext): void {
  const provider = new CompanionViewProvider(context.extensionUri);

  // retainContextWhenHidden keeps the Live2D WebView alive when the
  // sidebar panel is switched away from — without it the canvas is
  // destroyed and the model reloads every time the user comes back.
  const registration = vscode.window.registerWebviewViewProvider(
    CompanionViewProvider.viewType,
    provider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  context.subscriptions.push(registration);

  wireGitEvents(provider, context);
}

export function deactivate(): void {
  // VS Code cleans up subscriptions automatically
}
