# 06: Install, upgrade and roll back a Helm release

**Domain:** Cluster Architecture, Installation and Configuration · **Time:** 10 min

Install a staging copy of the app from the chart in `infra/helm/handoff-tracker`.

1. Install release `handoff-staging` into a new namespace `staging`, using
   `cka/tasks/06-helm-release/staging-values.yaml` plus overrides: `web.replicas=1` and
   `worker.schedule="*/15 * * * *"`.
2. Upgrade the release to set `config.appTimeZone=Europe/London`, **keeping the earlier overrides**.
3. Someone decides London time was a mistake. Roll the release back to revision 1.

When you're done the release should be at revision 3, deployed, with time zone `Asia/Tokyo`, one
web replica, and the worker on `*/15 * * * *`.
