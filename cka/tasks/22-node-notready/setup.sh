#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
on $W2 'sed -i "s#server: https://cka-control-plane:6443#server: https://cka-control-plane:6444#" /etc/kubernetes/kubelet.conf
        systemctl stop kubelet; systemctl disable kubelet >/dev/null 2>&1'
wait_for 90 bash -c "kubectl --context kind-$CLUSTER get node $W2 --no-headers | grep -q NotReady"
