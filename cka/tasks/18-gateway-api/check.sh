#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
expect "Gateway handoff-gw uses class eg" eg "$(k -n $NS get gateway handoff-gw -o jsonpath='{.spec.gatewayClassName}' 2>/dev/null)"
expect "listener: HTTP 80 tracker.gw.local" "HTTP 80 tracker.gw.local" "$(k -n $NS get gateway handoff-gw -o jsonpath='{.spec.listeners[0].protocol} {.spec.listeners[0].port} {.spec.listeners[0].hostname}' 2>/dev/null)"
check "Gateway is Programmed" wait_for 120 bash -c "kubectl --context kind-$CLUSTER -n $NS get gateway handoff-gw -o jsonpath='{.status.conditions[?(@.type==\"Programmed\")].status}' | grep -q True"
expect "HTTPRoute is attached to handoff-gw" handoff-gw "$(k -n $NS get httproute handoff -o jsonpath='{.spec.parentRefs[0].name}' 2>/dev/null)"
check "HTTPRoute is Accepted" bash -c "kubectl --context kind-$CLUSTER -n $NS get httproute handoff -o jsonpath='{.status.parents[0].conditions[?(@.type==\"Accepted\")].status}' | grep -q True"
svc=$(k -n envoy-gateway-system get svc -l gateway.envoyproxy.io/owning-gateway-name=handoff-gw,gateway.envoyproxy.io/owning-gateway-namespace=$NS -o name 2>/dev/null | head -1)
if [ -n "$svc" ]; then
  k -n envoy-gateway-system wait --for=condition=Ready pod -l gateway.envoyproxy.io/owning-gateway-name=handoff-gw --timeout=120s >/dev/null 2>&1
  # Envoy pods are replaced when the Gateway changes; retry until a port-forward lands on a live one.
  ok=""
  for _ in 1 2 3 4 5 6; do
    k -n envoy-gateway-system port-forward "$svc" 18080:80 >/dev/null 2>&1 & pf=$!
    sleep 3
    if curl -fsS --max-time 5 -H 'Host: tracker.gw.local' http://127.0.0.1:18080/api/health >/dev/null 2>&1; then ok=1; break; fi
    kill $pf 2>/dev/null; wait $pf 2>/dev/null; sleep 5
  done
  check "the app answers through the Gateway" test -n "$ok"
  check "/api/live carries X-Served-By: gateway" bash -c "curl -fsSi --max-time 5 -H 'Host: tracker.gw.local' http://127.0.0.1:18080/api/live | grep -qi '^x-served-by: gateway'"
  check "/api/health does not carry the header" bash -c "! curl -fsSi --max-time 5 -H 'Host: tracker.gw.local' http://127.0.0.1:18080/api/health | grep -qi '^x-served-by'"
  kill $pf 2>/dev/null
else
  fail "no Envoy Service for handoff-gw yet"
fi
summary
