#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
expect "API server is v1.36.4" v1.36.4 "$(k version -o json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["serverVersion"]["gitVersion"])' 2>/dev/null)"
expect "control plane kubelet is v1.36.4" v1.36.4 "$(k get node $CP -o jsonpath='{.status.nodeInfo.kubeletVersion}')"
expect "workers still on v1.35.8" "v1.35.8 v1.35.8" "$(k get node $W1 $W2 -o jsonpath='{.items[*].status.nodeInfo.kubeletVersion}')"
expect "control plane is schedulable again" "" "$(k get node $CP -o jsonpath='{.spec.unschedulable}')"
check "all nodes are Ready" bash -c "! kubectl --context kind-$CLUSTER get nodes --no-headers | grep -v ' Ready '"
summary
