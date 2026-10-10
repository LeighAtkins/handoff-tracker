# 25: The worker keeps failing

**Domain:** Troubleshooting · **Time:** 8 min

Since a "cost optimisation", every run of CronJob `handoff-worker` fails within seconds.

1. Find out why the worker's pods fail.
2. Fix the CronJob with the smallest sensible change (give the container a memory limit of at least `256Mi`).
3. Prove it: create a Job `worker-verify` from the CronJob and let it complete.
