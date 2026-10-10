#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
D="deploy/prod-carrier-status"
check "overlay has a kustomization.yaml" test -f "$CKA_DIR/work/kustomize/prod/kustomization.yaml"
check "base was not edited" git -C "$CKA_DIR/.." diff --quiet -- cka/tasks/07-kustomize/base
check "prod-carrier-status exists in kustomize-prod" k -n kustomize-prod get $D
expect "3 replicas ready" 3 "$(k -n kustomize-prod get $D -o jsonpath='{.status.readyReplicas}' 2>/dev/null)"
expect "label env=prod on the Deployment" prod "$(k -n kustomize-prod get $D -o jsonpath='{.metadata.labels.env}' 2>/dev/null)"
expect "label env=prod in the selector" prod "$(k -n kustomize-prod get $D -o jsonpath='{.spec.selector.matchLabels.env}' 2>/dev/null)"
expect "cpu limit 100m" 100m "$(k -n kustomize-prod get $D -o jsonpath='{.spec.template.spec.containers[0].resources.limits.cpu}' 2>/dev/null)"
expect "memory limit 64Mi" 64Mi "$(k -n kustomize-prod get $D -o jsonpath='{.spec.template.spec.containers[0].resources.limits.memory}' 2>/dev/null)"
summary
