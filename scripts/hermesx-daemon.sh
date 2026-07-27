#!/usr/bin/env bash
# HermesX Docker 生产守护：start | stop | restart | status | logs
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/docker-compose.prod.yml")

usage() {
  echo "Usage: $0 {start|stop|restart|status|logs}"
  exit 1
}

cmd="${1:-}"
[[ -n "$cmd" ]] || usage

case "$cmd" in
  start)
    "${COMPOSE[@]}" up -d --build
    "${COMPOSE[@]}" ps
    ;;
  stop)
    "${COMPOSE[@]}" stop backend frontend
    ;;
  restart)
    "${COMPOSE[@]}" up -d --build
    "${COMPOSE[@]}" ps
    ;;
  status)
    "${COMPOSE[@]}" ps
    ss -tlnp 2>/dev/null | grep -E ':(80|3001|5173)\b' || true
    ;;
  logs)
    "${COMPOSE[@]}" logs -f --tail=80 backend frontend
    ;;
  *)
    usage
    ;;
esac
