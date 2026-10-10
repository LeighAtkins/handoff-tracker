# Solution 13

```sh
kubectl -n handoff autoscale deploy handoff-web --min=2 --max=4 --cpu=60%
kubectl -n handoff get hpa handoff-web      # TARGETS shows cpu: N%/60% once metrics-server answers
kubectl top pods -n handoff                  # if this fails, the HPA can't work either

kubectl -n handoff create pdb handoff-web --selector=app.kubernetes.io/component=web --min-available=1

kubectl drain cka-worker --ignore-daemonsets --delete-emptydir-data
kubectl -n handoff get pods -o wide          # web rescheduled, never below 1 ready
kubectl uncordon cka-worker
```

**If the drain refuses:** "cannot delete Pods that declare no controller" means a bare pod (no
ReplicaSet, Job or StatefulSet) is on the node. It won't come back if evicted, so `kubectl drain`
wants `--force` to confirm you accept losing it.

**Why:**

- The HPA needs CPU **requests** on the pods, because utilisation is measured against them, and
  it needs metrics-server.
- `drain` uses the Eviction API, which honours PDBs. It waits rather than taking the last
  web pod down.
- The Postgres pod uses a PVC tied to its node by the local-path provisioner. If the drain moves
  it, it can't start elsewhere until the node comes back. That's a real lesson about local storage.
