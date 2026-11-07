#!/bin/sh
set -eu
output=$(mktemp)
trap 'rm -f "$output"' EXIT

# Build 154 resolves the tool authorization during compile. bootstrap.script loads the policy
# first so the full class import can resolve it on a clean namespace. See the compile-order
# evidence in docs/INTEROPERABILITY.md. Recheck clean compile and both seat tools after changes.
if ! iris session IRIS -U USER < /opt/knaights/bootstrap.script > "$output" 2>&1; then
    cat "$output"
    exit 1
fi
cat "$output"
# The IRIS session can halt on an ObjectScript error. Require the marker written after
# compilation and production start. Recheck startup and a failed compile if this check changes.
if ! grep -qx 'KNAIGHTS_BOOTSTRAP_OK' "$output"; then
    echo 'KnAIghts compilation or production startup did not complete.' >&2
    exit 1
fi
