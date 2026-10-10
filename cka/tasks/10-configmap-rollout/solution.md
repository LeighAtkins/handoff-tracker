# Solution 10

```sh
kubectl -n handoff edit configmap handoff-config        # or:
kubectl -n handoff patch configmap handoff-config --type merge -p '{"data":{"APP_TIME_ZONE":"Europe/London"}}'

kubectl -n handoff rollout restart deploy/handoff-web
kubectl -n handoff rollout status deploy/handoff-web
kubectl -n handoff exec deploy/handoff-web -c web -- printenv APP_TIME_ZONE
```

**Why a restart:** environment variables (`env`/`envFrom`) are read once, when the container
starts. ConfigMaps mounted as _volumes_ do update in place, after a short delay, but the app still
has to re-read the file. `rollout restart` replaces pods gradually, respecting the rollout
strategy. (The Helm chart uses a `checksum/config` annotation so that `helm upgrade` does this
automatically.)
