#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${BACKUP_PASSPHRASE_FILE:?Set path to a protected passphrase file outside the repository}"
: "${BACKUP_DIRECTORY:?Set an existing private backup directory}"
[[ -d "$BACKUP_DIRECTORY" ]] || { echo 'Backup directory does not exist' >&2; exit 1; }
output="$BACKUP_DIRECTORY/whatsapp-$(date -u +%Y%m%dT%H%M%SZ).dump.enc"
docker compose --env-file .env -f "${BACKUP_COMPOSE_FILE:-infrastructure/compose/production.yaml}" exec -T postgres pg_dump -U wa -d "${BACKUP_DATABASE:-wa}" -Fc | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -out "$output"
# A separate HMAC detects ciphertext tampering before restore; retain both files.
python3 - "$output" "$BACKUP_PASSPHRASE_FILE" <<'PY'
import hashlib, hmac, pathlib, sys
file, key_file = map(pathlib.Path, sys.argv[1:])
mac = hmac.new(key_file.read_bytes(), digestmod=hashlib.sha256)
with file.open('rb') as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        mac.update(chunk)
file.with_name(file.name + '.hmac').write_text(mac.hexdigest())
PY
printf 'Encrypted database backup created: %s\n' "$output"
