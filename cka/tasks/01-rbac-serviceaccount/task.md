# 01: Read-only service account for a log shipper

**Domain:** Cluster Architecture, Installation and Configuration · **Time:** 6 min

A log shipper will run in namespace `handoff` and needs to read pods and their logs, nothing else.

1. Create a ServiceAccount `log-reader` in `handoff`.
2. Create a Role `pod-log-reader` in `handoff` that allows `get`, `list` and `watch` on `pods` and `pods/log`.
3. Bind it to the ServiceAccount with a RoleBinding `log-reader`.

The ServiceAccount must **not** be able to delete pods, read Secrets, or read pods in any other namespace.
