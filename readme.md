# Theorymaker

Theorymaker is a **single-page** HTML/JS app that turns a simple text DSL (**MapScript**) into a diagram.

- **Editor**: Ace editor (plus optional AI chat)
- **Diagram**: Graphviz **WASM** renders MapScript → DOT → SVG
- **Templates**: built-in examples + maps saved in this browser (LocalStorage)
- **Share/restore**: the URL hash continuously stores the current MapScript (`#m=...`)

This repo is designed to be **no-build** and easy to host as static files (Netlify).

## Repo structure

- `index.html`: app shell + UI
- `app.js`: main logic (MapScript parsing, rendering, UI, URL sync, templates, admin mode, etc.)
- `styles.css`: styling (Bootstrap + small custom CSS)
- `examples.js`: built-in Templates → Examples (`GALLERY_EXAMPLES`)
- `help.md`: help content (rendered into the Help tab and the standalone `/help` pages)
- `help/`: standalone help pages (they load `help.md`)
- `netlify/functions/chat.js`: Netlify Function proxy for AI chat (keeps API key server-side)

## Interaction model (quick)

- **Styling**: click nodes / links / group boxes in the diagram to open the drawer and edit styling.
- **Structure** (grouping / moving / linking): use the **checkbox selection** UI on nodes:
  - With 1+ nodes selected: click a **node** to create link(s) (direction + label/style are set in the Selection drawer).
  - With 1+ nodes selected: click a **group box** to move the selection into that group.
  - With 1+ nodes selected: click the **diagram background** to move the selection out of groups.

## MapScript (very short)

MapScript is “mostly free text” with a few key line types:

- **Settings lines**: `Key: Value` (e.g. `Background: aliceblue`)
- **Title / Description**:
  - `Title: ...` sets the diagram title (supports optional title-only styling in brackets, e.g. `Title: My title [text colour=dimgray | text size=22]`).
  - `Description: ...` is shown under the diagram and used as the short description overlay in Templates thumbnails.
- **Nodes**: `ID:: Label`
- **Links**: `A -> B` (supports `|` for multi-links, and optional `[...]` styling)
- **Groups**: lines starting with `--` / `----` to open/close grouping boxes
- **Comments**: `#` starts a comment

Important: because `#` starts comments, **hex colours** like `#ff0000` are not supported in MapScript. Use named colours or `rgb(r,g,b)`.

Supported settings (the ones the app recognises) include:

- `Background`, `Text colour`
- `Default node colour`, `Default node border`, `Default node shape`, `Default node shadow`, `Default node text colour`
- `Default group text colour`
- `Default link colour`, `Default link style`, `Default link width`
- `Direction`, `Label wrap`, `Spacing along`, `Spacing across`
- `Title size`, `Title position`

## URL sharing / undo / redo

- The app continuously stores the current MapScript in the URL hash as `#m=<base64url(utf8)>`.
- Undo/redo uses browser History entries (Back/Forward) and the buttons in the navbar.

## Saving maps (Templates → Saved in this browser)

- Click the **Save** (floppy) button to save the current map into **LocalStorage** under a name.
- Saved maps appear in **Templates → Saved in this browser** (with a thumbnail if possible).
- Saved maps can be deleted from Templates (browser-only).

## Admin mode (local dev only)

When running on `http://localhost/...` or `http://127.0.0.1/...` you are treated as **admin**:

- **Save** shows a modal with:
  - **Save to this browser** (LocalStorage)
  - **Copy standard example snippet** (paste into `GALLERY_EXAMPLES` in `examples.js`)
- Templates shows an admin-only **Rebuild thumbnails** button.
- Help shows an admin-only **admin** subtab.
- Chat uses **direct Dify API** and will prompt for a Dify App API key (stored in this browser only as `localStorage["tm_dify_api_key"]`).

In production (Netlify), chat calls `/.netlify/functions/chat` and the API key is stored in Netlify environment variables (`DIFY_API_KEY`).

## License

CC BY‑NC 4.0 (see `LICENSE`).

## Git hooks (Windows)

This repo keeps Git hooks in `.githooks/`. Enable them once per clone:

```powershell
git config core.hooksPath .githooks
```


