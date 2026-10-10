# Solution 11

```sh
kubectl label node cka-worker2 pool=batch
kubectl taint node cka-worker2 workload=batch:NoSchedule

kubectl -n handoff edit cronjob handoff-worker
#   spec.jobTemplate.spec.template.spec:
#     tolerations:
#     - { key: workload, operator: Equal, value: batch, effect: NoSchedule }
#     nodeSelector: { pool: batch }          # or requiredDuringScheduling nodeAffinity

# NoSchedule doesn't evict pods already there. Reschedule web so none stay on worker2:
kubectl -n handoff rollout restart deploy/handoff-web
kubectl -n handoff get pods -o wide

kubectl -n handoff create job worker-on-batch --from=cronjob/handoff-worker
kubectl -n handoff get pods -l job-name=worker-on-batch -o wide
```

**The two halves:** a _taint_ keeps other pods off the node; a _toleration_ only **allows** a pod
onto it, it doesn't send it there. The nodeSelector or affinity is what **attracts** the worker.
You need both for a dedicated node. Use `NoExecute` instead of `NoSchedule` if existing pods
should be evicted too.
