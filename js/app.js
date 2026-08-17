const KEY = "md-editor-doc";
const THEME_KEY = "md-editor-theme";
const TITLE_KEY = "md-editor-title";
const TIME_KEY = "md-editor-saved-at";
const SETTINGS_KEY = "md-writer-settings";
const editor = document.getElementById("editor");
const statusEl = document.getElementById("status");
const titleEl = document.getElementById("title");

const seed = `# Welcome
A tiny markdown editor. Click a line to edit it — the rest stay **rendered**.

## Try it
- Lists render with a nice bullet
- [x] Task boxes work
- [ ] Unchecked too

> Blockquotes get an accent bar.

Inline \`code\`, **bold**, *italic*, ~~strike~~, and [links](https://example.com).

---
Everything saves to localStorage automatically.`;

let lines = load();
let active = -1;
let sel = null;      // {a, b} inclusive range, or null
let anchor = -1;     // last clicked line index for shift-range

function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
function lsSet(k,v){ try { localStorage.setItem(k,v); } catch(e){} }
function lsDel(k){ try { localStorage.removeItem(k); } catch(e){} }

function load() {
  const raw = lsGet(KEY);
  if (raw !== null) return raw.split("\n");
  return seed.split("\n");
}
function save() {
  lsSet(KEY, lines.join("\n"));
  flashSaved();
  histDebounced();
}

// autosave timestamp
let lastSavedAt = parseInt(lsGet(TIME_KEY), 10) || null;
function relTime(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}
function savedLabel() {
  return lastSavedAt ? "saved · " + relTime(lastSavedAt) : "saved";
}

let saveTimer;
function flashSaved() {
  lastSavedAt = Date.now();
  lsSet(TIME_KEY, String(lastSavedAt));
  statusEl.dataset.tip = "Last saved " + new Date(lastSavedAt).toLocaleTimeString();
  statusEl.textContent = "saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (!sel) statusEl.textContent = savedLabel(); }, 400);
}
// keep the relative time fresh
setInterval(() => {
  if (!sel && statusEl.textContent !== "saving…") statusEl.textContent = savedLabel();
}, 15000);

/* ---- undo / redo ---- */
const HIST_MAX = 300;
let history = [{ doc: lines.join("\n"), active: -1 }];
let hidx = 0;
let histTimer = null;
let restoring = false;

function histSnapshot() { return { doc: lines.join("\n"), active }; }

function histCommit() {
  clearTimeout(histTimer); histTimer = null;
  const snap = histSnapshot();
  if (history[hidx] && history[hidx].doc === snap.doc) return;
  history = history.slice(0, hidx + 1);   // drop redo branch
  history.push(snap);
  if (history.length > HIST_MAX) history.shift();
  hidx = history.length - 1;
}

// coalesce rapid typing into one undo step
function histDebounced() {
  if (restoring) return;
  clearTimeout(histTimer);
  histTimer = setTimeout(histCommit, 350);
}

function histRestore(snap) {
  restoring = true;
  lines = snap.doc.split("\n");
  if (lines.length === 0) lines = [""];
  active = (snap.active != null && snap.active < lines.length) ? snap.active : -1;
  sel = null; anchor = active;
  caretPos = active >= 0 ? (lines[active] || "").length : null;
  lsSet(KEY, lines.join("\n"));
  flashSaved();
  build();
  restoring = false;
}

function undo() {
  if (histTimer) histCommit();          // flush pending typing first
  if (hidx <= 0) return;
  hidx--;
  histRestore(history[hidx]);
}

function redo() {
  if (histTimer) histCommit();
  if (hidx >= history.length - 1) return;
  hidx++;
  histRestore(history[hidx]);
}

/* ---- inline markdown ---- */
function esc(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// Render-only smart quotes. Operates on the built HTML string; leaves the raw
// text (edit line + saved file) untouched. Skips HTML tags and <code> spans.
function curlText(t, prevChar) {
  let x = (prevChar || " ") + t;                       // sentinel gives context at run start
  x = x.replace(/---/g, "—").replace(/--/g, "–");   // em / en dash
  x = x.replace(/\.\.\./g, "…");                       // ellipsis
  x = x.replace(/(^|[\s([{‘“])"/g, "$1“"); // opening double
  x = x.replace(/"/g, "”");                          // remaining double -> closing
  x = x.replace(/(^|[\s([{‘“])'/g, "$1‘"); // opening single
  x = x.replace(/'/g, "’");                          // remaining single -> closing / apostrophe
  return x.slice(1);
}
function smartQuotes(s) {
  let out = "", i = 0;
  while (i < s.length) {
    if (s.startsWith("<code", i)) {                    // pass <code>...</code> through verbatim
      const end = s.indexOf("</code>", i);
      const stop = end < 0 ? s.length : end + 7;
      out += s.slice(i, stop); i = stop; continue;
    }
    if (s[i] === "<") {                                 // pass any tag through verbatim
      const end = s.indexOf(">", i);
      const stop = end < 0 ? s.length : end + 1;
      out += s.slice(i, stop); i = stop; continue;
    }
    let j = i; while (j < s.length && s[j] !== "<") j++; // a run of plain text
    out += curlText(s.slice(i, j), out.slice(-1));
    i = j;
  }
  return out;
}
function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (_,c)=>`<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // underscore bold/italic: allow mid-word, but skip identifier-like _x_ that is
  // flanked by word chars on BOTH sides (e.g. snake_case_var).
  const usGuard = (m, b, inner, a) =>
    (b === "_" || (/\w/.test(b) && /\w/.test(a))) ? m : b;
  t = t.replace(/(^|[\s\S])__([^_]+)__(?=([\s\S]?))/g,
    (m, b, inner, a) => { const k = usGuard(m, b, inner, a); return k === m ? m : k + `<strong>${inner}</strong>`; });
  t = t.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
  t = t.replace(/(^|[\s\S])_([^_]+)_(?=([\s\S]?))/g,
    (m, b, inner, a) => { const k = usGuard(m, b, inner, a); return k === m ? m : k + `<em>${inner}</em>`; });
  t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  t = t.replace(/\b(TODO|TOFIX|FIXME|FIX|XXX|HACK|NOTE|WIP|BUG)\b/g, '<mark class="flag">$1</mark>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_,txt,url)=>`<a href="${esc(url)}" target="_blank" rel="noopener">${txt}</a>`);
  t = smartQuotes(t);
  return t;
}

/* Compute display numbers for ordered-list lines: sequential within an indent
   level, reset by a nested sublist, a shallower item, or a break (blank/paragraph). */
function computeOrderedNumbers(ls) {
  const res = {}, counters = {};
  const clearDeeper = (lvl) => { for (const k of Object.keys(counters)) if (+k > lvl) delete counters[k]; };
  const clearAll = () => { for (const k of Object.keys(counters)) delete counters[k]; };
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i]; let m;
    if (line.trim() === "") { clearAll(); }
    else if ((m = line.match(/^(\s*)\d+\.\s+/))) {
      const lvl = m[1].length;
      counters[lvl] = (counters[lvl] || 0) + 1;
      clearDeeper(lvl);
      res[i] = counters[lvl];
    } else if ((m = line.match(/^(\s*)[-*]\s+/))) {
      const lvl = m[1].length;
      clearDeeper(lvl); delete counters[lvl];   // bullet breaks any numbered run at its level
    } else { clearAll(); }                       // paragraph/heading breaks the list
  }
  return res;
}

// two-tailed pilcrow, bold strokes; inherits color via currentColor
const PILCROW_SVG = '<svg viewBox="0 0 14 20" fill="currentColor" aria-hidden="true">' +
  '<rect x="8.4" y="2" width="2.7" height="16" rx="0.4"/>' +
  '<rect x="4.5" y="9.8" width="2.4" height="8.2" rx="0.4"/>' +
  '<path d="M9.6 2 H6 a4 4 0 0 0 0 8 H7 V2 Z"/>' +
  '</svg>';

// heading slugs for anchor ids, made unique per render pass
let headingSlugs = {};
function slugify(s) {
  const base = s.toLowerCase().replace(/[`*_~]/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "section";
  let slug = base, n = 1;
  while (headingSlugs[slug]) slug = base + "-" + (++n);
  headingSlugs[slug] = true;
  return slug;
}

/* ---- block render for one line ---- */
function renderLine(text, orderedNum) {
  const div = document.createElement("div");
  div.className = "rendered";
  const raw = text;

  if (raw.trim() === "") { div.classList.add("empty"); return div; }

  let m;
  if ((m = raw.match(/^(#{1,3})\s+(.*)$/))) {
    div.classList.add("heading");
    const h = document.createElement("h" + m[1].length);
    h.id = slugify(m[2]);
    h.innerHTML = inline(m[2]);
    const a = document.createElement("a");
    a.className = "heading-anchor";
    a.href = "#" + h.id;
    a.innerHTML = PILCROW_SVG;
    a.title = "Copy link to this section";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (history.replaceState) {
        history.replaceState(null, "", "#" + h.id);
        h.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        location.hash = h.id;
      }
      try { navigator.clipboard.writeText(location.href); } catch (_) {}
      a.classList.add("copied");
      setTimeout(() => a.classList.remove("copied"), 1000);
    });
    div.appendChild(a);
    div.appendChild(h);
    return div;
  }
  if (/^\s*(---|\*\*\*|___)\s*$/.test(raw)) {
    div.innerHTML = "<hr-mark></hr-mark>"; return div;
  }
  if ((m = raw.match(/^>\s?(.*)$/))) {
    div.classList.add("bq");
    const bq = document.createElement("blockquote");
    bq.innerHTML = inline(m[1]); div.appendChild(bq); return div;
  }
  if ((m = raw.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/))) {
    div.classList.add("li", "task");
    const done = m[2].toLowerCase() === "x";
    div.innerHTML = `<span class="mk chk">${done ? "☑" : "☐"}</span><span class="ct" style="${done?'color:var(--muted);text-decoration:line-through':''}">${inline(m[3])}</span>`;
    div.style.paddingLeft = (20 + m[1].length * 12) + "px";
    return div;
  }
  if ((m = raw.match(/^(\s*)[-*]\s+(.*)$/))) {
    div.classList.add("li");
    div.innerHTML = `<span class="mk bullet">•</span><span class="ct">${inline(m[2])}</span>`;
    div.style.paddingLeft = (20 + m[1].length * 12) + "px";
    return div;
  }
  if ((m = raw.match(/^(\s*)(\d+)\.\s+(.*)$/))) {
    div.classList.add("li");
    const n = orderedNum != null ? orderedNum : m[2];
    div.innerHTML = `<span class="mk num">${n}.</span><span class="ct">${inline(m[3])}</span>`;
    div.style.paddingLeft = (20 + m[1].length * 12) + "px";
    return div;
  }
  div.innerHTML = inline(raw);
  return div;
}

// Width of one space in the editor's body font (serif 17px), measured once.
let _spaceW = null;
function spaceWidth() {
  if (_spaceW != null) return _spaceW;
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font-family:var(--serif);font-size:17px";
  probe.textContent = " ".repeat(100);
  document.body.appendChild(probe);
  _spaceW = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return _spaceW;
}

// ---- active line: live-styled contenteditable ----
// Renders bold/italic/strike/code styling while KEEPING the markdown symbols
// visible (dimmed). Escapes HTML; leaves lists/links/quotes as raw text.
function sym(s) { return `<span class="sym">${s}</span>`; }
function activeInline(s) {
  if (s === "") return "";
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${sym("`")}${c}${sym("`")}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${sym("**")}${c}${sym("**")}</strong>`);
  t = t.replace(/(^|[\s\S])__([^_]+)__(?=([\s\S]?))/g,
    (m, b, inner, a) => (b === "_" || (/\w/.test(b) && /\w/.test(a))) ? m : `${b}<strong>${sym("__")}${inner}${sym("__")}</strong>`);
  t = t.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, (_, b, c) => `${b}<em>${sym("*")}${c}${sym("*")}</em>`);
  t = t.replace(/(^|[\s\S])_([^_]+)_(?=([\s\S]?))/g,
    (m, b, inner, a) => (b === "_" || (/\w/.test(b) && /\w/.test(a))) ? m : `${b}<em>${sym("_")}${inner}${sym("_")}</em>`);
  t = t.replace(/~~([^~]+)~~/g, (_, c) => `<del>${sym("~~")}${c}${sym("~~")}</del>`);
  t = t.replace(/\b(TODO|TOFIX|FIXME|FIX|XXX|HACK|NOTE|WIP|BUG)\b/g, '<mark class="flag">$1</mark>');
  return t;
}

// caret as a character offset within a contenteditable element
function ceCaret(el, which) {
  const s = window.getSelection();
  if (!s.rangeCount) return el.textContent.length;
  const r = s.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(el);
  if (which === "end") pre.setEnd(r.endContainer, r.endOffset);
  else pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}
function ceSetCaret(el, pos) {
  el.focus();
  const len = el.textContent.length;
  pos = Math.max(0, Math.min(pos == null ? len : pos, len));
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node, acc = 0, target = null, off = 0;
  while ((node = walker.nextNode())) {
    const l = node.textContent.length;
    if (acc + l >= pos) { target = node; off = pos - acc; break; }
    acc += l;
  }
  const r = document.createRange();
  if (target) r.setStart(target, off);
  else { r.selectNodeContents(el); r.collapse(false); }
  r.collapse(true);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

/* ---- build DOM ---- */
function build() {
  editor.innerHTML = "";
  headingSlugs = {};
  const inSel = (i) => sel && i >= Math.min(sel.a, sel.b) && i <= Math.max(sel.a, sel.b);
  const onums = computeOrderedNumbers(lines);

  lines.forEach((text, i) => {
    const line = document.createElement("div");
    const selected = inSel(i);
    line.className = "line" + (i === active ? " active" : "") + (selected ? " selected" : "");
    line.dataset.i = i;

    if (i === active) {
      const inp = document.createElement("div");
      inp.className = "line-input";
      inp.contentEditable = "true";
      inp.spellcheck = true;
      inp.innerHTML = activeInline(text);
      inp.addEventListener("input", onInput);
      inp.addEventListener("keydown", onKey);
      inp.addEventListener("paste", onPaste);
      // align the raw edit line with the rendered indent: render puts the marker at
      // base 20px + 12px/level; the raw line already shows the literal spaces, so pad
      // by the shortfall (12px minus the actual rendered width of one space).
      const im = text.match(/^(\s*)([-*]\s+|\d+\.\s+)/);
      if (im) inp.style.paddingLeft = (20 + im[1].length * Math.max(0, 12 - spaceWidth())) + "px";
      line.appendChild(inp);
    } else if (selected) {
      const raw = document.createElement("div");
      raw.className = "raw" + (text === "" ? " empty" : "");
      raw.textContent = text;
      line.appendChild(raw);
      line.addEventListener("click", (e) => onLineClick(e, i));
    } else {
      line.appendChild(renderLine(text, onums[i]));
      line.addEventListener("click", (e) => onLineClick(e, i));
    }
    editor.appendChild(line);
  });

  updateStatus();
  updateWordCount();

  if (active >= 0) {
    const inp = editor.querySelector(".line-input");
    if (inp) placeCaret(inp);
  }
}

const FLAG_RE = /\b(TODO|TOFIX|FIXME|FIX|XXX|HACK|NOTE|WIP|BUG)\b/g;
function updateWordCount() {
  const text = lines.join(" ");
  const words = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  document.getElementById("wc").textContent = words.toLocaleString() + (words === 1 ? " word" : " words");
  const chars = lines.join("\n").length;
  const mins = Math.max(1, Math.round(words / 200));
  document.getElementById("wc").dataset.tip = chars.toLocaleString() + " characters · ~" + mins + " min read";

  // TODO/FIXME etc. — counts + per-occurrence jump list
  const counts = {}, occ = [];
  lines.forEach((line, i) => {
    let m; FLAG_RE.lastIndex = 0;
    while ((m = FLAG_RE.exec(line))) {
      counts[m[1]] = (counts[m[1]] || 0) + 1;
      occ.push({ tag: m[1], line: i, text: line.replace(/^[#>\s*\-\d.]+/, "").slice(0, 60) || line.slice(0, 60) });
    }
  });
  document.getElementById("flagcount").textContent =
    Object.keys(counts).map((k) => counts[k] + " " + k).join("  ·  ");

  const jump = document.getElementById("flagJump");
  jump.innerHTML = "";
  occ.forEach((o) => {
    const row = document.createElement("div");
    row.className = "flag-jump-row";
    row.innerHTML = `<span class="fj-tag">${o.tag}</span><span class="fj-text"></span>`;
    row.querySelector(".fj-text").textContent = o.text;
    row.addEventListener("click", () => jumpToLine(o.line));
    jump.appendChild(row);
  });
}

function jumpToLine(i) {
  document.getElementById("flagJump").style.display = "none";
  setTimeout(() => (document.getElementById("flagJump").style.display = ""), 300);
  active = -1; sel = null; build();
  const el = editor.children[i];
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1200);
}

function onLineClick(e, i) {
  if (justDragged) { justDragged = false; return; }
  if (e.shiftKey) {
    e.preventDefault();
    const a = anchor >= 0 ? anchor : (active >= 0 ? active : i);
    active = -1;
    sel = { a, b: i };
    build();
  } else {
    setActive(i);
  }
}

// ---- drag across lines to multi-select ----
let dragDown = false, dragAnchor = -1, dragging = false, justDragged = false, lastDragIdx = -1;
editor.addEventListener("mousedown", (e) => {
  justDragged = false;                 // a fresh press clears any stale drag-suppress
  const lineEl = e.target.closest(".line");
  if (!lineEl || lineEl.classList.contains("active") || e.shiftKey) return;
  if (e.target.closest(".heading-anchor")) return;
  dragDown = true; dragAnchor = +lineEl.dataset.i; dragging = false; lastDragIdx = dragAnchor;
});
document.addEventListener("mousemove", (e) => {
  if (!dragDown) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const lineEl = el && el.closest ? el.closest(".line") : null;
  if (!lineEl || lineEl.dataset.i == null) return;
  const i = +lineEl.dataset.i;
  if (i === dragAnchor && !dragging) return;   // within start line -> leave native text selection alone
  if (i === lastDragIdx && dragging) return;   // no range change
  dragging = true; lastDragIdx = i;
  window.getSelection().removeAllRanges();      // drop any native selection
  active = -1; anchor = dragAnchor; sel = { a: dragAnchor, b: i };
  build();
});
document.addEventListener("mouseup", () => {
  if (dragging) justDragged = true;             // suppress the click that follows a drag
  dragDown = false; dragAnchor = -1; dragging = false; lastDragIdx = -1;
});

function updateStatus() {
  if (sel) {
    const n = Math.abs(sel.a - sel.b) + 1;
    statusEl.textContent = n + " selected · ⌘C copy · ⌫ delete";
  } else if (statusEl.textContent !== "saving…") {
    statusEl.textContent = savedLabel();
  }
}

let caretPos = null;
function placeCaret(inp) {
  ceSetCaret(inp, caretPos);
  caretPos = null;
}

function setActive(i) {
  active = i;
  anchor = i;
  sel = null;
  caretPos = null;
  build();
}

function deleteSelection() {
  if (!sel) return;
  histCommit();
  const lo = Math.min(sel.a, sel.b), hi = Math.max(sel.a, sel.b);
  lines.splice(lo, hi - lo + 1);
  if (lines.length === 0) lines = [""];
  sel = null; active = -1; anchor = -1;
  save(); build();
}

// paste plain text; multi-line paste splits into proper lines
function onPaste(e) {
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  e.preventDefault();
  if (text === "") return;
  const el = e.currentTarget;
  const val = el.textContent;
  const start = ceCaret(el, "start");
  const end = ceCaret(el, "end");
  const before = val.slice(0, start);
  const after = val.slice(end);
  const parts = text.replace(/\r\n?/g, "\n").split("\n");
  histCommit();
  if (parts.length === 1) {
    lines[active] = before + parts[0] + after;
    caretPos = (before + parts[0]).length;
  } else {
    parts[0] = before + parts[0];
    const last = parts.length - 1;
    caretPos = parts[last].length;          // caret at end of pasted content
    parts[last] = parts[last] + after;
    lines.splice(active, 1, ...parts);
    active = active + last;
  }
  save(); build();
}

function onInput(e) {
  const el = e.currentTarget;
  const pos = ceCaret(el);
  const text = el.textContent;
  lines[active] = text;
  save();
  updateWordCount();
  // re-render live styling, keep the caret where it was
  const html = activeInline(text);
  if (el.innerHTML !== html) {
    el.innerHTML = html;
    ceSetCaret(el, pos);
  }
}

function listContinuation(line) {
  let m;
  if ((m = line.match(/^(\s*)([-*])\s+\[[ xX]\]\s+(.*)$/))) {
    return { next: `${m[1]}${m[2]} [ ] `, empty: m[3].trim() === "" };
  }
  if ((m = line.match(/^(\s*)([-*])\s+(.*)$/))) {
    return { next: `${m[1]}${m[2]} `, empty: m[3].trim() === "" };
  }
  if ((m = line.match(/^(\s*)(\d+)\.\s+(.*)$/))) {
    return { next: `${m[1]}${parseInt(m[2], 10) + 1}. `, empty: m[3].trim() === "" };
  }
  if ((m = line.match(/^(\s*)>\s?(.*)$/))) {
    return { next: `${m[1]}> `, empty: m[2].trim() === "" };
  }
  return null;
}

// Convert the current sublist (contiguous siblings at the active line's indent
// level) to bullets or numbers. Parent list and deeper children are untouched.
function setListType(target, caret) {
  if (active < 0) return;
  const listRe = /^(\s*)([-*]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)(.*)$/;
  const cur = lines[active].match(listRe);
  if (!cur) return;                       // not a list item
  const L = cur[1].length;
  const indentOf = (s) => (s.match(/^\s*/)[0]).length;
  const isList = (s) => listRe.test(s);
  let lo = active, hi = active;
  while (lo - 1 >= 0 && isList(lines[lo - 1]) && indentOf(lines[lo - 1]) >= L) lo--;
  while (hi + 1 < lines.length && isList(lines[hi + 1]) && indentOf(lines[hi + 1]) >= L) hi++;
  const oldMarkerLen = cur[2].length;
  histCommit();
  let n = 0;
  for (let i = lo; i <= hi; i++) {
    const m = lines[i].match(listRe);
    if (!m || m[1].length !== L) continue;   // only siblings at this level
    lines[i] = m[1] + (target === "bullet" ? "- " : (++n) + ". ") + m[3];
  }
  const newMarkerLen = (lines[active].match(listRe) || [,,""])[2].length;
  caretPos = Math.max(0, caret + (newMarkerLen - oldMarkerLen));
  save(); build();
}

function onKey(e) {
  const inp = e.currentTarget;
  const val = inp.textContent;
  const selStart = ceCaret(inp, "start");
  const selEnd = ceCaret(inp, "end");
  const atStart = selStart === 0 && selEnd === 0;
  const atEnd = selStart === val.length && selEnd === val.length;

  // stop the browser's own rich-text shortcuts from injecting <b>/<i>/<u>
  if ((e.metaKey || e.ctrlKey) && /^[biu]$/i.test(e.key)) { e.preventDefault(); return; }
  // ⌘⇧8 -> bullets, ⌘⇧7 -> numbered (converts the current sublist)
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "Digit8") { e.preventDefault(); setListType("bullet", selStart); return; }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "Digit7") { e.preventDefault(); setListType("number", selStart); return; }

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    histCommit();
    const pos = selStart;
    const cont = listContinuation(val);
    if (cont) {
      if (cont.empty) {
        // Enter on an empty list item -> exit the list
        lines[active] = "";
        caretPos = 0;
        save(); build();
        return;
      }
      // Split at caret; the current line keeps its own marker, the new line
      // gets a fresh same-level marker. Works from start, middle, or end.
      const pm = val.match(/^(\s*)([-*]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|>\s?)/);
      const markerLen = pm ? pm[0].length : 0;
      const curPrefix = val.slice(0, markerLen);
      const content = val.slice(markerLen);
      const cIdx = Math.max(0, pos - markerLen);
      lines[active] = curPrefix + content.slice(0, cIdx);
      lines.splice(active + 1, 0, cont.next + content.slice(cIdx));
      active += 1;
      caretPos = cont.next.length;
      save(); build();
      return;
    }
    // non-list line: plain split at caret
    lines[active] = val.slice(0, pos);
    lines.splice(active + 1, 0, val.slice(pos));
    active += 1;
    caretPos = 0;
    save(); build();
  } else if (e.key === "Backspace" && (listContinuation(val) || {}).empty) {
    // Backspace on an empty marker line (blockquote or list) -> drop the marker
    e.preventDefault();
    histCommit();
    lines[active] = "";
    caretPos = 0;
    save(); build();
  } else if (e.key === "Backspace" && atStart && active > 0) {
    e.preventDefault();
    histCommit();
    const prevLen = lines[active - 1].length;
    lines[active - 1] += lines[active];
    lines.splice(active, 1);
    active -= 1;
    caretPos = prevLen;
    save(); build();
  } else if (e.key === "Tab") {
    e.preventDefault();
    if (!/^\s*([-*]\s+|\d+\.\s+)/.test(val)) return;
    histCommit();
    const unit = "  ";
    const cur = lines[active];
    if (e.shiftKey) {
      if (!cur.startsWith(unit)) return;
      lines[active] = cur.slice(unit.length);
      caretPos = Math.max(0, selStart - unit.length);
    } else {
      lines[active] = unit + cur;
      caretPos = selStart + unit.length;
    }
    save(); build();
  } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && (e.metaKey || e.altKey)) {
    // move the current line up/down
    e.preventDefault();
    const j = active + (e.key === "ArrowUp" ? -1 : 1);
    if (j < 0 || j >= lines.length) return;
    histCommit();
    lines[active] = val;
    [lines[active], lines[j]] = [lines[j], lines[active]];
    active = j;
    caretPos = selStart;
    save(); build();
  } else if (e.key === "ArrowUp") {
    if (active > 0) { e.preventDefault(); caretPos = selStart; setActive(active - 1); }
  } else if (e.key === "ArrowDown") {
    if (active < lines.length - 1) { e.preventDefault(); caretPos = selStart; setActive(active + 1); }
  } else if (e.key === "Escape") {
    inp.blur(); active = -1; build();
  }
}

/* click empty editor space to append/edit last */
editor.addEventListener("click", (e) => {
  if (e.target === editor) {
    if (lines[lines.length-1].trim() !== "") { lines.push(""); }
    setActive(lines.length - 1);
  }
});

/* Esc anywhere -> clear edit/selection. Delete/Backspace removes selected range.
   Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y redo (works while editing too) */
document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === "z" || e.key === "Z")) {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (mod && (e.key === "y" || e.key === "Y")) {
    e.preventDefault(); redo(); return;
  }
  // copy / cut the multi-line selection
  if (sel && mod && (e.key === "c" || e.key === "C")) {
    e.preventDefault(); copySelection(false); return;
  }
  if (sel && mod && (e.key === "x" || e.key === "X")) {
    e.preventDefault(); copySelection(true); return;
  }
  if (e.key === "Escape" && (active >= 0 || sel)) {
    active = -1; sel = null; build();
  } else if ((e.key === "Backspace" || e.key === "Delete") && sel) {
    e.preventDefault(); deleteSelection();
  }
});

function copySelection(cut) {
  if (!sel) return;
  const lo = Math.min(sel.a, sel.b), hi = Math.max(sel.a, sel.b);
  const text = lines.slice(lo, hi + 1).join("\n");
  try { navigator.clipboard.writeText(text); } catch (_) {}
  if (cut) { deleteSelection(); }
  else {
    const n = hi - lo + 1;
    statusEl.textContent = "copied " + n + " line" + (n === 1 ? "" : "s");
    setTimeout(() => { if (!sel) updateStatus(); }, 1000);
  }
}

/* click anywhere off a line -> clear edit/selection */
document.addEventListener("mousedown", (e) => {
  if (active < 0 && !sel) return;
  if (e.target.closest(".line") || e.target.closest(".btn")) return;
  active = -1; sel = null;
  build();
});

/* ---- toolbar actions (in settings panel) ---- */
document.getElementById("clear").addEventListener("click", () => {
  if (confirm("Clear the document? (⌘Z to undo)")) {
    histCommit();
    lines = [""]; active = 0; save(); build();
    document.getElementById("settings").hidden = true;
  }
});
document.getElementById("copy").addEventListener("click", async (e) => {
  try { await navigator.clipboard.writeText(lines.join("\n")); } catch (_) {}
  const b = e.currentTarget, t = b.textContent;
  b.textContent = "Copied!"; setTimeout(() => (b.textContent = t), 1200);
});

/* ---- settings panel ---- */
let settings = Object.assign({ wc: true, flags: true, progress: true }, JSON.parse(lsGet(SETTINGS_KEY) || "{}"));
function applySettings() {
  document.getElementById("wc").style.display = settings.wc ? "" : "none";
  document.getElementById("flagcount").style.display = settings.flags ? "" : "none";
  document.querySelector("header .progress").style.display = settings.progress ? "" : "none";
  document.getElementById("opt-wc").checked = settings.wc;
  document.getElementById("opt-flags").checked = settings.flags;
  document.getElementById("opt-progress").checked = settings.progress;
}
function setOpt(k, v) { settings[k] = v; lsSet(SETTINGS_KEY, JSON.stringify(settings)); applySettings(); }
document.getElementById("opt-wc").addEventListener("change", (e) => setOpt("wc", e.target.checked));
document.getElementById("opt-flags").addEventListener("change", (e) => setOpt("flags", e.target.checked));
document.getElementById("opt-progress").addEventListener("change", (e) => setOpt("progress", e.target.checked));
const settingsPanel = document.getElementById("settings");
const settingsBtn = document.getElementById("settings-btn");
settingsBtn.addEventListener("click", (e) => { e.stopPropagation(); settingsPanel.hidden = !settingsPanel.hidden; });
document.addEventListener("mousedown", (e) => {
  if (!settingsPanel.hidden && !settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) settingsPanel.hidden = true;
});
applySettings();

/* ---- theme ---- */
function applyTheme(t) {
  if (t) document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
}
/* ---- editable title ---- */
function loadTitle() {
  const t = lsGet(TITLE_KEY);
  titleEl.textContent = t !== null ? t : "Markdown";
}
loadTitle();
titleEl.addEventListener("input", () => {
  lsSet(TITLE_KEY, titleEl.textContent.trim());
  flashSaved();
});
titleEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); }
});

applyTheme(lsGet(THEME_KEY));
document.getElementById("theme").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const next = cur ? (cur === "dark" ? "light" : null) : (dark ? "light" : "dark");
  if (next) lsSet(THEME_KEY, next); else lsDel(THEME_KEY);
  applyTheme(next);
});

// sticky header: divider once scrolled + a scroll-progress bar
const headerEl = document.querySelector("header");
const progressFill = document.getElementById("progressFill");
const onScroll = () => {
  headerEl.classList.toggle("stuck", window.scrollY > 6);
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const pct = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  progressFill.style.width = (pct * 100) + "%";
};
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll, { passive: true });
onScroll();

build();
