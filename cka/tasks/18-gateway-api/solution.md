# Solution 18

```yaml
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
```

```sh
kubectl -n handoff get gateway,httproute
kubectl -n handoff describe httproute handoff        # parents: Accepted / ResolvedRefs
SVC=$(kubectl -n envoy-gateway-system get svc -l gateway.envoyproxy.io/owning-gateway-name=handoff-gw -o name)
kubectl -n envoy-gateway-system port-forward $SVC 18080:80 &
curl -i -H 'Host: tracker.gw.local' localhost:18080/api/live
```

**Mental model:**

- **GatewayClass** (cluster-wide) = which controller.
- **Gateway** = the listener and load balancer. Usually owned by the platform team.
- **HTTPRoute** = routing rules. Usually owned by the app team, attached via `parentRefs`.

When rules overlap, the longest path match wins. Header changes, redirects and traffic splits are
standard `filters` and `backendRefs` weights, not annotations as with Ingress.
