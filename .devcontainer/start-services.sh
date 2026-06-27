#!/usr/bin/env bash

set -u

ROOT_DIR="/workspaces/mopp"
FRONTEND_LOG="/tmp/mopp-frontend.log"
FRONTEND_PID="/tmp/mopp-frontend.pid"

start_detached() {
  local log_file="$1"
  shift
  nohup setsid "$@" >"$log_file" 2>&1 < /dev/null &
  echo $!
}

is_port_listening() {
  local port="$1"
  lsof -iTCP:"$port" -sTCP:LISTEN -P -n >/dev/null 2>&1
}

start_frontend() {
  if is_port_listening 4173; then
    echo "MOPP frontend uz bezi (port 4173)."
    return
  fi

  echo "Spoustim MOPP frontend..."
  frontend_pid=$(start_detached "$FRONTEND_LOG" npm --prefix "$ROOT_DIR" run dev)
  echo "$frontend_pid" > "$FRONTEND_PID"

  for _ in {1..30}; do
    if is_port_listening 4173; then
      echo "MOPP frontend spusten (port 4173)."
      return
    fi
    sleep 0.5
  done

  echo "MOPP frontend se nespustil vcas. Viz log: $FRONTEND_LOG"
}

start_frontend

echo "Hotovo. Log: $FRONTEND_LOG | PID: $FRONTEND_PID"
