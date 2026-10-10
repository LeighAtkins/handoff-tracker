#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
cat <<YAML | k apply -f -
apiVersion: v1
kind: PersistentVolume
metadata: { name: audit-archive }
spec:
  capacity: { storage: 1Gi }
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  local: { path: /mnt/audit-archive }
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - { key: kubernetes.io/hostname, operator: In, values: [cka-worker] }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: audit-archive, namespace: handoff }
spec:
  storageClassName: manual
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
YAML
k -n handoff wait --for=condition=Ready pod/archiver --timeout=120s
