#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n handoff patch svc handoff-web --type json -p '[
  {"op":"replace","path":"/spec/selector/app.kubernetes.io~1component","value":"web"},
  {"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
k -n handoff expose deploy handoff-web --name=handoff-web-internal --port=8080 --target-port=3000 --type=ClusterIP
