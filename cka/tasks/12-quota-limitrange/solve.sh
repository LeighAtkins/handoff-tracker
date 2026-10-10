#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k create namespace sandbox
k -n sandbox create quota compute --hard=pods=4,requests.cpu=500m,requests.memory=512Mi,limits.cpu=1,limits.memory=1Gi
cat <<YAML | k apply -f -
apiVersion: v1
kind: LimitRange
metadata: { name: defaults, namespace: sandbox }
spec:
  limits:
    - type: Container
      defaultRequest: { cpu: 100m, memory: 64Mi }
      default: { cpu: 200m, memory: 128Mi }
YAML
k -n sandbox create deployment probe --image=registry.k8s.io/pause:3.10 --replicas=6
wait_for 90 test "$(k -n sandbox get deploy probe -o jsonpath='{.status.readyReplicas}')" = 4
wait_for 60 bash -c "kubectl --context kind-$CLUSTER -n sandbox get events --field-selector reason=FailedCreate -o jsonpath='{.items[0].message}' | grep -q quota"
k -n sandbox get events --field-selector reason=FailedCreate -o jsonpath='{.items[-1].message}' > "$CKA_DIR/work/12-reason.txt"
