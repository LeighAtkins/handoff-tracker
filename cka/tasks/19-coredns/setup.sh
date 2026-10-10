#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
cf=$(k -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}')
# Restore a clean Corefile first, then break the cluster domain.
cf=$(sed -e 's/cluster\.locl/cluster.local/' -e '/hosts {/,/}/d' <<<"$cf")
broken=$(sed 's/kubernetes cluster\.local/kubernetes cluster.locl/' <<<"$cf")
k -n kube-system create configmap coredns --from-literal=Corefile="$broken" --dry-run=client -o yaml | k apply -f - >/dev/null 2>&1
k -n kube-system rollout restart deploy/coredns >/dev/null && k -n kube-system rollout status deploy/coredns --timeout=120s >/dev/null
k -n $NS rollout restart deploy/handoff-web >/dev/null
sleep 10
