import * as vscode from "vscode";

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

type CompanionEvent = "typing" | "commit" | "push" | "conflict" | "idle";

class CompanionViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "animeCompanion.companionView";

  private _view: vscode.WebviewView | undefined;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    // localResourceRoots must include the media folder so the WebView
    // is permitted to load GIF files from disk via vscode-resource URIs.
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "media"),
      ],
    };

    webviewView.webview.html = this._buildHtml(webviewView.webview);
  }

  postEvent(event: CompanionEvent): void {
    if (!this._view) {
      return;
    }
    this._view.webview.postMessage({ type: event });
  }

  private _buildHtml(webview: vscode.Webview): string {
    // Convert disk paths to webview-safe URIs that the sandboxed iframe can load
    const idleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "idle.gif")
    );
    const actionUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "type-action.gif")
    );
    const celebrateUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "commit-action.gif")
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource}; script-src 'unsafe-inline'; style-src 'unsafe-inline';"
  />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      background: #1e1e2e;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    #companion {
      width: 100%;
      height: 100%;
      object-fit: contain;
      /* smooth crossfade between idle and action */
      transition: opacity 0.3s ease;
    }
  </style>
</head>
<body>
  <img id="companion" src="${idleUri}" alt="companion" />

  <script>
    const img       = document.getElementById('companion');
    const idleSrc     = ${JSON.stringify(idleUri.toString())};
    const actionSrc   = ${JSON.stringify(actionUri.toString())};
    const celebrateSrc = ${JSON.stringify(celebrateUri.toString())};

    let returnTimer = null;

    function playTyping() {
      img.src = actionSrc;
      clearTimeout(returnTimer);
      returnTimer = setTimeout(() => { img.src = idleSrc; }, 4000);
    }

    function playCelebrate() {
      img.src = celebrateSrc;
      clearTimeout(returnTimer);
      returnTimer = setTimeout(() => { img.src = idleSrc; }, 4000);
    }

    // Show current gif src in title for debugging
    function updateDebug() {
      document.title = img.src.includes('action') ? 'ACTION' : 'IDLE';
    }
    img.addEventListener('load', updateDebug);

    window.addEventListener('message', function (event) {
      const msg = event.data;
      console.log('[companion] message received', msg);
      if (!msg || !msg.type) return;

      if (msg.type === 'typing') {
        playTyping();
      }
      if (msg.type === 'commit' || msg.type === 'push') {
        playCelebrate();
      }
      if (msg.type === 'conflict' || msg.type === 'idle') {
        clearTimeout(returnTimer);
        img.src = idleSrc;
      }
    });
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
    return;
  }

  const activate = (): void => {
    const git = gitExtension.exports.getAPI(1);

    const wireRepo = (repo: GitRepository): void => {
      let lastCommit = repo.state.HEAD?.commit;
      let lastAhead = repo.state.HEAD?.ahead ?? 0;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      // The first onDidChange fires immediately on attachment to deliver
      // the current state — skip it so we don't treat the initial repo
      // state as a new commit event.
      let initialized = false;

      const resetIdle = (): void => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => provider.postEvent("idle"), 5 * 60 * 1000);
      };

      const disposable = repo.state.onDidChange(() => {
        if (!initialized) {
          initialized = true;
          lastCommit = repo.state.HEAD?.commit;
          lastAhead = repo.state.HEAD?.ahead ?? 0;
          resetIdle();
          return;
        }
        const head = repo.state.HEAD;
        const currentCommit = head?.commit;
        const currentAhead = head?.ahead ?? 0;

        if (repo.state.mergeChanges.length > 0) {
          provider.postEvent("conflict");
          resetIdle();
          return;
        }

        if (currentCommit !== lastCommit) {
          if (lastAhead > 0 && currentAhead === 0) {
            provider.postEvent("push");
          } else {
            provider.postEvent("commit");
          }
          lastCommit = currentCommit;
          lastAhead = currentAhead;
          resetIdle();
        } else if (currentAhead !== lastAhead) {
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

    git.repositories.forEach(wireRepo);

    const openDisposable = git.onDidOpenRepository(wireRepo);
    context.subscriptions.push(openDisposable);
  };

  if (gitExtension.isActive) {
    activate();
  } else {
    void gitExtension.activate().then(activate);
  }
}

// ------------------------------------------------------------
// Extension entry point
// ------------------------------------------------------------
export function activate(context: vscode.ExtensionContext): void {
  const provider = new CompanionViewProvider(context.extensionUri);

  const registration = vscode.window.registerWebviewViewProvider(
    CompanionViewProvider.viewType,
    provider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  context.subscriptions.push(registration);

  // Debounce typing: play action GIF on keystroke, return to idle after 4s of silence
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  const typingDisposable = vscode.workspace.onDidChangeTextDocument(() => {
    provider.postEvent("typing");
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => provider.postEvent("idle"), 4000);
  });
  context.subscriptions.push(typingDisposable);

  wireGitEvents(provider, context);
}

export function deactivate(): void {}
