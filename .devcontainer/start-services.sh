#!/usr/bin/env bash

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_LOG="/tmp/mopp-frontend.log"
FRONTEND_PID="/tmp/mopp-frontend.pid"
API_LOG="/tmp/mopp-api.log"
API_PID="/tmp/mopp-api.pid"

start_detached() {
  local log_file="$1"
  shift
  nohup setsid "$@" >"$log_file" 2>&1 < /dev/null &
  echo $!
}

port_pids() {
  local port="$1"
  lsof -t -iTCP:"$port" -sTCP:LISTEN -P -n 2>/dev/null | sort -u
}

is_port_listening() {
  local port="$1"
  lsof -iTCP:"$port" -sTCP:LISTEN -P -n >/dev/null 2>&1
}

process_cwd() {
  local pid="$1"
  readlink -f "/proc/$pid/cwd" 2>/dev/null || true
}

process_group_id() {
  local pid="$1"
  ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' '
}

is_mopp_pid() {
  local pid="$1"
  local cwd
  cwd="$(process_cwd "$pid")"
  [[ -n "$cwd" && "$cwd" == "$ROOT_DIR"* ]]
}

kill_pid_or_group() {
  local pid="$1"
  local pgid
  pgid="$(process_group_id "$pid")"

  if [[ -n "$pgid" ]]; then
    kill -TERM "-$pgid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    sleep 0.15
    kill -KILL "-$pgid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  else
    kill -TERM "$pid" 2>/dev/null || true
    sleep 0.15
    kill -KILL "$pid" 2>/dev/null || true
  fi
}

assert_aux_ports_clean() {
  local port
  local pid

  for port in 3001 5173; do
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      echo "Chyba: po startu porad bezi proces PID $pid na portu $port (cwd: $(process_cwd "$pid"))." >&2
      return 1
    done < <(port_pids "$port")
  done

  return 0
}

has_mopp_listener_on_port() {
  local port="$1"
  local pid

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    if is_mopp_pid "$pid"; then
      return 0
    fi
  done < <(port_pids "$port")

  return 1
}

is_api_healthy() {
  curl -fsS --max-time 2 "http://127.0.0.1:4000/api/ping" >/dev/null 2>&1
}

is_frontend_healthy() {
  curl -fsS --max-time 2 "http://127.0.0.1:4173" >/dev/null 2>&1
}

kill_port_pids() {
  local port="$1"
  local pid

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill_pid_or_group "$pid"
  done < <(port_pids "$port")

  for _ in {1..10}; do
    is_port_listening "$port" || return
    sleep 0.3
  done
}

kill_port_pids_if_not_mopp() {
  local port="$1"
  local killed_any=0
  local pid

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    if is_mopp_pid "$pid"; then
      continue
    fi

    echo "Zastavuji cizi proces PID $pid na portu $port (mimo $ROOT_DIR)."
    kill_pid_or_group "$pid"
    killed_any=1
  done < <(port_pids "$port")

  if [[ "$killed_any" -eq 1 ]]; then
    for _ in {1..10}; do
      local foreign_still=0
      while IFS= read -r pid; do
        [[ -z "$pid" ]] && continue
        if ! is_mopp_pid "$pid"; then
          foreign_still=1
          break
        fi
      done < <(port_pids "$port")

      [[ "$foreign_still" -eq 0 ]] && break
      sleep 0.3
    done
  fi
}

stop_foreign_aux_ports() {
  local port
  local pid

  for port in 3001 5173; do
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      echo "Zastavuji proces PID $pid na portu $port ($(process_cwd "$pid"))."
      kill_pid_or_group "$pid"
    done < <(port_pids "$port")

    for _ in {1..10}; do
      local still_listening=0
      while IFS= read -r pid; do
        [[ -z "$pid" ]] && continue
        still_listening=1
        break
      done < <(port_pids "$port")

      [[ "$still_listening" -eq 0 ]] && break
      sleep 0.3
    done
  done
}

stop_conflicting_processes() {
  echo "Kontroluji a zastavuji konfliktni procesy..."

  stop_foreign_aux_ports
  kill_port_pids_if_not_mopp 4173
  kill_port_pids_if_not_mopp 4000

  for _ in {1..10}; do
    local ok_4173=1
    local ok_4000=1
    local pid

    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      is_mopp_pid "$pid" || ok_4173=0
    done < <(port_pids 4173)

    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      is_mopp_pid "$pid" || ok_4000=0
    done < <(port_pids 4000)

    if [[ "$ok_4173" -eq 1 && "$ok_4000" -eq 1 ]]; then
      echo "Porty 4173 a 4000 jsou pripravene pro MOPP."
      return
    fi
    sleep 0.5
  done

  echo "Varovani: Porty 4173 nebo 4000 jsou stale obsazene cizim procesem."
}

start_frontend() {
  if is_port_listening 4173; then
    if has_mopp_listener_on_port 4173 && is_frontend_healthy; then
      echo "MOPP frontend uz bezi (port 4173)."
      return
    fi

    echo "Port 4173 je obsazeny, ale frontend neni zdravy. Delam restart..."
    kill_port_pids 4173
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

start_api() {
  if is_port_listening 4000; then
    if has_mopp_listener_on_port 4000 && is_api_healthy; then
      echo "MOPP API uz bezi (port 4000)."
      return
    fi

    echo "Port 4000 je obsazeny, ale API neni zdrave. Delam restart..."
    kill_port_pids 4000
  fi

  echo "Spoustim MOPP API..."
  api_pid=$(start_detached "$API_LOG" npm --prefix "$ROOT_DIR/api" run dev)
  echo "$api_pid" > "$API_PID"

  for _ in {1..30}; do
    if is_port_listening 4000; then
      echo "MOPP API spusteno (port 4000)."
      return
    fi
    sleep 0.5
  done

  echo "MOPP API se nespustilo vcas. Viz log: $API_LOG"
}

stop_conflicting_processes
start_api
start_frontend

if ! assert_aux_ports_clean; then
  echo "Start MOPP selhal: porty 3001/5173 se nepodarilo vycistit." >&2
  exit 1
fi

echo "Hotovo. Frontend log: $FRONTEND_LOG | API log: $API_LOG"
