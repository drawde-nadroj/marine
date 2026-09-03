#!/bin/sh
set -eu
set -a
[ -f .env ] && . ./.env
set +a
base="http://127.0.0.1:${PORT:-18787}"
json_tmp="${TMPDIR:-/tmp}/coastal-verify-$$.json"
conflict_tmp="${TMPDIR:-/tmp}/coastal-conflict-$$.json"
response_tmp="${TMPDIR:-/tmp}/coastal-response-$$.json"
readiness_tmp="${TMPDIR:-/tmp}/coastal-readiness-$$.json"
readiness_err="${TMPDIR:-/tmp}/coastal-readiness-$$.err"
trap 'rm -f "$json_tmp" "$conflict_tmp" "$response_tmp" "$readiness_tmp" "$readiness_err"' EXIT
get() { curl -fsS "$base$1"; }
post() { curl -fsS -H 'content-type: application/json' -d "$2" "$base$1"; }
scenario() { get "/api/demo/scenarios/$1"; }
assert_js() { node -e "const x=JSON.parse(require('node:fs').readFileSync(0,'utf8'));const assert=require('node:assert/strict');$1"; }
reset() { post /api/demo/reset '{"confirm":"RESET DEMO"}' >/dev/null; }
run_scenario() { scenario "$1" >"$json_tmp"; curl -fsS -H 'content-type: application/json' --data @"$json_tmp" "$base/api/demo/intake"; }

echo '1/8 Unit tests and webhook readiness'
npm test
attempt=0
last_readiness_error='n8n did not answer'
while :; do
  code="$(curl -sS -o "$readiness_tmp" -w '%{http_code}' -H 'content-type: application/json' -d '{"eventId":"readiness-probe","message":"missing sender"}' "$base/api/demo/intake" 2>"$readiness_err" || true)"
  if [ "$code" = 400 ] && node -e "const x=JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8'));if(x.code!=='INVALID_INPUT')process.exit(1)" "$readiness_tmp" 2>/dev/null; then
    break
  fi
  last_readiness_error="intake: HTTP ${code:-none}; body=$(cat "$readiness_tmp" 2>/dev/null || true); curl=$(cat "$readiness_err")"
  attempt=$((attempt + 1)); [ "$attempt" -lt 60 ] || { echo "n8n intake webhook did not become ready: $last_readiness_error" >&2; exit 1; }; sleep 1
done
get /api/demo/health | assert_js "assert.equal(x.ok,true)"

echo '2/8 Reset, complete intake, and duplicate replay'
reset
complete="$(run_scenario complete)"
printf '%s' "$complete" | assert_js "assert.equal(x.state,'INTAKE_READY');assert.equal(x.duplicate,false)"
lead="$(printf '%s' "$complete" | node -pe "JSON.parse(require('node:fs').readFileSync(0,'utf8')).leadId")"
duplicate="$(curl -fsS -H 'content-type: application/json' --data @"$json_tmp" "$base/api/demo/intake")"
printf '%s' "$duplicate" | assert_js "assert.equal(x.leadId,$lead);assert.equal(x.duplicate,true)"
node -e "const fs=require('node:fs');const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));x.message+=' Changed payload.';process.stdout.write(JSON.stringify(x))" "$json_tmp" >"$conflict_tmp"
code="$(curl -sS -o "$response_tmp" -w '%{http_code}' -H 'content-type: application/json' --data @"$conflict_tmp" "$base/api/demo/intake")"
[ "$code" = 409 ]
cat "$response_tmp" | assert_js "assert.equal(x.code,'IDEMPOTENCY_CONFLICT')"
code="$(curl -sS -o "$response_tmp" -w '%{http_code}' -H 'content-type: application/json' -d "{\"leadId\":$lead}" "$base/api/demo/customer-update")"
[ "$code" = 409 ]
cat "$response_tmp" | assert_js "assert.match(x.error,/NEEDS_INFORMATION/)"
code="$(curl -sS -o "$response_tmp" -w '%{http_code}' -H 'content-type: application/json' -d '{"leadId":99999}' "$base/api/demo/customer-update")"
[ "$code" = 404 ]
cat "$response_tmp" | assert_js "assert.equal(x.code,'LEAD_NOT_FOUND')"
get /api/demo/status | assert_js "assert.equal(x.counts.leads,1);assert.equal(x.counts.executions,1);assert.equal(x.counts.scheduled_actions,0)"

echo '3/8 Malformed input is rejected without side effects'
code="$(curl -sS -o "$json_tmp" -w '%{http_code}' -H 'content-type: application/json' -d '{"eventId":"bad","message":"missing sender"}' "$base/api/demo/intake")"
[ "$code" = 400 ]
get /api/demo/status | assert_js "assert.deepEqual(x.counts,{leads:1,executions:1,scheduled_actions:0,handoffs:0,message_events:0})"

echo '4/8 Incomplete intake persists and executes its due action'
reset
run_scenario incomplete | assert_js "assert.equal(x.state,'NEEDS_INFORMATION');assert.equal(x.followup.state,'PENDING')"
sleep 16
post /api/demo/followups/run '{}' | assert_js "assert.equal(x.claimed,1);assert.equal(x.results[0].state,'EXECUTED');assert.equal(x.results[0].messageStatus,'SIMULATED')"

echo '5/8 Customer update cancels the obsolete action'
reset
pending="$(run_scenario incomplete)"
lead="$(printf '%s' "$pending" | node -pe "JSON.parse(require('node:fs').readFileSync(0,'utf8')).leadId")"
post /api/demo/customer-update "{\"leadId\":$lead}" | assert_js "assert.equal(x.followup.state,'CANCELED')"
sleep 16
post /api/demo/followups/run '{}' | assert_js "assert.equal(x.claimed,0)"
get /api/demo/status | assert_js "assert.equal(x.counts.message_events,0);assert.equal(x.leads[0].followup.state,'CANCELED')"

echo '6/8 Emergency inquiry routes to a human'
reset
run_scenario emergency | assert_js "assert.equal(x.state,'HUMAN_REQUIRED');assert.equal(x.humanRequired,true)"

echo '7/8 Mock boundary failure is persisted'
reset
run_scenario mock-boundary-failure | assert_js "assert.equal(x.followup.state,'PENDING')"
sleep 16
post /api/demo/followups/run '{}' | assert_js "assert.equal(x.claimed,1);assert.equal(x.results[0].state,'FAILED')"
get /api/demo/status | assert_js "assert.equal(x.counts.message_events,1);assert.equal(x.leads[0].followup.state,'FAILED')"

echo '8/8 Actual n8n-mediated verification passed'
