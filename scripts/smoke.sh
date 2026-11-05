#!/usr/bin/env bash
# End-to-end check against the running containers: the brief's sample calls, the error paths, and the nginx proxy.
# Run after `SEED_TASKS=0 docker-compose up --build`. Ports follow API_PORT and WEB_PORT. Expects an empty task list, so start with SEED_TASKS=0.
set -u
API="http://localhost:${API_PORT:-5000}"
WEB="http://localhost:${WEB_PORT:-3000}"
fails=0

check() { # name, expected, actual
  if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FAIL  $1: expected $2, got $3"; fails=$((fails + 1)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

for _ in $(seq 1 20); do [ "$(code "$WEB/api/health")" = 200 ] && break; sleep 1; done

check "web serves the app"      200 "$(code "$WEB/")"
check "stats start empty"       '{"completed":0,"pending":0,"total":0}' "$(curl -s "$API/tasks/stats")"
check "create"                  201 "$(code -X POST "$API/tasks" -H 'Content-Type: application/json' -d '{"title": "Write report"}')"
check "create through the web proxy" 201 "$(code -X POST "$WEB/api/tasks" -H 'Content-Type: application/json' -d '{"title": "Via proxy"}')"
check "proxy and API share one list" 2 "$(curl -s "$WEB/api/tasks" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
check "complete"                200 "$(code -X PUT "$API/tasks/1/complete")"
check "stats after complete"    '{"completed":1,"pending":1,"total":2}' "$(curl -s "$API/tasks/stats")"
check "delete"                  204 "$(code -X DELETE "$API/tasks/1")"
check "delete missing is 404"   404 "$(code -X DELETE "$API/tasks/1")"
check "complete missing is 404" 404 "$(code -X PUT "$API/tasks/1/complete")"
check "blank title is 400"      400 "$(code -X POST "$API/tasks" -H 'Content-Type: application/json' -d '{"title": " "}')"
check "404 body names the task" '{"error":{"code":"task_not_found","message":"Task 1 does not exist."}}' "$(curl -s -X DELETE "$API/tasks/1")"

[ "$fails" -eq 0 ] && echo "all checks passed" || { echo "$fails failed"; exit 1; }
