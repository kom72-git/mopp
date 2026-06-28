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

stop_conflicting_processes() {
  echo "Kontroluji a zastavuji konfliktni procesy..."
  
  # Zastavit procesy na portech MOPP
  pkill -f "vite.*4173" || true
  pkill -f "node.*4000" || true
  
  # Cekat az se porty uvolni
  for _ in {1..10}; do
    if ! is_port_listening 4173 && ! is_port_listening 4000; then
      echo "Porty 4173 a 4000 jsou volne."
      return
    fi
    sleep 0.5
  done
  
  echo "Varovani: Porty 4173 nebo 4000 jsou stale obsazene."
}

start_frontend() {
  stop_conflicting_processes
  
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
