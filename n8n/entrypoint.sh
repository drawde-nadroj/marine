#!/bin/sh
set -eu
for workflow in /demo-workflows/*.json; do n8n import:workflow --input="$workflow"; done
for id in coastal-intake-v1 coastal-followup-schedule-v1 coastal-followup-run-v1 coastal-customer-update-v1; do
  n8n publish:workflow --id="$id"
done
exec n8n start
