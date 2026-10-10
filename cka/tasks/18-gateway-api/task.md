# 18: Route traffic with the Gateway API

**Domain:** Services and Networking · **Time:** 10 min

The setup installs Envoy Gateway and a GatewayClass `eg` (configured to give each Gateway a
ClusterIP Service, since kind has no load balancer). Route traffic to the app with the
Gateway API (no Ingress):

1. In `handoff`, create a Gateway `handoff-gw` using class `eg` with an HTTP listener on port 80
   for hostname `tracker.gw.local`.
2. Create an HTTPRoute `handoff` attached to that Gateway that sends `/` to Service `handoff-web` port 80.
3. Add a second rule: requests whose path starts with `/api/live` go to the same Service, but with
   a response header `X-Served-By: gateway`.

Test from your machine: port-forward the Envoy Service that Envoy Gateway creates for your Gateway
(in `envoy-gateway-system`) and curl it with `Host: tracker.gw.local`.
