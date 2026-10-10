# Solution 20

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata: { name: retain-local }
provisioner: rancher.io/local-path
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: exports, namespace: handoff }
spec:
  storageClassName: retain-local
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 256Mi } }
---
apiVersion: v1
kind: Pod
metadata: { name: exporter, namespace: handoff }
spec:
  containers:
    - name: exporter
      image: busybox:1.36
      command: [sh, -c, "echo order,status > /exports/2026-10.csv && sleep 1d"]
      volumeMounts: [{ name: data, mountPath: /exports }]
  volumes:
    - name: data
      persistentVolumeClaim: { claimName: exports }
```

```sh
kubectl -n handoff get pvc exports            # Pending until the pod exists (WaitForFirstConsumer)
kubectl -n handoff get pvc exports -o jsonpath='{.spec.volumeName}' > cka/work/20-pv.txt
kubectl -n handoff delete pod exporter && kubectl -n handoff delete pvc exports
kubectl get pv                                 # STATUS Released, RECLAIM POLICY Retain
```

**Released is not Available:** a Released PV still has its old `claimRef`, so no new claim binds to
it until an admin decides. Either delete the PV (the data stays on disk with Retain) or clear
`spec.claimRef` to reuse it. `WaitForFirstConsumer` delays provisioning until a pod is scheduled,
so the volume is created on the node the pod lands on.
