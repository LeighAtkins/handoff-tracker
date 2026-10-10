# 13: Autoscaling and disruption budget for web

**Domain:** Workloads and Scheduling · **Time:** 6 min

1. Create a HorizontalPodAutoscaler `handoff-web` (autoscaling/v2) for Deployment `handoff-web` in
   `handoff`: 2–4 replicas, target average CPU utilisation 60%. Make sure it actually reads metrics.
2. Create a PodDisruptionBudget `handoff-web` so voluntary disruptions (drains) always leave at
   least 1 web pod running.
3. Drain `cka-worker` (ignore DaemonSets, allow emptyDir data to go), check that web stayed up,
   then make the node schedulable again.
