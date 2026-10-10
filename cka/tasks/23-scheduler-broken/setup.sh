#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
on $CP "sed -i 's#--kubeconfig=/etc/kubernetes/scheduler.conf#--kubeconfig=/etc/kubernetes/scheduller.conf#' /etc/kubernetes/manifests/kube-scheduler.yaml"
sleep 20
k -n $NS rollout restart deploy/handoff-web >/dev/null
sleep 5
