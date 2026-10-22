#!/bin/bash
# Startet Server + eigenen Worker. Nutzung: ./start.sh Carl   (bzw. Emil)
DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="${1:-Carl}"
python3 "$DIR/server.py" "${@:2}" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
python3 "$DIR/worker.py" --user "$USER_NAME"
