#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
cat <<YAML | k apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: reporting }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: reporter-egress, namespace: reporting }
spec:
  podSelector: { matchLabels: { app: reporter } }
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } }
          podSelector: { matchLabels: { k8s-app: kube-dns } }
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
    - to:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: handoff } }
          podSelector: { matchLabels: { app.kubernetes.io/component: web } }
      ports: [{ protocol: TCP, port: 3000 }]
YAML
