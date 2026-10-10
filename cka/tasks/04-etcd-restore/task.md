# 04: Restore etcd from a snapshot (destructive)

**Domain:** Cluster Architecture, Installation and Configuration · **Time:** 15 min · **Run `cka/lab.sh reset` afterwards if anything goes wrong**

Someone ran a bad change: ConfigMap `release-notes` in `default` was deleted and a ConfigMap
`bad-change` was created. A snapshot taken just before is at `/opt/etcd-backup/pre-change.db` on
`cka-control-plane`.

Restore etcd from that snapshot so that `release-notes` exists again and `bad-change` does not.
Restore into a **new** data directory, `/var/lib/etcd-restore`, and point the etcd static pod at it.
