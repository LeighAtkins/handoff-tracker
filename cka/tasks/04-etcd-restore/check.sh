#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
check "API server answers" wait_for 60 k get --raw /readyz
check "ConfigMap release-notes is back" k -n default get configmap release-notes
check "ConfigMap bad-change is gone" bash -c "! kubectl --context kind-$CLUSTER -n default get configmap bad-change"
check "etcd uses the new data directory /var/lib/etcd-restore" on $CP "grep -q 'path: /var/lib/etcd-restore' /etc/kubernetes/manifests/etcd.yaml"
check "all nodes are Ready" bash -c "! kubectl --context kind-$CLUSTER get nodes --no-headers | grep -v ' Ready '"
summary
