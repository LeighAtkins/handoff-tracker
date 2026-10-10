#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
expect "ConfigMap says Europe/London" Europe/London "$(k -n $NS get configmap handoff-config -o jsonpath='{.data.APP_TIME_ZONE}')"
check "web Deployment is fully rolled out" web_ready
pods=$(k -n $NS get pods -l app.kubernetes.io/component=web --field-selector=status.phase=Running -o name)
[ -n "$pods" ] || fail "no running web pods"
for p in $pods; do
  expect "$p has APP_TIME_ZONE=Europe/London" Europe/London "$(k -n $NS exec "$p" -c web -- printenv APP_TIME_ZONE 2>/dev/null)"
done
summary
