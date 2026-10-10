#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
expect "StorageClass retain-local" "rancher.io/local-path Retain WaitForFirstConsumer" "$(k get sc retain-local -o jsonpath='{.provisioner} {.reclaimPolicy} {.volumeBindingMode}' 2>/dev/null)"
pv=$(tr -d '[:space:]' < "$CKA_DIR/work/20-pv.txt" 2>/dev/null)
check "PV name recorded" test -n "$pv"
expect "the PV belonged to handoff/exports" "handoff/exports" "$(k get pv "$pv" -o jsonpath='{.spec.claimRef.namespace}/{.spec.claimRef.name}' 2>/dev/null)"
expect "the PV outlived its claim (Released, Retain)" "Released Retain" "$(k get pv "$pv" -o jsonpath='{.status.phase} {.spec.persistentVolumeReclaimPolicy}' 2>/dev/null)"
check "the claim and pod are gone" bash -c "! kubectl --context kind-$CLUSTER -n $NS get pvc exports && ! kubectl --context kind-$CLUSTER -n $NS get pod exporter"
path=$(k get pv "$pv" -o jsonpath='{.spec.hostPath.path}{.spec.local.path}' 2>/dev/null)
node=$(k get pv "$pv" -o jsonpath='{.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].values[0]}' 2>/dev/null)
check "2026-10.csv is still on disk ($node:$path)" on "${node:-none}" "test -f '$path/2026-10.csv'"
summary
