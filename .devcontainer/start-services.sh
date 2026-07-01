#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
API_DIR="$ROOT_DIR/api"
API_LOG="/tmp/mopp-api.log"
API_PID="/tmp/mopp-api.pid"
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

stop_port_if_listening() {
  local port="$1"
  local pid
  pid=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -z "$pid" ]; then
    return
  fi

  echo "Zastavuji proces na portu $port (PID $pid)..."
  kill $pid 2>/dev/null || true

  for _ in {1..10}; do
    if ! lsof -iTCP:"$port" -sTCP:LISTEN -P -n >/dev/null 2>&1; then
      return
    fi
    sleep 0.2
  done

  echo "Proces na portu $port stale bezi, posilam SIGKILL..."
  kill -9 $pid 2>/dev/null || true
}

start_api() {
  if is_port_listening 4000; then
    echo "MOPP API uz bezi (port 4000)."
    return
  fi

  echo "Spoustim MOPP API..."
  api_pid=$(start_detached "$API_LOG" npm --prefix "$API_DIR" run dev)
  echo "$api_pid" > "$API_PID"

  for _ in {1..40}; do
    if is_port_listening 4000; then
      echo "MOPP API spusten (port 4000)."
      return
    fi
    sleep 0.5
  done

  echo "MOPP API se nespustilo vcas. Viz log: $API_LOG"
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

stop_port_if_listening 3001
stop_port_if_listening 5173

start_frontend
start_api

echo "Hotovo. Logy: $API_LOG, $FRONTEND_LOG | PID: $API_PID, $FRONTEND_PID"
