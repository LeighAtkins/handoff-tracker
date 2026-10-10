#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
check "snapshot exists on cka-control-plane" on $CP 'test -s /opt/etcd-backup/snapshot.db'
check "snapshot is a valid etcd snapshot" on $CP 'etcdutl snapshot status /opt/etcd-backup/snapshot.db -w json'
keys=$(on $CP 'etcdutl snapshot status /opt/etcd-backup/snapshot.db -w json 2>/dev/null' | python3 -c 'import json,sys; print(json.load(sys.stdin)["totalKey"])' 2>/dev/null)
check "snapshot contains cluster data (${keys:-0} keys)" test "${keys:-0}" -gt 100
summary
