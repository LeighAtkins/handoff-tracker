# Solution 26

```sh
kubectl -n handoff top pods --sort-by=memory | head -2
kubectl top nodes --sort-by=cpu | head -2

kubectl -n handoff get jobs --sort-by=.metadata.creationTimestamp      # newest last
kubectl -n handoff logs job/<newest> | grep worker.run > cka/work/26-worker.log
```

**Note:** the worker Jobs created from the CronJob carry the pod template's labels
(`app.kubernetes.io/component=worker`), which is the reliable way to find them. `kubectl logs
job/<name>` picks one of the Job's pods. `kubectl top` needs metrics-server; if it says "Metrics
API not available", that _is_ the thing to troubleshoot.
