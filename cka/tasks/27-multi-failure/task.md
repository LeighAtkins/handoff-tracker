# 27: Everything is down (several faults)

**Domain:** Troubleshooting · **Time:** 15 min

Users report that http://localhost:8097 is down. Several changes went out together; more than one
thing is broken. Restore the app so that:

- `curl http://localhost:8097/api/health` returns `{"ok":true}`
- the web Deployment is fully available with 2 replicas
- the NetworkPolicies still protect the app (don't delete them)
