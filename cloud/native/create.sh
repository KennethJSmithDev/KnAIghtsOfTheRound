#!/bin/sh
set -eu
umask 077

# Build 154's supported password startup path expects this alias. Keep vendor bytes intact.
test -x /usr/irissys/csp/bin/CSPpwd
if [ ! -e /usr/irissys/bin/CSPpwd ]; then
    ln -s ../csp/bin/CSPpwd /usr/irissys/bin/CSPpwd
fi
test "$(readlink -f /usr/irissys/bin/CSPpwd)" = /usr/irissys/csp/bin/CSPpwd

# Only this newly owned cloud instance receives these random, separate credentials.
python3 -B - <<'PY'
import os
from pathlib import Path
import secrets
import stat

root = Path('/data/kotr-cloud')
root.mkdir(mode=0o700, parents=True, exist_ok=True)
if root.is_symlink() or root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077:
    raise SystemExit('Unexpected cloud credential directory identity')
allowed = b'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'

def valid(value):
    if len(value) != 33 or value[-1:] != b'\n':
        return False
    # The fixed prefix guarantees upper/lower/digit/punctuation; the suffix is URL-safe.
    return value.startswith(b'Aa7!') and all(c in allowed for c in value[4:-1])

existing = {}
for name in ('bootstrap-password', 'seat-password'):
    p = root / name
    try:
        identity = p.lstat()
    except FileNotFoundError:
        continue
    if not stat.S_ISREG(identity.st_mode) or identity.st_uid != os.getuid() or identity.st_mode & 0o077:
        raise SystemExit('Cloud credential ownership or permissions differ')
    value = p.read_bytes()
    if not valid(value):
        raise SystemExit('Existing cloud credential does not match the required 32-character format; not changed')
    existing[name] = value
if len(set(existing.values())) != len(existing):
    raise SystemExit('Existing cloud credentials must be distinct; not changed')
for name in ('bootstrap-password', 'seat-password'):
    if name in existing:
        continue
    # Twenty-one random bytes provide 168 bits; the prefix guarantees four character categories.
    value = ('Aa7!' + secrets.token_urlsafe(21) + '\n').encode('ascii')
    while value in existing.values():
        value = ('Aa7!' + secrets.token_urlsafe(21) + '\n').encode('ascii')
    if not valid(value):
        raise SystemExit('Generated cloud credential format differs')
    fd = os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(value)
        f.flush()
        os.fsync(f.fileno())
    existing[name] = value
PY
