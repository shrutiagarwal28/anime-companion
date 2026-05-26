# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A VS Code extension that displays an animated companion in the sidebar (like vscode-pets). The companion reacts to user activity:
- **Typing** → plays an active/typing GIF
- **Idle (no typing for ~5 min)** → returns to idle GIF
- **Git commit or push** → plays a celebration/dance GIF

**Current implementation:** GIF-based animations using static files in `media/`. Live2D model support is the eventual upgrade path but is NOT the current goal — do not introduce Live2D complexity unless explicitly asked.

## Build Commands

```bash
npm run watch     # development: esbuild in watch mode with sourcemaps
npm run build     # production: esbuild with minification
```

To test the extension: press **F5** in VS Code — this opens an Extension Development Host window with the extension running.

To package for distribution (not in package.json — use npx):
```bash
npx @vscode/vsce package
```

No test runner or linter is configured.

## Architecture

The extension has two isolated processes that communicate via message passing:

1. **Extension Host** (`src/extension.ts`) — Node.js process. Registers the WebView panel, watches VS Code events (typing via `onDidChangeTextDocument`, git state via the built-in Git extension API), and sends messages to the WebView via `postMessage()`.

2. **WebView** — Browser context (sandboxed iframe). Receives messages and swaps the displayed GIF. All HTML/CSS/JS is inlined as a string in `_buildHtml()` — there is no separate HTML file.

Key constraints:
- The WebView runs in a sandboxed iframe — it cannot call VS Code APIs directly; all VS Code interaction must go through message passing.
- GIF files in `media/` are served via `webview.asWebviewUri()` — they cannot be referenced by file path directly.
- `retainContextWhenHidden: true` keeps the WebView alive when the user switches away from the sidebar panel.

## WebView Panel Setup

The companion is registered as a `WebviewViewProvider` (sidebar panel), not a `WebviewPanel` (floating editor). This is how vscode-pets achieves the side pane layout. The view is declared in `package.json` under `contributes.views` pointing to a named view container in `contributes.viewsContainers`.

## Event Sources

- **Typing detection:** `vscode.workspace.onDidChangeTextDocument` — fires on every keystroke in any editor.
- **Git events:** Accessed via `vscode.extensions.getExtension('vscode.git')` — uses the Git extension's exported API. Falls back gracefully if the Git extension is absent.
- **Idle reset:** A debounce timer (`setTimeout`) resets to idle after inactivity.

## GIF Behavior (current spec)

| State | GIF file | Trigger |
|-------|----------|---------|
| Idle | `media/idle.gif` | Default; returns after ~5 min of no typing |
| Typing | `media/action.gif` | Any `onDidChangeTextDocument` event |
| Celebrate | *(add `media/celebrate.gif`)* | Git commit or push detected |

The 5-minute idle timeout and the 4-second action-GIF duration are currently hard-coded in the WebView inline script.

## Gotchas

- **Motion names are model-specific** — relevant when Live2D is added later; ignore for GIF work.
- **First git `onDidChange` is intentionally skipped** — avoids treating the initial repository load as a new commit.
- **Large GIF files** — `idle.gif` (~9.8 MB) and `action.gif` (~12.1 MB) are committed to git. Keep new GIFs reasonably sized.
- **No linting or tests** — this is a solo learning project; don't add test infrastructure unless asked.
