# Solution 24

```sh
kubectl -n handoff get pods                           # Init:CrashLoopBackOff / Init:Error
kubectl -n handoff logs <pod> -c migrate              # P1000: Authentication failed for user "handoff"
kubectl -n handoff logs <pod> -c migrate --previous   # output of the last failed attempt

kubectl -n handoff get secret handoff-secrets -o jsonpath='{.data.DATABASE_URL}' | base64 -d
kubectl -n handoff get sts handoff-postgres -o yaml | grep -A1 POSTGRES_PASSWORD   # the real one

kubectl -n handoff edit secret handoff-secrets        # or patch with stringData (no base64 by hand):
kubectl -n handoff patch secret handoff-secrets --type merge \
  -p '{"stringData":{"DATABASE_URL":"postgresql://handoff:handoff@handoff-postgres:5432/handoff?schema=public"}}'
kubectl -n handoff rollout restart deploy/handoff-web
```

**Reading container output:**

- `kubectl logs <pod> -c <container>` picks the container. Init containers count.
- `--previous` shows the crashed instance, and `-f` follows.
- `kubectl get events --sort-by=.lastTimestamp` gives the timeline.
- Secrets are base64-_encoded_, not encrypted. Use `stringData` to write plain values.
