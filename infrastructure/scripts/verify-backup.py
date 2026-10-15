"""Authenticate a backup before decrypting. Requires only Python's standard library."""
import hashlib
import hmac
from pathlib import Path
import sys

if len(sys.argv) != 3:
    sys.exit("Usage: python3 verify-backup.py backup.dump.enc passphrase-file")
file, key_file = map(Path, sys.argv[1:])
mac = hmac.new(key_file.read_bytes(), digestmod=hashlib.sha256)
with file.open("rb") as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        mac.update(chunk)
expected = file.with_name(file.name + ".hmac").read_text().strip()
if not hmac.compare_digest(mac.hexdigest(), expected):
    sys.exit("Backup authentication failed; do not restore this file.")
print("Backup authentication verified.")
