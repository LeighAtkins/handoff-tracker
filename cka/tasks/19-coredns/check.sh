#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
check "Corefile serves cluster.local" bash -c "kubectl --context kind-$CLUSTER -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -q 'kubernetes cluster.local'"
check "CoreDNS is available" k -n kube-system rollout status deploy/coredns --timeout=60s
check "web Deployment is fully available" wait_for 180 web_ready
out=$(k run dns-probe-$RANDOM --rm -i --restart=Never --image=busybox:1.36 -q -- sh -c 'nslookup handoff-postgres.handoff.svc.cluster.local; nslookup ship24.cka.test' 2>/dev/null)
check "Service names resolve" grep -q "handoff-postgres.handoff.svc.cluster.local" <<<"$out"
check "ship24.cka.test resolves to 192.0.2.10" grep -q "192.0.2.10" <<<"$out"
summary
