#!/bin/sh
set -eu
umask 077
# Build154's password bootstrap expects this vendor utility at the bin alias.
# Resolve only inside the new owned container; retain original vendor bytes.
test -x /usr/irissys/csp/bin/CSPpwd
if [ ! -e /usr/irissys/bin/CSPpwd ]; then
  ln -s ../csp/bin/CSPpwd /usr/irissys/bin/CSPpwd
fi
test "$(readlink -f /usr/irissys/bin/CSPpwd)" = /usr/irissys/csp/bin/CSPpwd
mkdir -p /home/irisowner/knaights-bootstrap
cp /run/knaights/bootstrap-password.txt /home/irisowner/knaights-bootstrap/password.txt
