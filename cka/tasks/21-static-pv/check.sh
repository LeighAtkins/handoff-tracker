#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
expect "PV audit-archive: 1Gi RWO Retain manual" "1Gi ReadWriteOnce Retain manual" "$(k get pv audit-archive -o jsonpath='{.spec.capacity.storage} {.spec.accessModes[0]} {.spec.persistentVolumeReclaimPolicy} {.spec.storageClassName}' 2>/dev/null)"
expect "PV is a local volume at /mnt/audit-archive" /mnt/audit-archive "$(k get pv audit-archive -o jsonpath='{.spec.local.path}' 2>/dev/null)"
expect "PV is pinned to cka-worker" $W1 "$(k get pv audit-archive -o jsonpath='{.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].values[0]}' 2>/dev/null)"
expect "PVC is bound to audit-archive" "Bound audit-archive" "$(k -n $NS get pvc audit-archive -o jsonpath='{.status.phase} {.spec.volumeName}' 2>/dev/null)"
expect "archiver runs on cka-worker" $W1 "$(k -n $NS get pod archiver -o jsonpath='{.spec.nodeName}' 2>/dev/null)"
check "archiver can read /archive/README" k -n $NS exec archiver -- cat /archive/README
check "the mount is read-only" bash -c "! kubectl --context kind-$CLUSTER -n $NS exec archiver -- touch /archive/x"
summary
