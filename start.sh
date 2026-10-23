#!/bin/bash
# Startet den eigenen Worker gegen https://www.wima26.de. Nutzung: ./start.sh Carl   (bzw. Emil)
# Beim ersten Start fragt er nach dem Wima-Passwort. Lokal testen: ./start.sh Carl --lokal
DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="${1:-Carl}"
if [ "$2" = "--lokal" ]; then
  python3 "$DIR/server.py" &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null' EXIT
  sleep 1
  python3 "$DIR/worker.py" --user "$USER_NAME" --server http://127.0.0.1:8790
  exit
fi
exec python3 "$DIR/worker.py" --user "$USER_NAME"
