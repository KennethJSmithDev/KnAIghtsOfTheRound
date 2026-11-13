#!/bin/sh
set -eu
umask 077

# Only the fresh-instance hook creates this persistent credential. A missing or old
# format is an inspection boundary; startup never replaces an existing account's file.
python3 -B - <<'PY'
import os
from pathlib import Path
import stat

p = Path(os.environ['KOTR_CLOUD_SEAT_PASSWORD_FILE'])
if p != Path('/data/kotr-cloud/seat-password'):
    raise SystemExit('Unexpected cloud credential location')
try:
    identity = p.lstat()
except FileNotFoundError:
    raise SystemExit('Persistent cloud seat credential is missing; not recreated') from None
if not stat.S_ISREG(identity.st_mode) or identity.st_uid != os.getuid() or identity.st_mode & 0o077:
    raise SystemExit('Cloud credential ownership or permissions differ')
value = p.read_bytes()
allowed = b'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
if (len(value) != 33 or value[-1:] != b'\n' or not value.startswith(b'Aa7!')
        or not all(c in allowed for c in value[4:-1])):
    raise SystemExit('Existing cloud credential does not match the required 32-character format; not changed')
PY

diagnostic_context() {
    python3 -B - "$1" <<'KOTR_DIAGNOSTIC'
import pathlib
import re
import sys

limit = 65536
try:
    with pathlib.Path(sys.argv[1]).open('rb') as source:
        source.seek(0, 2)
        size = source.tell()
        offset = max(0, size - limit)
        source.seek(offset)
        raw = source.read(limit)
    if offset:
        raw = raw.split(b'\n', 1)[-1]
    text = raw.decode('utf-8', errors='replace')
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
    text = re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', ' ', text)
    text = re.sub(r'(?s)-----BEGIN [A-Z0-9 ]+-----.*?(?:-----END [A-Z0-9 ]+-----|$)', '[REDACTED_PEM]', text)
    text = re.sub(r'(?m)^\s*[A-Za-z0-9+/=]{32,}\s*$', '[REDACTED_ENCODED_LINE]', text)
    text = re.sub(r"""(?i)\b(?:Basic|Bearer)\s+[^\s,;"'<>]+""", '[REDACTED_AUTHORIZATION]', text)
    text = re.sub(r'\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b', '[REDACTED_GITHUB_TOKEN]', text)
    text = re.sub(r'(?i)[0-9a-f]{64}', '[REDACTED_HEX64]', text)
    text = re.sub(r'Aa7![A-Za-z0-9_-]{28}', '[REDACTED_CLOUD_CREDENTIAL]', text)
    text = re.sub(r'(?<![A-Za-z0-9_!-])[A-Za-z0-9_!-]{32}(?![A-Za-z0-9_!-])', '[REDACTED_TOKEN32]', text)
    text = re.sub(r'(?is)(<(?:password|passwd|pwd|token|secret|api[_-]?key)[^>]*>).*?(</(?:password|passwd|pwd|token|secret|api[_-]?key)>)', r'\1[REDACTED_VALUE]\2', text)
    key = r'(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)'
    value = r'''"[^"\n]*"|'[^'\n]*'|[^\s"'&,;<>]+'''
    text = re.sub(r"""(?i)(""" + key + r"""["')]*\s*[:=]\s*)(?:""" + value + ')', r'\1[REDACTED_VALUE]', text)
    lines = text.splitlines()
    selected = set()
    for i, line in enumerate(lines):
        if re.search(r'(?i)ERROR|FATAL|EXCEPTION|SYNTAX|KOTR_CLOUD_(?:BOOTSTRAP|STAGE|POLICY)|COMPILATION', line):
            selected.update(range(max(0, i - 1), min(len(lines), i + 3)))
    context = '\n'.join(lines[i] for i in sorted(selected)[-160:])
    print('KOTR_CLOUD_BOOTSTRAP_CONTEXT_BEGIN')
    print(context.encode('utf-8')[:limit].decode('utf-8', errors='replace') or 'No matching compiler/status context in the bounded log tail.')
    print('KOTR_CLOUD_BOOTSTRAP_CONTEXT_END')
except Exception:
    print('KOTR_CLOUD_BOOTSTRAP_CONTEXT_UNAVAILABLE')
KOTR_DIAGNOSTIC
}

output=$(mktemp)
trap 'rm -f "$output"' EXIT
if ! iris session IRIS -U USER < /opt/kotr-cloud/bootstrap.script > "$output" 2>&1; then
    diagnostic_context "$output" || echo 'KOTR_CLOUD_BOOTSTRAP_CONTEXT_UNAVAILABLE'
    echo 'Cloud initialization failed.' >&2
    exit 1
fi
if ! grep -qx 'KOTR_CLOUD_BOOTSTRAP_OK' "$output"; then
    diagnostic_context "$output" || echo 'KOTR_CLOUD_BOOTSTRAP_CONTEXT_UNAVAILABLE'
    echo 'Cloud compilation, security setup or production start did not complete.' >&2
    exit 1
fi
# Release iris-main's hook pipes; the HTTP health check establishes readiness.
python3 -B /opt/kotr-cloud/provider.py </dev/null >/dev/null 2>&1 &
python3 -B /opt/kotr-cloud/broker.py </dev/null >/dev/null 2>&1 &
echo 'KOTR_CLOUD_SERVICES_STARTED'
