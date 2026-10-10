#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k apply -f "$CKA_DIR/tasks/08-crd/carrierroute-crd.yaml"
k wait --for=condition=Established crd/carrierroutes.handoff.dev --timeout=60s
cat <<YAML | k apply -f -
apiVersion: handoff.dev/v1alpha1
kind: CarrierRoute
metadata: { name: px-to-sagawa, namespace: handoff }
spec: { from: 4PX, to: SAGAWA, quietHoursAfterHandoff: 120 }
YAML
k api-resources --api-group=handoff.dev --no-headers | awk '{print $2}' > "$CKA_DIR/work/08-shortname.txt"
wait_for 30 bash -c "kubectl --context kind-$CLUSTER explain carrierroute.spec.quietHoursAfterHandoff > '$CKA_DIR/work/08-explain.txt'"
