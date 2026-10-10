# Solution 25

```sh
kubectl -n handoff get jobs,pods -l app.kubernetes.io/component=worker
kubectl -n handoff describe pod <worker-pod> | grep -A4 'Last State\|State'
#   Reason: OOMKilled   Exit Code: 137
kubectl -n handoff get cronjob handoff-worker -o jsonpath='{.spec.jobTemplate.spec.template.spec.containers[0].resources}'
#   limits.memory: 24Mi  ← Node.js needs far more than that just to start

kubectl -n handoff edit cronjob handoff-worker      # limits.memory: 512Mi, requests.memory: 192Mi
kubectl -n handoff create job worker-verify --from=cronjob/handoff-worker
kubectl -n handoff wait --for=condition=complete job/worker-verify
```

**Recognising OOMKilled:** exit code 137 (128 + SIGKILL), reason `OOMKilled` in the container's
last state. `kubectl top pod` shows normal usage when it isn't dying. Changing a CronJob only
affects Jobs created after the change; existing failed Jobs keep their old spec.
