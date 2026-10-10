# 14: A bad rollout

**Domain:** Workloads and Scheduling · **Time:** 6 min

A release of the web app went out a few minutes ago and new pods are not starting.

1. Find out what changed and why the new pods fail.
2. Roll Deployment `handoff-web` back to the last working revision.
3. Write the revision number **of the broken rollout** to `cka/work/14-revision.txt`.
4. Make future rollouts safer: set the strategy to `maxUnavailable: 0`, `maxSurge: 1`.
