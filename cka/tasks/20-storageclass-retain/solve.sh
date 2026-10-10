#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
cat <<YAML | k apply -f -
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
YAML
k -n handoff wait --for=condition=Ready pod/exporter --timeout=120s
sleep 2
k -n handoff get pvc exports -o jsonpath='{.spec.volumeName}' > "$CKA_DIR/work/20-pv.txt"
k -n handoff delete pod exporter --wait=true
k -n handoff delete pvc exports --wait=true
wait_for 30 test "$(k get pv "$(cat "$CKA_DIR/work/20-pv.txt")" -o jsonpath='{.status.phase}')" = Released
