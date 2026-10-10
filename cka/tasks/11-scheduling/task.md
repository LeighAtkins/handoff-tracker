# 11: Dedicate a node to batch work

**Domain:** Workloads and Scheduling · **Time:** 10 min

The polling worker is bursty. Give it `cka-worker2` to itself:

1. Label `cka-worker2` with `pool=batch` and taint it `workload=batch:NoSchedule`.
2. Change CronJob `handoff-worker` (namespace `handoff`) so its pods tolerate that taint **and**
   only run on nodes labelled `pool=batch` (use node affinity or a nodeSelector).
3. No web pods may be left running on `cka-worker2`.
4. Prove it: create a Job `worker-on-batch` from the CronJob and let it finish.
