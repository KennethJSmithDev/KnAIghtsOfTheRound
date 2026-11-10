#!/bin/sh
set -eu
output=$(iris session IRIS -U USER < /opt/knaights/seats/healthcheck.script)
case "$output" in *KOTR_SEAT_HEALTHY*) exit 0;; *) exit 1;; esac
