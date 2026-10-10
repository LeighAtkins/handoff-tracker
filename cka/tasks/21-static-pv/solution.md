# Solution 21

```yaml
apiVersion: v1
kind: PersistentVolume
metadata: { name: audit-archive }
spec:
  capacity: { storage: 1Gi }
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  local: { path: /mnt/audit-archive }
  nodeAffinity: # required for local volumes
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - { key: kubernetes.io/hostname, operator: In, values: [cka-worker] }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: audit-archive, namespace: handoff }
spec:
  storageClassName: manual # must match, or the default class would provision a new volume
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 500Mi } }
---
apiVersion: v1
kind: Pod
metadata: { name: archiver, namespace: handoff }
spec:
  containers:
    - name: archiver
      image: busybox:1.36
      command: [sleep, 1d]
      volumeMounts: [{ name: archive, mountPath: /archive, readOnly: true }]
  volumes:
    - name: archive
      persistentVolumeClaim: { claimName: audit-archive, readOnly: true }
```

**Binding rules:** a claim binds to a PV whose class, access modes and capacity (≥ request)
match. The claim gets the whole 1Gi even though it asked for 500Mi. The PV's node affinity is
what makes the scheduler put `archiver` on `cka-worker`. Compared with `hostPath`, `local` makes
that node dependency explicit.
