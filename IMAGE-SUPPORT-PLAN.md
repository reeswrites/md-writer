# Image Support — Plan (deferred)

Goal: paste/insert images into the markdown editor. Handle both remote URLs and pasted binary. Save pasted images to a folder when the browser allows, degrade gracefully when it doesn't.

## Current state
- `inline()` in `index.html` has **no image rule**. `![alt](url)` falls through to the link regex → renders stray `!` + a text link. Broken.
- Doc persists to `localStorage` (key `md-editor-doc`). ~5MB quota. Title + theme separate keys.

## Phase 1 — render syntax (cheap, do first)
- Add image rule to `inline()`, **before** the link rule (link regex would otherwise eat it):
  ```
  ![alt](url)  ->  <img src="url" alt="alt">
  ```
- Regex: `/!\[([^\]]*)\]\(([^)]+)\)/` → `<img>` with escaped attrs.
- CSS: `.rendered img { max-width:100%; border-radius:8px; display:block; margin:4px 0; }`
- Works for remote URLs + `data:` URIs immediately. No storage change.

## Phase 2 — paste to embed (data-URL, universal fallback)
- Listen `paste` on the active line textarea; if `clipboardData.files` has an image:
  - `FileReader.readAsDataURL` → insert `![pasted](data:image/png;base64,...)` at caret.
- **Guard:** data-URLs bloat localStorage fast. Before save, check total size; warn if > ~4MB, refuse embed if it would exceed quota (catch `QuotaExceededError` on `setItem`).
- Works in **all** browsers. Downside: big base64 blobs inline in the doc.

## Phase 3 — save to folder (Chromium only, best UX)
- Feature-detect `window.showDirectoryPicker`.
- First paste: `showDirectoryPicker()` → user grants a folder (e.g. `images/`).
  - Persist the `FileSystemDirectoryHandle` in **IndexedDB** (handles are structured-cloneable) so reload re-uses it; on reload call `handle.queryPermission({mode:'readwrite'})`, re-request if needed (needs user gesture).
- On paste: write `paste-<n>.png` via `dirHandle.getFileHandle(name,{create:true})` → `createWritable()` → `write(blob)` → `close()`.
- Insert relative `![](images/paste-<n>.png)`.
- **Path caveat:** relative path only resolves if html + `images/` sit in the same dir AND page served so relative URLs work. On `file://` Chrome mostly resolves sibling paths; not guaranteed. Robust path wants running from `localhost`.

## Degradation matrix
| Browser | Behavior |
|---|---|
| Chrome / Edge | Phase 3: pick folder → write file → relative `![](images/..)` |
| Safari / Firefox | Phase 2: embed `data:` URL (size-guarded), or trigger download to Downloads |
| any, remote img | Phase 1: `![alt](url)` renders directly |

## Decisions to make later
- Default when FS Access absent: embed data-URL vs auto-download? (embed = self-contained doc; download = smaller doc, manual file move)
- Serve from `localhost` to make relative paths reliable? (adds a run step vs current double-click file://)
- Cap embedded image size / auto-downscale before embed?

## Order of work
1. Phase 1 (render rule) — ships value alone, low risk.
2. Phase 2 (paste → data-URL + quota guard) — universal.
3. Phase 3 (FS Access folder) — Chromium enhancement on top.
