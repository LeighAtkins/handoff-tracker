#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n handoff patch svc handoff-web --type json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
k -n handoff patch netpol handoff-web --type json -p '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":3000}]'
k -n handoff patch deploy handoff-web --type json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/api/health"}]'
k -n handoff rollout status deploy/handoff-web --timeout=240s
