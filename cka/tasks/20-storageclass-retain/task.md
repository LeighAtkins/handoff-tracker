# 20: Dynamic provisioning that keeps the data

**Domain:** Storage · **Time:** 10 min

Monthly export files must survive even if someone deletes the claim.

1. Create a StorageClass `retain-local` using provisioner `rancher.io/local-path`, reclaim policy
   `Retain`, binding mode `WaitForFirstConsumer`.
2. In `handoff`, create a PVC `exports` (256Mi, ReadWriteOnce) using that class.
3. Run a pod `exporter` (image `busybox:1.36`) that mounts it at `/exports` and writes the file
   `/exports/2026-10.csv`, then keeps running (`sleep 1d`).
4. Delete the pod and the PVC. Confirm the PersistentVolume still exists, and write its name to
   `cka/work/20-pv.txt`.
