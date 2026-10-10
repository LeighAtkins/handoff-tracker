#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
cf=$(k -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}')
fixed=$(sed 's/kubernetes cluster\.locl/kubernetes cluster.local/' <<<"$cf" | awk '{print} /^\.:53 \{/{print "    hosts {\n       192.0.2.10 ship24.cka.test\n       fallthrough\n    }"}')
k -n kube-system create configmap coredns --from-literal=Corefile="$fixed" --dry-run=client -o yaml | k apply -f -
k -n kube-system rollout restart deploy/coredns && k -n kube-system rollout status deploy/coredns --timeout=120s
k -n handoff rollout restart deploy/handoff-web && k -n handoff rollout status deploy/handoff-web --timeout=240s
