#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
check "manifest points at scheduler.conf" on $CP "grep -q -- '--kubeconfig=/etc/kubernetes/scheduler.conf' /etc/kubernetes/manifests/kube-scheduler.yaml"
check "kube-scheduler is Running and Ready" wait_for 90 bash -c "kubectl --context kind-$CLUSTER -n kube-system get pod kube-scheduler-$CP -o jsonpath='{.status.containerStatuses[0].ready}' | grep -q true"
check "no Pending pods in handoff" wait_for 120 bash -c "! kubectl --context kind-$CLUSTER -n $NS get pods --field-selector=status.phase=Pending -o name | grep -q ."
check "web is fully rolled out" wait_for 180 web_ready
summary
