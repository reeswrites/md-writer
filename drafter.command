#!/bin/zsh
# Double-clickable launcher. Finder opens .command files in Terminal, so this
# window becomes the server's log — closing it stops the server, which is the
# behaviour you want from something you started by double-clicking.
#
# Lives in the repo rather than loose on the Desktop so it is versioned; the
# Desktop copy is a two-line stub that calls this one.
set -u

HERE="${0:A:h}"
PORT="${DRAFTER_PORT:-8787}"
URL="http://localhost:$PORT"

cd "$HERE" || exit 1

# Already running? Then this is a "take me to my writing" click, not a start.
# Starting a second one just fails to bind and looks like the app is broken.
if curl -sf -o /dev/null --max-time 2 "$URL/api/drafts"; then
  echo "Drafter is already running on $URL"
  open "$URL"
  echo
  echo "This window is not the server — the one that started it is."
  echo "Press any key to close."
  read -k 1 -s
  exit 0
fi

echo "Starting Drafter…"
./serve.py --port "$PORT" &
SERVER=$!

# Open the browser only once it answers. Opening immediately races the bind and
# lands on a connection error, which reads as "it's broken" rather than "wait".
for i in $(seq 1 40); do
  if curl -sf -o /dev/null --max-time 1 "$URL/api/drafts"; then
    open "$URL"
    break
  fi
  sleep 0.25
done

if ! kill -0 $SERVER 2>/dev/null; then
  echo
  echo "Drafter failed to start. The output above says why."
  echo "Press any key to close."
  read -k 1 -s
  exit 1
fi

echo
echo "Writing goes to ~/Documents/drafts"
echo "Close this window (or press Ctrl-C) to stop the server."
echo

# Hand the window to the server so its log is what you see.
wait $SERVER
