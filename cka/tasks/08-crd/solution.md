# Solution 08

```sh
kubectl apply -f cka/tasks/08-crd/carrierroute-crd.yaml
kubectl wait --for=condition=Established crd/carrierroutes.handoff.dev

cat <<YAML | kubectl apply -f -
apiVersion: handoff.dev/v1alpha1
kind: CarrierRoute
metadata: { name: px-to-sagawa, namespace: handoff }
spec: { from: 4PX, to: SAGAWA, quietHoursAfterHandoff: 120 }
YAML

kubectl api-resources --api-group=handoff.dev          # SHORTNAMES column: crt
kubectl get crt -n handoff                             # printer columns from the CRD
kubectl explain carrierroute.spec.quietHoursAfterHandoff > cka/work/08-explain.txt
```

**Operators:** a CRD only teaches the API server a new type. An _operator_ is a controller that
watches those objects and acts on them. In the exam you may be asked to install one (often with
Helm) and then create its custom resources. `kubectl get crd` and `kubectl api-resources` show
what it added.
