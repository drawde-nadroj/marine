#!/bin/sh
set -eu
exec ./scripts/load-env.sh node src/http/server.ts
