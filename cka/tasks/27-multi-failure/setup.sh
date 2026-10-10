#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
# 1. The Service sends traffic to the wrong port.
k -n $NS patch svc handoff-web --type json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":3001}]' >/dev/null
# 2. The web NetworkPolicy now only admits traffic on that wrong port.
k -n $NS patch netpol handoff-web --type json -p '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":3001}]' >/dev/null
# 3. The readiness probe points at a path that doesn't exist.
k -n $NS patch deploy handoff-web --type json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/api/healthz"}]' >/dev/null
sleep 20
