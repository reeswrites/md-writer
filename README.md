# MD Writer

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
- **Autosave** to `localStorage` with a "saved · Nm ago" timestamp.
- **Sticky header** with a reading-progress bar.
- **Settings** (gear icon): toggle word count, flag counts, and progress bar; light/dark/auto theme; copy-all / clear.
- **Word count + reading time** (hover the count for characters + estimate).
- Serif reading font, warm paper palette, automatic dark mode.

## Run it

It's one static page — no install, no build.

```bash
git clone https://github.com/reeswrites/md-writer.git
cd md-writer
python3 -m http.server 8000
# open http://localhost:8000
```

Because it loads `css/` and `js/` as separate files, serve it over `http://` (any static server) rather than opening `index.html` straight from disk — some browsers block local file requests via `file://`.

Your document lives in your browser's `localStorage`; nothing is sent anywhere.

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
md-writer/
├── index.html    # markup
├── css/style.css # styles (theme tokens, layout)
└── js/app.js     # all logic (render, edit, shortcuts, autosave)
```

Vanilla HTML/CSS/JS. No framework, no bundler.

## License

MIT
