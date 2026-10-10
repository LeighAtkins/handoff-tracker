#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
expect "HPA targets handoff-web, 2-4 replicas, 60% CPU" "Deployment/handoff-web 2 4 60" \
  "$(k -n $NS get hpa handoff-web -o jsonpath='{.spec.scaleTargetRef.kind}/{.spec.scaleTargetRef.name} {.spec.minReplicas} {.spec.maxReplicas} {.spec.metrics[0].resource.target.averageUtilization}' 2>/dev/null)"
check "HPA is reading CPU metrics" wait_for 90 bash -c "kubectl --context kind-$CLUSTER -n $NS get hpa handoff-web -o jsonpath='{.status.currentMetrics[0].resource.current.averageUtilization}' | grep -q '[0-9]'"
expect "PDB keeps at least 1 web pod" 1 "$(k -n $NS get pdb handoff-web -o jsonpath='{.spec.minAvailable}' 2>/dev/null)"
expect "PDB selects the web pods" web "$(k -n $NS get pdb handoff-web -o jsonpath='{.spec.selector.matchLabels.app\.kubernetes\.io/component}' 2>/dev/null)"
expect "cka-worker is schedulable again" "" "$(k get node $W1 -o jsonpath='{.spec.unschedulable}')"
canary=$(cat "$CKA_DIR/work/.13-canary" 2>/dev/null)
check "cka-worker was drained during this task" bash -c "[ -n '$canary' ] && ! kubectl --context kind-$CLUSTER -n default get pods -l app=drain-canary -o jsonpath='{.items[*].metadata.uid}' | grep -q '$canary'"
check "web is fully available" web_ready
summary
