#!/bin/bash
PROJECT_DIR="/Users/mathiasrune/Documents/Database fonde"
NODE_BIN="/opt/homebrew/bin/node"
cd "$PROJECT_DIR" || {
  echo "Kunne ikke finde projektmappen: $PROJECT_DIR"
  read -n 1 -s -r -p "Tryk en tast for at lukke..."
  exit 1
}

if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node)"
fi

if [ -z "$NODE_BIN" ]; then
  echo "Node.js blev ikke fundet. Installer Node.js eller Homebrew Node."
  read -n 1 -s -r -p "Tryk en tast for at lukke..."
  exit 1
fi

PORT_VALUE="8001"
while lsof -nP -iTCP:"$PORT_VALUE" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT_VALUE=$((PORT_VALUE + 1))
done

echo "Starter Dansk Fondsdatabase til lokalt netvaerk..."
echo "Projektmappe: $PROJECT_DIR"
echo "Node: $NODE_BIN"
echo "Aabner paa din egen computer: http://127.0.0.1:$PORT_VALUE/"
echo "Kollegaer paa samme WiFi skal bruge din lokale IP-adresse, fx http://192.168.0.40:$PORT_VALUE/"
open "http://127.0.0.1:$PORT_VALUE/"
HOST=0.0.0.0 PORT="$PORT_VALUE" "$NODE_BIN" server.mjs

echo ""
echo "Serveren stoppede."
read -n 1 -s -r -p "Tryk en tast for at lukke..."
