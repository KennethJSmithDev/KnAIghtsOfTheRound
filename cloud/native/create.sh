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
for name in ('bootstrap-password', 'seat-password'):
    p = root / name
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
