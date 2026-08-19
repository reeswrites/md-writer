#!/usr/bin/env python3
"""md-writer's local server: serves the editor, owns the drafts on disk.

Why a server at all, when the editor was deliberately one static page:

  - localStorage held ONE document under a single key, so starting a second
    draft overwrote the first. That is the bug this exists to fix.
  - The File System Access API could have done it without a server, but it costs
    a permission prompt every session, needs a secure context anyway, and is
    Chromium-only. A save endpoint costs none of that and works in any browser.
  - The server already knows when each file was last written, so the git commit
    lives here too. No launchd agent, no file watcher, no second moving part.

Still no dependencies and no build step: python3 and the standard library.

    ./serve.py                      # serve ~/Documents/drafts on :8787
    ./serve.py --dir ~/writing      # somewhere else
    ./serve.py --idle 300           # commit 5 minutes after the last keystroke

The drafts directory is NOT this repo. md-writer is public; the drafts are not,
and the editor should never be able to write into its own checkout.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
# A write endpoint gets a strict allowlist, not an escaping pass. Lowercase,
# starts alphanumeric, .md only — no slashes, no dots leading, nothing to
# traverse with. Rejecting is cheap; a path bug here writes anywhere the user can.
SAFE_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,120}\.md$")
MAX_BODY = 4 * 1024 * 1024          # a draft is prose; 4MB is already absurd
STATIC_OK = {".html", ".js", ".css", ".svg", ".png", ".ico", ".woff2"}
# Repo furniture, not writing. Listed as drafts they are just noise you scroll
# past, and one of them is the file explaining what the directory is for.
NOT_DRAFTS = {"README.md", "LICENSE.md", "CONTRIBUTING.md", "CHANGELOG.md"}
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
        ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2"}


def _porcelain_name(line: str) -> str:
    """Filename out of one `git status --porcelain` line.

    NOT a fixed-column slice. `_git` strips its output, which removes the leading
    space of an unstaged modification (" M path" -> "M path") — so line[3:] cut
    one character into the filename and produced commits reading
    "write: 026-08-19-test". Untracked entries start "?? " with no leading space,
    so the same code was right half the time, which is the worst kind of wrong.

    Splitting on whitespace is immune to how many status columns survived.
    """
    parts = line.strip().split(maxsplit=1)
    if len(parts) < 2:
        return ""
    path = parts[1].strip()
    # Renames arrive as `R  "old.md" -> "new.md"`; the new name is what moved.
    if " -> " in path:
        path = path.split(" -> ")[-1]
    return path.strip().strip('"').split("/")[-1]


class Drafts:
    """The drafts directory, and the debounced commit that follows writing."""

    def __init__(self, root: Path, idle: int):
        self.root = root
        self.idle = idle
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()
        self.root.mkdir(parents=True, exist_ok=True)

    # ── git ────────────────────────────────────────────────────────────────
    def _git(self, *args: str) -> tuple[int, str]:
        try:
            p = subprocess.run(["git", "-C", str(self.root), *args],
                               capture_output=True, text=True, timeout=30)
            return p.returncode, (p.stdout + p.stderr).strip()
        except (OSError, subprocess.SubprocessError) as e:
            return 1, str(e)

    def is_repo(self) -> bool:
        return (self.root / ".git").exists()

    def commit_now(self) -> str | None:
        """One commit per writing session. Returns the subject, or None."""
        if not self.is_repo():
            return None
        with self._lock:
            code, out = self._git("status", "--porcelain")
            if code != 0 or not out:
                return None
            # Name the files that moved. `git commit -m "wip"` a hundred times
            # produces a log nobody can read, and the log is the whole point:
            # it is the record of when each piece was worked on.
            names = sorted(filter(None, (_porcelain_name(ln) for ln in out.splitlines())))
            shown = ", ".join(n[:-3] if n.endswith(".md") else n for n in names[:3])
            if len(names) > 3:
                shown += f" +{len(names) - 3} more"
            stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
            subject = f"write: {shown or 'drafts'} ({stamp})"
            self._git("add", "-A")
            code, out = self._git("commit", "-m", subject)
            if code != 0:
                print(f"  commit failed: {out[:200]}")
                return None
            print(f"  committed — {subject}")
            return subject

    def schedule_commit(self) -> None:
        """Reset the idle timer. Fires once, `idle` seconds after the LAST write,
        so a commit marks the end of a sitting rather than chopping one up."""
        if not self.is_repo():
            return
        with self._lock:
            if self._timer:
                self._timer.cancel()
            self._timer = threading.Timer(self.idle, self.commit_now)
            self._timer.daemon = True
            self._timer.start()

    # ── files ──────────────────────────────────────────────────────────────
    def list(self) -> list[dict]:
        out = []
        for p in sorted(self.root.glob("*.md")):
            if p.name in NOT_DRAFTS:
                continue
            try:
                text = p.read_text(encoding="utf-8", errors="replace")
                st = p.stat()
            except OSError:
                continue
            out.append({
                "name": p.name,
                "title": _title_of(text) or p.stem,
                "words": len(text.split()),
                "modified": datetime.fromtimestamp(st.st_mtime, timezone.utc)
                            .isoformat(timespec="seconds"),
            })
        out.sort(key=lambda d: d["modified"], reverse=True)
        return out

    def read(self, name: str) -> str | None:
        p = self.root / name
        if not p.is_file():
            return None
        return p.read_text(encoding="utf-8", errors="replace")

    def write(self, name: str, text: str) -> None:
        """Atomic: temp file then replace. A plain open(w) that dies mid-write
        truncates the draft to nothing, which is the one failure that loses real
        work rather than a few seconds of it."""
        p = self.root / name
        tmp = p.with_suffix(".md.tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, p)
        self.schedule_commit()


def _title_of(text: str) -> str:
    """Frontmatter title, else the first heading, else nothing."""
    m = re.search(r"^title:\s*(.+?)\s*$", text[:2000], re.M)
    if m:
        return m.group(1).strip().strip("'\"")
    m = re.search(r"^#\s+(.+?)\s*$", text, re.M)
    return m.group(1).strip() if m else ""


class Handler(BaseHTTPRequestHandler):
    drafts: Drafts = None          # set in main()
    server_version = "md-writer"

    def log_message(self, fmt, *args):   # one line, not three
        if not self.path.startswith("/api/drafts/"):
            return
        print(f"  {self.command} {self.path}")

    # ── plumbing ───────────────────────────────────────────────────────────
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # No caching for the app itself: editing app.js and getting a stale copy
        # back is a confusing ten minutes.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload) -> None:
        self._send(code, json.dumps(payload).encode(), "application/json; charset=utf-8")

    def _name(self) -> str | None:
        raw = self.path.split("?", 1)[0][len("/api/drafts/"):]
        from urllib.parse import unquote
        name = unquote(raw)
        return name if SAFE_NAME.match(name) else None

    # ── routes ─────────────────────────────────────────────────────────────
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/drafts":
            return self._json(200, {"drafts": self.drafts.list(),
                                    "dir": str(self.drafts.root),
                                    "repo": self.drafts.is_repo()})
        if path.startswith("/api/drafts/"):
            name = self._name()
            if not name:
                return self._json(400, {"error": "bad name"})
            text = self.drafts.read(name)
            if text is None:
                return self._json(404, {"error": "no such draft"})
            return self._json(200, {"name": name, "text": text})

        rel = "index.html" if path == "/" else path.lstrip("/")
        target = (HERE / rel).resolve()
        # Serve only from this directory, and only these types.
        if not str(target).startswith(str(HERE)) or target.suffix not in STATIC_OK:
            return self._json(404, {"error": "not found"})
        if not target.is_file():
            return self._json(404, {"error": "not found"})
        return self._send(200, target.read_bytes(), MIME.get(target.suffix, "application/octet-stream"))

    def do_PUT(self):
        if not self.path.startswith("/api/drafts/"):
            return self._json(404, {"error": "not found"})
        name = self._name()
        if not name:
            return self._json(400, {"error": "bad name — lowercase, .md, no slashes"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._json(400, {"error": "bad length"})
        if n > MAX_BODY:
            return self._json(413, {"error": "too large"})
        body = self.rfile.read(n).decode("utf-8", errors="replace")
        try:
            self.drafts.write(name, body)
        except OSError as e:
            return self._json(500, {"error": str(e)})
        return self._json(200, {"name": name, "bytes": len(body.encode())})


def main() -> int:
    # Unbuffered-ish: detached, stdout is a file, and Python block-buffers those.
    # Without this the startup banner and every commit line sit in a buffer, so
    # `cat md-writer.log` shows nothing on a server that is working fine.
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except AttributeError:
        pass

    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dir", default=str(Path.home() / "Documents" / "drafts"))
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--idle", type=int, default=900,
                    help="seconds of quiet before committing (default 900)")
    # Bound to loopback unless asked otherwise. This endpoint writes files; it
    # does not go on the LAN by accident.
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    root = Path(args.dir).expanduser().resolve()
    if root == HERE or str(root).startswith(str(HERE) + os.sep):
        print(f"refusing: --dir is inside md-writer itself ({root}).")
        print("md-writer is a public repo; drafts belong in their own directory.")
        return 2

    Handler.drafts = Drafts(root, args.idle)
    print(f"md-writer  http://{args.host}:{args.port}")
    print(f"  drafts   {root}")
    print(f"  git      {'yes — committing after ' + str(args.idle) + 's idle' if Handler.drafts.is_repo() else 'NO REPO — writes are not versioned (git init to fix)'}")
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  flushing...")
        Handler.drafts.commit_now()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
