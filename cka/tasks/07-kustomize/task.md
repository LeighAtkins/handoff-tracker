# 07: A Kustomize overlay for production

**Domain:** Cluster Architecture, Installation and Configuration · **Time:** 8 min

`cka/tasks/07-kustomize/base` holds a small Deployment. Without editing the base, create an
overlay in `cka/work/kustomize/prod/` that:

- puts everything in namespace `kustomize-prod`
- prefixes names with `prod-`
- adds the label `env: prod` to the resources **and** their selectors/pod templates
- runs 3 replicas
- sets container `status` limits to `cpu: 100m`, `memory: 64Mi` with a patch

Apply it with `kubectl apply -k` (create the namespace first).
