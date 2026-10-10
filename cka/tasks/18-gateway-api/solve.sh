#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
cat <<YAML | k apply -f -
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata: { name: handoff-gw, namespace: handoff }
spec:
  gatewayClassName: eg
  listeners:
    - { name: http, protocol: HTTP, port: 80, hostname: tracker.gw.local }
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: handoff, namespace: handoff }
spec:
  parentRefs: [{ name: handoff-gw }]
  hostnames: [tracker.gw.local]
  rules:
    - matches: [{ path: { type: PathPrefix, value: /api/live } }]
      filters:
        - type: ResponseHeaderModifier
          responseHeaderModifier: { add: [{ name: X-Served-By, value: gateway }] }
      backendRefs: [{ name: handoff-web, port: 80 }]
    - matches: [{ path: { type: PathPrefix, value: / } }]
      backendRefs: [{ name: handoff-web, port: 80 }]
YAML
wait_for 120 bash -c "kubectl --context kind-$CLUSTER -n handoff get gateway handoff-gw -o jsonpath='{.status.conditions[?(@.type==\"Programmed\")].status}' | grep -q True"
wait_for 120 bash -c "kubectl --context kind-$CLUSTER -n envoy-gateway-system get pods -l gateway.envoyproxy.io/owning-gateway-name=handoff-gw -o jsonpath='{.items[0].status.containerStatuses[*].ready}' | grep -qv false"
