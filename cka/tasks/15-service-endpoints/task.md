# 15: The app is unreachable

**Domain:** Services and Networking · **Time:** 8 min

After a "small tidy-up" of Service `handoff-web` in `handoff`, http://localhost:8097 stopped
answering. The pods are fine.

1. Fix the Service so traffic reaches the web pods again on port 80 (NodePort `30095`).
   Don't change the Deployment.
2. Add a second Service `handoff-web-internal` of type ClusterIP that exposes the web pods on
   port `8080`, for other teams inside the cluster.
