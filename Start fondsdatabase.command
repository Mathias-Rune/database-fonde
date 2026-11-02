#!/bin/bash
set -u

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd -P)" || exit 1
NODE_BIN="/opt/homebrew/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node || true)"
fi
if [ -z "$NODE_BIN" ]; then
  echo "Node.js blev ikke fundet. Installer Node.js eller Homebrew Node."
  read -n 1 -s -r -p "Tryk en tast for at lukke..."
  exit 1
fi

APP_URL="http://127.0.0.1:8000/"
HEALTH_URL="${APP_URL}api/health"
app_is_running() {
  curl --silent --show-error --fail --max-time 2 "$HEALTH_URL" 2>/dev/null | grep -q '"app":"dansk-fondsdatabase"'
}

if app_is_running; then
  echo "Fondsdatabase-appen kører allerede. Åbner den nu."
  open "$APP_URL"
  exit 0
fi

if lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 8000 bruges af et andet program. Stop det program, og prøv igen."
  read -n 1 -s -r -p "Tryk en tast for at lukke..."
  exit 1
fi

cd "$PROJECT_DIR" || exit 1
echo "Starter Dansk Fondsdatabase fra $PROJECT_DIR ..."
HOST=127.0.0.1 PORT=8000 "$NODE_BIN" server.mjs &
SERVER_PID=$!
for _ in {1..60}; do
  if app_is_running; then
    echo "Appen er klar: $APP_URL"
    open "$APP_URL"
    wait "$SERVER_PID"
    exit $?
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    wait "$SERVER_PID"
    echo "Appen kunne ikke starte. Se fejlen ovenfor."
    read -n 1 -s -r -p "Tryk en tast for at lukke..."
    exit 1
  fi
  sleep 0.25
done

echo "Appen blev ikke klar inden for 15 sekunder. Se fejlen ovenfor."
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
read -n 1 -s -r -p "Tryk en tast for at lukke..."
exit 1
