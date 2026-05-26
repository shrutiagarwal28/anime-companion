# Anime Companion

An animated anime girl who lives in your VS Code sidebar and reacts to git events in real time.

Built with the VS Code WebView API and [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display). No external runtime dependencies — all rendering libraries are loaded from CDN inside the sidebar panel.

---

## Features

| Git event | What she does |
|---|---|
| **Commit** | Plays `tap_body` motion |
| **Push** | Plays `flick_head` motion |
| **Merge conflict** | Plays `pinch_in` motion |
| **Idle (5 min)** | Plays `idle` motion |

---

## Setup

### Development (run from source)

```bash
# 1. Install dev dependencies (esbuild + TS types only — no runtime deps)
npm install

# 2. Build the extension bundle
npm run build

# 3. Open this folder in VS Code
code .

# 4. Press F5 to launch an Extension Development Host window
#    The companion icon will appear in the Activity Bar.
```

### Install as VSIX

```bash
# Package with vsce
npx @vscode/vsce package

# Install the generated .vsix
code --install-extension anime-companion-0.1.0.vsix
```

---

## Changing the Model

Open VS Code Settings (`Cmd+,` / `Ctrl+,`) and search for **Anime Companion**.

Set `animeCompanion.modelUrl` to any Live2D `.model.json` or `.model3.json` URL. The extension reloads the model the next time the sidebar panel is opened.

### Available model URLs

| Character | URL |
|---|---|
| **Haru** (default) | `https://cdn.jsdelivr.net/gh/iCharlesZ/vscode-live2d-models/models/haru/haru_greeter_t03.model.json` |
| **Koharu** | `https://cdn.jsdelivr.net/gh/evrstr/live2d-widget-models/live2d_evrstr/koharu/model.json` |
| **Sagiri** | `https://cdn.jsdelivr.net/gh/evrstr/live2d-widget-models/live2d_evrstr/sagiri/model.json` |
| More models | Browse [iCharlesZ/vscode-live2d-models](https://github.com/iCharlesZ/vscode-live2d-models) on GitHub |

> **Note:** Not all models define the same motion group names (`tap_body`, `flick_head`, etc.). If a motion group is missing the extension silently ignores it — the model will still render and idle correctly.

---

## Architecture

```
src/
└── extension.ts          # activate(), CompanionViewProvider, git wiring

media/
└── icon.svg              # Activity Bar icon (chibi SVG)

dist/
└── extension.js          # esbuild bundle (generated, gitignored)
```

**Why inline HTML?** The WebView HTML, CSS, and JS are all returned as a string from `CompanionViewProvider._buildHtml()`. This avoids the complexity of `webview.asWebviewUri()` asset mapping in v1 and keeps the code easy to read and modify.

**Why `retainContextWhenHidden: true`?** Without it VS Code destroys the WebView when you switch sidebar tabs, so the Live2D model would have to reload every time you come back to the companion. With this flag the canvas stays alive for the entire session.

**Why `unsafe-eval` in the CSP?** PixiJS and the Live2D Cubism SDK compile GLSL shaders at runtime using `eval`-equivalent calls. This is unavoidable when loading these libraries from CDN without a custom build step.

---

## Tech Stack

- **VS Code Extension API** — sidebar WebviewViewProvider, git extension API
- **PixiJS 6.5.2** — WebGL renderer (via CDN)
- **pixi-live2d-display** — Live2D model loading & motion playback (via CDN)
- **Live2D Cubism Core** — official runtime (via CDN)
- **esbuild** — bundles `extension.ts` for the Node.js extension host
- **TypeScript** — strict mode throughout

---

## Watch Out For

**Motion group names are model-specific.** The default Haru model uses `tap_body`, `flick_head`, `pinch_in`, and `idle`. If you switch to a different model and the character stops reacting, open the browser DevTools inside the WebView (`Help → Toggle Developer Tools`) and check the console for `Motion not found` warnings — then look up the motion names in that model's `.model.json` file.

---

## Interview Angle

This extension demonstrates:
- **Event-driven architecture** — git state changes are observed via VS Code's git extension API and fanned out to the WebView over a message channel
- **Process isolation** — the extension host (Node.js) and the rendering canvas (WebView/browser) run in separate processes; `postMessage` is the only communication channel
- **Retained WebView state** — `retainContextWhenHidden` shows understanding of WebView lifecycle tradeoffs
- **CSP hardening** — every CDN origin is explicitly allowlisted; `unsafe-eval` is scoped only to script-src
