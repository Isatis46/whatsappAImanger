#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 infrastructure/scripts/init-local.py
docker compose --env-file .env -f infrastructure/compose/development.yaml up -d --wait
pnpm db:migrate
pnpm bootstrap
printf 'Local setup complete. Start the application with pnpm dev.\n'
