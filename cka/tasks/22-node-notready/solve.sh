#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
on $W2 'sed -i "s#cka-control-plane:6444#cka-control-plane:6443#" /etc/kubernetes/kubelet.conf && systemctl enable --now kubelet >/dev/null 2>&1'
wait_for 90 bash -c "kubectl --context kind-$CLUSTER get node $W2 --no-headers | grep -q ' Ready '"
