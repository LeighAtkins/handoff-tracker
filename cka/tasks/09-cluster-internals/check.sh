#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
F="$CKA_DIR/work/09-answers.txt"
get() { sed -n "s/^$1=//p" "$F" 2>/dev/null | head -1 | tr -d '[:space:]'; }
cni_file=$(on $W2 'ls /etc/cni/net.d/*.conf* | head -1')
expect CNI_CONFIG "$cni_file" "$(get CNI_CONFIG)"
expect CNI_PLUGIN "$(on $W2 "python3 -c 'import json; print(json.load(open(\"$cni_file\"))[\"plugins\"][0][\"type\"])'" 2>/dev/null || on $W2 "grep -m1 '\"type\"' $cni_file | cut -d'\"' -f4")" "$(get CNI_PLUGIN)"
expect CRI_ENDPOINT "$(on $W2 "grep containerRuntimeEndpoint /var/lib/kubelet/config.yaml | awk '{print \$2}'")" "$(get CRI_ENDPOINT)"
expect POD_CIDR_WORKER2 "$(k get node $W2 -o jsonpath='{.spec.podCIDR}')" "$(get POD_CIDR_WORKER2)"
expect SERVICE_CIDR "$(on $CP "grep -o -- '--service-cluster-ip-range=[^ ]*' /etc/kubernetes/manifests/kube-apiserver.yaml | cut -d= -f2")" "$(get SERVICE_CIDR)"
expect ETCD_DATA_DIR "$(on $CP "grep -o -- '--data-dir=[^ ]*' /etc/kubernetes/manifests/etcd.yaml | cut -d= -f2")" "$(get ETCD_DATA_DIR)"
expect STATIC_POD_PATH "$(on $CP "grep staticPodPath /var/lib/kubelet/config.yaml | awk '{print \$2}'")" "$(get STATIC_POD_PATH)"
summary
