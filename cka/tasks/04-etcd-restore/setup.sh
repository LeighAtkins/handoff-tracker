#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n default delete configmap release-notes bad-change --ignore-not-found >/dev/null
k -n default create configmap release-notes --from-literal=version=1.0 >/dev/null
on $CP 'rm -rf /var/lib/etcd-restore; mkdir -p /opt/etcd-backup && etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key snapshot save /opt/etcd-backup/pre-change.db >/dev/null 2>&1'
k -n default delete configmap release-notes >/dev/null
k -n default create configmap bad-change --from-literal=oops=true >/dev/null
