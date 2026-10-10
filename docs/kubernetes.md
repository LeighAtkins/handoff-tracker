# Kubernetes and GitOps

`./scripts/kind-up.sh` takes a machine with Docker, kind and kubectl to a running cluster:

1. Creates a kind cluster (`infra/kind/cluster.yaml`) and publishes NodePort 30095 on `localhost:8095`.
2. Builds both images and loads them into the cluster. Fake data only: `data/` is in `.dockerignore`.
3. Installs metrics-server, so the HPA has CPU numbers.
4. Installs Argo CD and applies `infra/argocd/application.yaml`, which syncs `infra/helm/handoff-tracker`
   from `main` with `values.yaml` + `values-kind.yaml`, with automated prune and self-heal.

Then open http://localhost:8095 and sign in with the developer login.

## The release loop (GitOps)

```
PR → CI (lint, typecheck, tests, e2e, Trivy, helm lint) → merge to main
  → Release workflow: build + push ghcr.io/leighatkins/handoff-tracker-{web,worker}:sha-<commit>
  → commits the new tag to infra/helm/handoff-tracker/values.yaml
  → Argo CD sees the change on main and syncs
```

Git is the only way to change what runs. A manual `kubectl edit` is reverted by self-heal.
The kind values override the image with locally built `:kind` images, so the local cluster works
without registry credentials. An environment using plain `values.yaml` runs the CI-built tag.

## What each resource is for (CKAD notes)

| Resource                      | Why it is here                                                                                                                                                                                                        | CKAD topic                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Deployment** `web`          | Stateless Next.js server; rolling updates; `checksum/config` annotation rolls pods when the ConfigMap changes                                                                                                         | Deployments, rolling updates          |
| **initContainer** `migrate`   | Runs `prisma migrate deploy` before the web container starts. Prisma's advisory lock makes several pods starting together safe                                                                                        | Multi-container pods, init containers |
| **Probes**                    | _startup_ gives Next time to boot; _readiness_ (`/api/health`) drops a pod from the Service when the DB is unreachable; _liveness_ (`/api/live`) deliberately skips the DB, so a DB outage does not restart every pod | Liveness, readiness, startup probes   |
| **Resources**                 | Requests make scheduling honest; limits stop one pod starving the node                                                                                                                                                | Resource requests and limits          |
| **HPA**                       | Scales web on CPU (needs metrics-server)                                                                                                                                                                              | HorizontalPodAutoscaler               |
| **CronJob** `worker`          | One polling run every 5 minutes. `concurrencyPolicy: Forbid` means a slow run never overlaps the next, which would double calls to a free tier. `activeDeadlineSeconds` kills a hung run                              | Jobs and CronJobs                     |
| **Job** `seed`                | One-off fake-data load for kind only; `ttlSecondsAfterFinished` cleans it up                                                                                                                                          | Jobs                                  |
| **ConfigMap**                 | Non-secret settings, injected with `envFrom`                                                                                                                                                                          | ConfigMaps                            |
| **Secret** / `existingSecret` | Secrets injected with `envFrom`. In production the Secret is created outside the chart (External Secrets, Sealed Secrets) so values never pass through git or Helm                                                    | Secrets                               |
| **Service**                   | Stable name for web; NodePort in kind, ClusterIP behind an Ingress elsewhere                                                                                                                                          | Services                              |
| **Ingress** (optional)        | Host-based routing with TLS when a controller exists                                                                                                                                                                  | Ingress                               |
| **NetworkPolicy**             | Default-deny, then: web → DNS, DB, 443 (Google OAuth); worker/seed → DNS, DB, 443 (aggregator); Postgres accepts only web/worker/seed                                                                                 | NetworkPolicies                       |
| **securityContext**           | `runAsNonRoot` (images use numeric UIDs), `readOnlyRootFilesystem` with `emptyDir` for `/tmp` and the Next cache, all capabilities dropped, seccomp `RuntimeDefault`                                                  | SecurityContexts                      |
| **StatefulSet** `postgres`    | kind only: stable identity plus a PVC per replica. Production uses an external Postgres                                                                                                                               | StatefulSets, PVCs                    |

### Checks done on kind

```sh
# NetworkPolicy is enforced: a pod labelled as an unlisted component cannot reach Postgres…
kubectl -n handoff run np-test --rm -i --restart=Never --image=busybox:1.36 \
  --labels="app.kubernetes.io/name=handoff-tracker,app.kubernetes.io/instance=handoff-tracker,app.kubernetes.io/component=intruder" \
  -- nc -z -w 3 handoff-tracker-postgres 5432   # times out
# …while one labelled as web can (same command with component=web).

# Run the worker now instead of waiting for the schedule.
kubectl -n handoff create job --from=cronjob/handoff-tracker-worker manual-$(date +%s)

# Self-heal: delete the Deployment and watch Argo CD put it back.
kubectl -n handoff delete deployment handoff-tracker-web
```

## Production notes

- Postgres is external: set `secrets.existingSecret` with `DATABASE_URL`, and narrow
  `networkPolicy.externalDatabaseCidr` to the database's address.
- Set `config.appUrl`, `config.allowedEmailDomain` and the Google OAuth client. `config.authDevLogin`
  stays `false`.
- For the Comfort Works trial a single VM is cheaper and simpler (see [deployment.md](deployment.md)).
  The chart is for when the app outgrows that.
