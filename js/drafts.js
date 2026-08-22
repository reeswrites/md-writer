/**
 * The drafts layer: many documents, each a file on disk.
 *
 * Before this, the whole editor persisted to ONE localStorage key, so starting a
 * second piece silently overwrote the first. Files fix that, and serve.py owns
 * them — including the git commit that follows a writing session.
 *
 * Degrades rather than breaks. With no server (opened as file://, or serve.py
 * not running) everything still works exactly as it did: localStorage, one
 * document, and a visible warning that the writing is browser-only. The server
 * is an upgrade, never a requirement.
 *
 * localStorage keeps a job either way — it is the crash buffer. A PUT that fails
 * because the server went down must not cost the session, so the text is always
 * in the browser first and the file is a copy that catches up.
 */
const Drafts = (() => {
  const API = "/api/drafts";
  const DEBOUNCE_MS = 800;      // a crash costs a sentence, not a sitting
  const LAST_KEY = "md-writer-last-draft";

  let available = false;
  let current = null;           // filename, or null in offline mode
  let dir = "";
  let repo = false;
  let timer = null;
  let pending = null;           // text awaiting a flush
  let listeners = [];

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  function emit(ev, detail) { listeners.forEach((f) => f(ev, detail)); }
  function onChange(fn) { listeners.push(fn); }

  /** Filename from a title. Stable once created — see rename(). */
  function filenameFor(title) {
    const slug = (title || "untitled")
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled";
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return `${stamp}-${slug}.md`;
  }

  // ── file format ───────────────────────────────────────────────────────────
  // Jekyll frontmatter, deliberately: the blog already uses exactly these
  // fields, so publishing a finished draft is a move rather than a rewrite.
  function serialise({ title, subtitle, body }) {
    const esc = (s) => `'${String(s || "").replace(/'/g, "''")}'`;
    const fm = ["---", `title: ${esc(title)}`];
    if (subtitle) fm.push(`description: ${esc(subtitle)}`);
    // Blank line after the closing fence, matching the 319 posts already on the
    // blog — so a finished draft moves into _posts/ without reformatting.
    fm.push("---", "", "");
    return fm.join("\n") + body;
  }

  function parse(text) {
    if (!text.startsWith("---")) return { title: "", subtitle: "", body: text };
    const end = text.indexOf("\n---", 3);
    if (end === -1) return { title: "", subtitle: "", body: text };
    const head = text.slice(3, end);
    // strip the blank separator serialise() writes after the closing fence
    // (one \n ends the --- line, one \n is the Jekyll blank line) so it doesn't
    // reappear as an empty first line every reload
    const body = text.slice(end + 4).replace(/^\n\n?/, "");
    const field = (name) => {
      const m = head.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "m"));
      if (!m) return "";
      let v = m[1].trim();
      if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1).replace(/''/g, "'");
      else if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      return v;
    };
    return { title: field("title"), subtitle: field("description"), body };
  }

  // ── transport ─────────────────────────────────────────────────────────────
  async function boot() {
    try {
      const r = await fetch(API, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      available = true;
      dir = d.dir;
      repo = d.repo;
      emit("ready", d);
      return d.drafts;
    } catch {
      available = false;
      emit("offline");
      return null;
    }
  }

  async function list() {
    if (!available) return [];
    try {
      const r = await fetch(API, { cache: "no-store" });
      return r.ok ? (await r.json()).drafts : [];
    } catch { return []; }
  }

  async function open(name) {
    const r = await fetch(`${API}/${encodeURIComponent(name)}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`could not open ${name}`);
    const { text } = await r.json();
    current = name;
    lsSet(LAST_KEY, name);
    return parse(text);
  }

  /** Debounced write. Call on every edit; it coalesces. */
  function save(doc) {
    if (!available || !current) return;
    pending = serialise(doc);
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  }

  async function flush() {
    if (!available || !current || pending === null) return;
    const body = pending;
    pending = null;
    clearTimeout(timer);
    try {
      const r = await fetch(`${API}/${encodeURIComponent(current)}`, {
        method: "PUT",
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
        body,
      });
      if (!r.ok) throw new Error(r.status);
      emit("saved", { name: current });
    } catch (e) {
      // Put it back so the next flush retries. The text is in localStorage
      // regardless, which is the point of keeping that path alive.
      pending = body;
      emit("save-failed", { name: current, error: String(e) });
    }
  }

  async function create(title) {
    if (!available) return null;
    const name = filenameFor(title);
    current = name;
    lsSet(LAST_KEY, name);
    pending = serialise({ title, subtitle: "", body: "" });
    await flush();
    return name;
  }

  // Closing the tab must not drop the tail of a sentence. keepalive lets the
  // request outlive the page; visibilitychange is the one that actually fires
  // reliably on mobile, where beforeunload often does not.
  function installFlushHooks() {
    // NOT sendBeacon: it can only ever send POST, and this endpoint is PUT — the
    // beacon would 404 and the last edits would vanish exactly when it mattered.
    // fetch with keepalive:true survives the page going away and keeps the verb.
    const hard = () => {
      if (!available || !current || pending === null) return;
      try {
        fetch(`${API}/${encodeURIComponent(current)}`, {
          method: "PUT", keepalive: true,
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
          body: pending,
        });
      } catch {}
    };
    addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
    addEventListener("blur", flush);
    addEventListener("beforeunload", hard);
  }

  return {
    boot, list, open, save, flush, create, onChange, installFlushHooks,
    parse, serialise, filenameFor,
    get available() { return available; },
    get current() { return current; },
    get dir() { return dir; },
    get repo() { return repo; },
    get lastOpened() { return lsGet(LAST_KEY); },
  };
})();
