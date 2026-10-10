# Solution 12

```sh
kubectl create namespace sandbox
kubectl -n sandbox create quota compute \
  --hard=pods=4,requests.cpu=500m,requests.memory=512Mi,limits.cpu=1,limits.memory=1Gi

cat <<YAML | kubectl apply -f -
apiVersion: v1
kind: LimitRange
metadata: { name: defaults, namespace: sandbox }
spec:
  limits:
    - type: Container
      defaultRequest: { cpu: 100m, memory: 64Mi }
      default: { cpu: 200m, memory: 128Mi }       # "default" means default *limits*
YAML

kubectl -n sandbox create deployment probe --image=registry.k8s.io/pause:3.10 --replicas=6
kubectl -n sandbox get deploy probe                     # 4/6
kubectl -n sandbox describe rs -l app=probe | grep -A2 FailedCreate
kubectl -n sandbox get events --field-selector reason=FailedCreate -o jsonpath='{.items[-1].message}' > cka/work/12-reason.txt
```

**How they interact:** once a quota covers `requests.cpu` etc., every pod in the namespace _must_
declare them, or it's rejected. The LimitRange fills them in for pods that don't. The quota is
enforced at admission, so excess pods are never created; the ReplicaSet just keeps reporting
`FailedCreate`.
