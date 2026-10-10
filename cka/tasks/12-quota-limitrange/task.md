# 12: Quotas and defaults for a shared namespace

**Domain:** Workloads and Scheduling · **Time:** 8 min

Interns get namespace `sandbox` to experiment in. Keep it cheap:

1. Create namespace `sandbox` with a ResourceQuota `compute`: at most `4` pods,
   `requests.cpu: 500m`, `requests.memory: 512Mi`, `limits.cpu: "1"`, `limits.memory: 1Gi`.
2. Add a LimitRange `defaults` so containers that set nothing get requests `cpu: 100m`,
   `memory: 64Mi` and limits `cpu: 200m`, `memory: 128Mi`.
3. Create Deployment `probe` (image `registry.k8s.io/pause:3.10`, **no resources set**) with 6 replicas.
4. Write the exact reason the extra replicas can't be created (the `message` of the ReplicaSet's
   failure event or condition) to `cka/work/12-reason.txt`.
