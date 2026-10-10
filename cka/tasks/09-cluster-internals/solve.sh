#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
F="$CKA_DIR/work/09-answers.txt"
cni=$(on $W2 'ls /etc/cni/net.d/*.conf* | head -1')
{
  echo "CNI_CONFIG=$cni"
  echo "CNI_PLUGIN=$(on $W2 "grep -m1 '\"type\"' $cni | cut -d'\"' -f4")"
  echo "CRI_ENDPOINT=$(on $W2 "grep containerRuntimeEndpoint /var/lib/kubelet/config.yaml | awk '{print \$2}'")"
  echo "POD_CIDR_WORKER2=$(k get node $W2 -o jsonpath='{.spec.podCIDR}')"
  echo "SERVICE_CIDR=$(on $CP "grep -o -- '--service-cluster-ip-range=[^ ]*' /etc/kubernetes/manifests/kube-apiserver.yaml | cut -d= -f2")"
  echo "ETCD_DATA_DIR=$(on $CP "grep -o -- '--data-dir=[^ ]*' /etc/kubernetes/manifests/etcd.yaml | cut -d= -f2")"
  echo "STATIC_POD_PATH=$(on $CP "grep staticPodPath /var/lib/kubelet/config.yaml | awk '{print \$2}'")"
} > "$F"
