# Drafter

A tiny, single-page markdown editor where the **preview is the writing surface**. Every line renders as formatted markdown; click a line and it turns back into raw markdown to edit, with live inline styling as you type. No build step, no dependencies, no account — just one HTML file and a browser.

## Why

I wanted a nice, easy way to write *nice* markdown for longer blog posts — where the formatting is part of the writing experience, not a separate "preview pane" you toggle. The Notes app is too plain, and VS Code / typical markdown editors put the raw text and the rendered output in two different places. This keeps them in one place: you read what you'll publish, and you edit in place.

## Features

- **Inline live preview** — the whole document renders as formatted markdown. Click any line to edit just that line; the rest stay rendered.
- **Live styling while editing** — bold/italic/code/strike and `TODO`/`FIXME` flags style themselves as soon as you close the syntax, with the markdown symbols kept visible (dimmed).
- **Real markdown**: headings, ordered/unordered/task lists (with nesting + auto-renumbering), blockquotes, inline code, links, `---` rules.
- **Smart typography** (render-only, raw stays plain): curly quotes, apostrophes, en/em dashes, ellipsis — never touched inside code spans.
- **Lists that behave**: Enter continues the list, empty item exits, Tab/Shift-Tab indent, and `⌘⇧7` / `⌘⇧8` convert a sublist between numbered and bulleted (parent untouched).
- **Heading anchors**: hover a heading for a pilcrow that copies a `#slug` link and jumps to it.
- **TODO / FIXME counts** in the header — hover to see every occurrence and click to jump to it.
- **Multi-line editing**: shift-click or drag to select whole lines; `⌘C` / `⌘X` copy/cut, `⌫` delete, `⌘↑` / `⌘↓` move a line.
- **Undo / redo** with coalesced typing (`⌘Z` / `⌘⇧Z`).
- **Autosave** with a "saved · Nm ago" timestamp — to real files on disk when run as a server, to `localStorage` when opened as a plain file.
- **Sticky header** with a reading-progress bar.
- **Settings** (gear icon): toggle word count, flag counts, and progress bar; light/dark/auto theme; copy-all / clear.
- **Word count + reading time** (hover the count for characters + estimate).
- Serif reading font, warm paper palette, automatic dark mode.

## Run it

Two ways, and they differ in where your writing ends up.

**As a file** — one static page, no server, no install. Autosaves to
`localStorage`, which means **one document**, in **one browser**, with no backup.
Fine for a scratchpad; do not write anything you would miss.

```bash
open index.html
```

**As a server** — many documents, each a real `.md` file on disk, committed to
git after you stop writing.

```bash
./serve.py
```

Then open <http://localhost:8787>. No dependencies: python3 and the standard
library. Drafts go to `~/Documents/drafts` by default.

```bash
./serve.py --dir ~/writing     # somewhere else
./serve.py --idle 300          # commit 5 minutes after the last keystroke
./serve.py --port 9000
```

### What the server adds

- **Many drafts.** A switcher in the header; each draft is its own file, named
  from its title (`2026-08-19-on-keeping-a-notebook.md`). The single-document
  limit is the bug this exists to fix.
- **Debounced writes.** ~800ms after you stop typing, so a crash costs a
  sentence rather than a session. Writes are atomic — temp file then rename —
  because a half-written draft is worse than a slightly stale one.
- **Git, on its own.** If the drafts directory is a repo, the server commits 15
  minutes after writing stops, so **one commit is one sitting**. That log is the
  artifact: when each piece moved, how long it sat, which ones went cold.
- **Jekyll frontmatter.** Title and subtitle are written as `title:` and
  `description:`, so a finished draft moves into a Jekyll `_posts/` directory
  without being reformatted.

If the server is not running, the editor still works exactly as it did — it
falls back to `localStorage` and says so in the header rather than failing
quietly.

### The drafts are not in this repo

Drafter is public; your writing probably is not. Keep drafts in their own
directory with their own git history — `serve.py` refuses a `--dir` inside its
own checkout for exactly that reason.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Click a line | Edit that line |
| `↑` / `↓` | Move between lines |
| `⌘↑` / `⌘↓` | Move the current line up/down |
| `Enter` | New line (continues lists/quotes) |
| `Tab` / `⇧Tab` | Indent / outdent a list item |
| `⌘⇧7` / `⌘⇧8` | Sublist → numbered / bulleted |
| `⇧`-click or drag | Multi-select lines |
| `⌘C` / `⌘X` / `⌫` | Copy / cut / delete selected lines |
| `⌘Z` / `⌘⇧Z` | Undo / redo |
| `Esc` | Deselect |

## Structure

```
drafter/
├── index.html     # markup
├── css/style.css  # styles (theme tokens, layout)
├── js/app.js      # all logic (render, edit, shortcuts, autosave)
├── js/drafts.js   # the drafts store — talks to serve.py, falls back to localStorage
└── serve.py       # optional: serves the app, owns the files, commits them
```

Vanilla HTML/CSS/JS, no framework and no bundler. `serve.py` is python3 and the
standard library — the app runs without it.

## License

MIT
