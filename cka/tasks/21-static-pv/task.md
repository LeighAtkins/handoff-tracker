# 21: A pre-provisioned local volume

**Domain:** Storage · **Time:** 8 min

An audit archive already lives on disk at `/mnt/audit-archive` on node `cka-worker`. Expose it to
the cluster without dynamic provisioning:

1. Create a PersistentVolume `audit-archive`: 1Gi, `ReadWriteOnce`, reclaim policy `Retain`,
   storage class `manual`, type `local` at `/mnt/audit-archive`, only usable from `cka-worker`.
2. In `handoff`, create a PVC `audit-archive` requesting 500Mi from class `manual` that binds to it.
3. Run a pod `archiver` (image `busybox:1.36`, command `sleep 1d`) that mounts the claim
   **read-only** at `/archive`.

The pod must be able to read `/archive/README` (it's already on disk).
