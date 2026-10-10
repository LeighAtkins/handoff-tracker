#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
mkdir -p "$CKA_DIR/work"
k -n $NS delete hpa handoff-web --ignore-not-found >/dev/null
k -n $NS delete pdb handoff-web --ignore-not-found >/dev/null
k uncordon $W1 >/dev/null
k -n $NS scale deploy handoff-web --replicas=2 >/dev/null
# A canary pinned to cka-worker: a drain evicts it, which is how the check knows a drain happened.
k -n default delete deploy drain-canary --ignore-not-found --wait=true >/dev/null
cat <<YAML | k apply -f - >/dev/null
apiVersion: apps/v1
kind: Deployment
metadata: { name: drain-canary, namespace: default }
spec:
  selector: { matchLabels: { app: drain-canary } }
  template:
    metadata: { labels: { app: drain-canary } }
    spec:
      nodeSelector: { kubernetes.io/hostname: cka-worker }
      containers: [{ name: pause, image: "registry.k8s.io/pause:3.10" }]
YAML
k -n default rollout status deploy/drain-canary --timeout=120s >/dev/null
k -n default get pods -l app=drain-canary --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.uid}' > "$CKA_DIR/work/.13-canary"
