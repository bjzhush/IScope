#!/usr/bin/env bash
# Manage the ai-overview service: ./server.sh start|stop|restart|status
# The binary runs in the background; logs go to logs/server.log.
set -euo pipefail

cd "$(dirname "$0")"

ADDR="${AI_OVERVIEW_ADDR:-127.0.0.1:8080}"
BIN="bin/ai-overview"
PID_FILE="data/server.pid"
LOG_FILE="logs/server.log"

running_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "$pid"
  else
    rm -f "$PID_FILE"
    return 1
  fi
}

# Rebuild when the binary is missing or any source file is newer than it.
build_if_needed() {
  if [[ -x "$BIN" ]] && [[ -z "$(find cmd internal web/src web/index.html web/embed.go go.mod -newer "$BIN" -type f -print -quit)" ]]; then
    return
  fi
  echo "代码有更新，正在构建（首次可能需要一两分钟）..."
  if ! make build >"logs/build.log" 2>&1; then
    echo "构建失败，详情见 logs/build.log"
    exit 1
  fi
  echo "构建完成"
}

start() {
  mkdir -p data logs
  if pid="$(running_pid)"; then
    echo "服务已在运行（PID ${pid}）：http://$ADDR"
    return
  fi
  if lsof -nP -iTCP:"${ADDR##*:}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "端口 ${ADDR##*:} 已被其他程序占用，无法启动："
    lsof -nP -iTCP:"${ADDR##*:}" -sTCP:LISTEN 2>/dev/null
    exit 1
  fi
  build_if_needed

  nohup "./$BIN" -addr "$ADDR" >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"

  # Wait until the HTTP endpoint answers, up to ~5 seconds.
  for _ in $(seq 1 25); do
    if curl -fs "http://$ADDR/api/v1/healthz" >/dev/null 2>&1; then
      echo "服务已启动（PID $(cat "$PID_FILE")）：http://$ADDR"
      return
    fi
    if ! running_pid >/dev/null; then break; fi
    sleep 0.2
  done
  echo "启动失败，最近的日志："
  tail -n 20 "$LOG_FILE"
  stop >/dev/null 2>&1 || true
  exit 1
}

stop() {
  local pid
  if ! pid="$(running_pid)"; then
    echo "服务未在运行"
    return
  fi
  kill "$pid"
  for _ in $(seq 1 50); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "服务已停止"
      return
    fi
    sleep 0.2
  done
  echo "服务 10 秒内未退出，强制结束"
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
}

status() {
  local pid
  if pid="$(running_pid)"; then
    echo "运行中（PID ${pid}）：http://$ADDR"
  else
    echo "未运行"
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  *)
    echo "用法：$0 {start|stop|restart|status}"
    exit 1
    ;;
esac
