# Solution 16

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: reporting }
spec:
  podSelector: {} # every pod in the namespace
  policyTypes: [Ingress, Egress] # no rules listed = nothing allowed
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
          podSelector: { matchLabels: { k8s-app: kube-dns } } # same list item = AND
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
    - to:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: handoff } }
          podSelector: { matchLabels: { app.kubernetes.io/component: web } }
      ports: [{ protocol: TCP, port: 3000 }]
```

**Traps:**

- `namespaceSelector` and `podSelector` in the **same** `to` item mean _pods matching X in
  namespaces matching Y_. As **separate** items (`- namespaceSelector…` and `- podSelector…`)
  they mean _either_.
- Egress rules see the **pod** port (3000), not the Service port (80), because the Service IP is
  translated before policy applies.
- Forget DNS and nothing works, even with the right rule for the app.
- Policies are additive allow-lists, so a "deny" is just the absence of an allow.
