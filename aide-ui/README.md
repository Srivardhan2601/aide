# Aide: agent interface (UI only)

A clean, framework-free front end for a personal AI assistant. No backend: everything runs on mock data.

## Run it

Option A: double-click `index.html`.

Option B (recommended, avoids file:// quirks):

```bash
python -m http.server 5173 --directory aide-ui
```

Then open http://localhost:5173.

## Install on your phone

Serve it over http(s) (Option B, or any host), open it in Chrome or Safari, then use
"Add to Home screen" / "Install app". `manifest.webmanifest`, `sw.js` (offline fallback)
and `icons/` make this work. The app icon shows a badge with the number of replies waiting.

## Files

| File | What's inside |
|------|---------------|
| `index.html` | Page shell: sidebar, top bar, content area, toast region, command palette |
| `styles.css` | Design tokens (light + dark), layout, components, mobile breakpoints |
| `app.js` | State, rendering for each screen, actions, keyboard shortcuts |
| `mock-data.js` | **All** placeholder data. Each block names the endpoint it should come from |

## Plugging in a real backend

Search for `TODO(api)` in `app.js` and `mock-data.js`. Each one marks the exact spot where a fetch call goes
(e.g. `POST /api/approvals/:id/send`, `POST /api/agent/pause`, `POST /api/chat`).

## Shortcuts

- `Ctrl/⌘ + K`: command palette (navigate, pause agent, toggle theme, quick asks)
- `Enter`: send chat message, `Shift + Enter`: new line
- `Enter` / `Esc`: save or cancel an inline rule edit
