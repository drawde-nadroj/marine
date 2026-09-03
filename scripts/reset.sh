#!/bin/sh
set -eu
set -a
[ -f .env ] && . ./.env
set +a
curl -fsS -H 'content-type: application/json' -d '{"confirm":"RESET DEMO"}' "http://127.0.0.1:${PORT:-18787}/api/demo/reset"
printf '\n'
