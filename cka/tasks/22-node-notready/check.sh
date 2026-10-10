#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
check "cka-worker2 is Ready" wait_for 60 bash -c "kubectl --context kind-$CLUSTER get node $W2 --no-headers | grep -q ' Ready '"
expect "kubelet is running" active "$(on $W2 'systemctl is-active kubelet')"
expect "kubelet starts on boot" enabled "$(on $W2 'systemctl is-enabled kubelet')"
check "kubelet.conf points at the API server port 6443" on $W2 "grep -q 'server: https://cka-control-plane:6443' /etc/kubernetes/kubelet.conf"
summary
