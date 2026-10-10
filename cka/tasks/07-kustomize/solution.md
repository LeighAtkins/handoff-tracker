# Solution 07

`cka/work/kustomize/prod/kustomization.yaml`:

```yaml
resources:
  - ../../../tasks/07-kustomize/base
namespace: kustomize-prod
namePrefix: prod-
labels:
  - pairs: { env: prod }
    includeSelectors: true # also add it to spec.selector…
    includeTemplates: true # …and to the pod template, so they keep matching
replicas:
  - name: carrier-status # the base name, before the prefix
    count: 3
patches:
  - path: limits.yaml
```

`cka/work/kustomize/prod/limits.yaml` (a strategic merge patch, matched by kind and name):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: carrier-status }
spec:
  template:
    spec:
      containers:
        - name: status
          resources:
            limits: { cpu: 100m, memory: 64Mi }
```

```sh
kubectl create namespace kustomize-prod
kubectl kustomize cka/work/kustomize/prod        # preview
kubectl apply -k cka/work/kustomize/prod
```

**Note:** `commonLabels` still works but is deprecated. `labels:` with `includeSelectors` is the
current form. Selectors are immutable, so add labels to them only when creating a Deployment.
