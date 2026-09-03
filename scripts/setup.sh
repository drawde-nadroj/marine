#!/bin/sh
set -eu
command -v node >/dev/null
command -v docker >/dev/null
if [ ! -f .env ]; then
  cp .env.example .env
  secret="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
  node -e "const fs=require('node:fs');const p='.env';const s=fs.readFileSync(p,'utf8').replace(/^INTERNAL_SECRET=.*$/m,'INTERNAL_SECRET='+process.argv[1]);fs.writeFileSync(p,s)" "$secret"
  echo 'Created .env with a random local INTERNAL_SECRET.'
fi
secret="$(sed -n 's/^INTERNAL_SECRET=//p' .env | head -n 1)"
if [ "${#secret}" -lt 16 ] || printf '%s' "$secret" | grep -q '^replace-'; then
  echo 'Existing .env must contain a non-placeholder INTERNAL_SECRET of at least 16 characters.' >&2
  exit 1
fi
docker compose up -d
