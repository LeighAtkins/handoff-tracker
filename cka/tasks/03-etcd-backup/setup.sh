#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
on $CP 'rm -f /opt/etcd-backup/snapshot.db'
