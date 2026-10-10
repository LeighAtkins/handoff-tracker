# 10: Change configuration and roll it out

**Domain:** Workloads and Scheduling · **Time:** 5 min

Staff in the UK will use the app for a while. Change the app's time zone to `Europe/London`.

- The setting is `APP_TIME_ZONE` in ConfigMap `handoff-config` (namespace `handoff`), which the web
  Deployment loads with `envFrom`.
- Change it with `kubectl` (not Helm), and make sure **every running web pod** uses the new value,
  without deleting the Deployment.
