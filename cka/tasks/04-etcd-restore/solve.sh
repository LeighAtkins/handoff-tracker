#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
on $CP 'etcdutl snapshot restore /opt/etcd-backup/pre-change.db --data-dir /var/lib/etcd-restore >/dev/null 2>&1 &&
  sed -i "s#path: /var/lib/etcd\$#path: /var/lib/etcd-restore#" /etc/kubernetes/manifests/etcd.yaml'
wait_for 180 k -n default get configmap release-notes
