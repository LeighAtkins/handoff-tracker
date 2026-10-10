#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
if ! k get deploy -n envoy-gateway-system envoy-gateway >/dev/null 2>&1; then
  echo "Installing Envoy Gateway v1.9.2 (includes the Gateway API CRDs)…"
  k apply --server-side --force-conflicts -f https://github.com/envoyproxy/gateway/releases/download/v1.9.2/install.yaml >/dev/null
  k -n envoy-gateway-system wait --for=condition=Available deploy/envoy-gateway --timeout=300s >/dev/null
fi
# kind has no load balancer, so have Envoy Gateway expose each Gateway with a ClusterIP Service.
# The Gateway then gets an address and reports Programmed.
cat <<YAML | k apply -f - >/dev/null
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: EnvoyProxy
metadata: { name: clusterip, namespace: envoy-gateway-system }
spec:
  provider:
    type: Kubernetes
    kubernetes:
      envoyService: { type: ClusterIP }
---
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata: { name: eg }
spec:
  controllerName: gateway.envoyproxy.io/gatewayclass-controller
  parametersRef:
    group: gateway.envoyproxy.io
    kind: EnvoyProxy
    name: clusterip
    namespace: envoy-gateway-system
YAML
k -n $NS delete httproute handoff --ignore-not-found >/dev/null 2>&1
k -n $NS delete gateway handoff-gw --ignore-not-found >/dev/null 2>&1
