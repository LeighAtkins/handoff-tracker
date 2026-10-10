# Solution 15

```sh
kubectl -n handoff get endpointslices -l kubernetes.io/service-name=handoff-web   # no endpoints
kubectl -n handoff get svc handoff-web -o yaml | grep -A4 -E 'selector|targetPort'
kubectl -n handoff get pods --show-labels | grep web                               # component=web, port 3000 ("http")

kubectl -n handoff edit svc handoff-web
#   selector: app.kubernetes.io/component: web        (was: frontend)
#   targetPort: http                                  (was: 8080; the container listens on 3000)

kubectl -n handoff expose deploy handoff-web --name=handoff-web-internal --port=8080 --target-port=3000
kubectl -n handoff run t --rm -it --image=busybox:1.36 -- wget -qO- handoff-web-internal:8080/api/live
```

**Debugging order for "Service doesn't work":**

1. Are there endpoints? If not, the selector doesn't match Ready pods.
2. If there are, does `targetPort` match the container port? A named port is safest.
3. Then look at NetworkPolicy and DNS.
