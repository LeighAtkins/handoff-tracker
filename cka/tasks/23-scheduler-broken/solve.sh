#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
on $CP "sed -i 's#scheduller.conf#scheduler.conf#' /etc/kubernetes/manifests/kube-scheduler.yaml"
wait_for 120 bash -c "kubectl --context kind-$CLUSTER -n kube-system get pod kube-scheduler-$CP -o jsonpath='{.status.containerStatuses[0].ready}' | grep -q true"
k -n handoff rollout status deploy/handoff-web --timeout=240s
