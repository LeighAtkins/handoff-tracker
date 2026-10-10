#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
on $CP 'mkdir -p /opt/etcd-backup && ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key snapshot save /opt/etcd-backup/snapshot.db'
