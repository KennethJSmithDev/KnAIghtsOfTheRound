#!/bin/sh
set -eu
output=$(iris session IRIS -U USER < /opt/knaights/seats/start.script)
printf '%s\n' "$output"
case "$output" in *KOTR_SEAT_PRODUCTION_STARTED*) exit 0;; *) exit 1;; esac
