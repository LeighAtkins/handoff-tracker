#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
V=v1.36.4
on $CP "curl -fsSLo /usr/bin/kubeadm https://dl.k8s.io/release/$V/bin/linux/amd64/kubeadm && chmod +x /usr/bin/kubeadm && kubeadm upgrade apply $V -y >/tmp/upgrade.log 2>&1"
k drain $CP --ignore-daemonsets --delete-emptydir-data >/dev/null
on $CP "curl -fsSLo /usr/bin/kubelet.new https://dl.k8s.io/release/$V/bin/linux/amd64/kubelet && curl -fsSLo /usr/bin/kubectl https://dl.k8s.io/release/$V/bin/linux/amd64/kubectl && chmod +x /usr/bin/kubelet.new /usr/bin/kubectl && systemctl stop kubelet && mv /usr/bin/kubelet.new /usr/bin/kubelet && systemctl daemon-reload && systemctl start kubelet"
wait_for 180 bash -c "kubectl --context kind-$CLUSTER get node $CP -o jsonpath='{.status.nodeInfo.kubeletVersion}' | grep -q $V"
k uncordon $CP >/dev/null
wait_for 120 bash -c "! kubectl --context kind-$CLUSTER get nodes --no-headers | grep -v ' Ready '"
