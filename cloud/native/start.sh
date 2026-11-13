#!/bin/sh
set -eu
umask 077

# The credential is generated inside this cloud instance and persists with its IRIS data.
# Neither the image nor the workflow contains an operator account or reusable password.
python3 -B - <<'PY'
import os
from pathlib import Path
import secrets
import stat

p = Path(os.environ['KOTR_CLOUD_SEAT_PASSWORD_FILE'])
if p != Path('/data/kotr-cloud/seat-password'):
    raise SystemExit('Unexpected cloud credential location')
p.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
try:
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    identity = p.lstat()
    if not stat.S_ISREG(identity.st_mode) or identity.st_uid != os.getuid() or identity.st_mode & 0o077:
        raise SystemExit('Cloud credential ownership or permissions differ')
    value = p.read_bytes()
    if len(value) != 65 or value[-1:] != b'\n' or any(c not in b'0123456789abcdef' for c in value[:-1]):
        raise SystemExit('Cloud credential format differs')
else:
    with os.fdopen(fd, 'w', encoding='ascii') as f:
        f.write(secrets.token_hex(32) + '\n')
        f.flush()
        os.fsync(f.fileno())
PY

output=$(mktemp)
trap 'rm -f "$output"' EXIT
if ! iris session IRIS -U USER < /opt/kotr-cloud/bootstrap.script > "$output" 2>&1; then
    echo 'Cloud initialization failed.' >&2
    exit 1
fi
if ! grep -qx 'KOTR_CLOUD_BOOTSTRAP_OK' "$output"; then
    echo 'Cloud compilation, security setup or production start did not complete.' >&2
    exit 1
fi
python3 -B /opt/kotr-cloud/provider.py &
python3 -B /opt/kotr-cloud/broker.py &
echo 'KOTR_CLOUD_SERVICES_STARTED'
