# Solution 06

```sh
helm install handoff-staging infra/helm/handoff-tracker -n staging --create-namespace \
  -f cka/tasks/06-helm-release/staging-values.yaml \
  --set web.replicas=1 --set worker.schedule="*/15 * * * *"

helm upgrade handoff-staging infra/helm/handoff-tracker -n staging \
  --reuse-values --set config.appTimeZone=Europe/London

helm history handoff-staging -n staging
helm rollback handoff-staging 1 -n staging
helm history handoff-staging -n staging       # revision 3: "Rollback to 1"
```

**Gotcha:** without `--reuse-values` (or repeating `-f` and every `--set`), `helm upgrade` starts
from the chart defaults and silently drops your earlier overrides. A rollback is a _new_
revision, so the history keeps moving forward.
