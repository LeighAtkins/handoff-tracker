# 03: Back up etcd

**Domain:** Cluster Architecture, Installation and Configuration · **Time:** 6 min

Before a risky change, take a snapshot of the cluster's etcd.

- Work on node `cka-control-plane` (`docker exec -it cka-control-plane bash` is this lab's `ssh`).
- Save the snapshot to `/opt/etcd-backup/snapshot.db` on that node using `etcdctl`, talking to
  etcd over TLS with the certificates the etcd static pod already uses.
