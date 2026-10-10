#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
O="$CKA_DIR/work/kustomize/prod"; mkdir -p "$O"
cat > "$O/kustomization.yaml" <<YAML
resources:
  - ../../../tasks/07-kustomize/base
namespace: kustomize-prod
namePrefix: prod-
labels:
  - pairs: { env: prod }
    includeSelectors: true
    includeTemplates: true
replicas:
  - name: carrier-status
    count: 3
patches:
  - path: limits.yaml
YAML
cat > "$O/limits.yaml" <<YAML
apiVersion: apps/v1
kind: Deployment
metadata: { name: carrier-status }
spec:
  template:
    spec:
      containers:
        - name: status
          resources:
            limits: { cpu: 100m, memory: 64Mi }
YAML
k create namespace kustomize-prod
k apply -k "$O"
k -n kustomize-prod rollout status deploy/prod-carrier-status --timeout=90s
