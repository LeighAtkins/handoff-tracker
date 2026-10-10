#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n $NS delete svc handoff-web-internal --ignore-not-found >/dev/null
k -n $NS patch svc handoff-web --type json -p '[
  {"op":"replace","path":"/spec/selector/app.kubernetes.io~1component","value":"frontend"},
  {"op":"replace","path":"/spec/ports/0/targetPort","value":8080}]' >/dev/null
