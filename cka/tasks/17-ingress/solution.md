# Solution 17

```sh
kubectl -n handoff create ingress handoff --class=nginx --rule="tracker.cka.local/*=handoff-web:80"
kubectl -n handoff describe ingress handoff
curl -H 'Host: tracker.cka.local' http://localhost:8096/api/live
```

The `/*` in `--rule` gives `pathType: Prefix` on `/`. Without `--class` (or a default
IngressClass), no controller picks the Ingress up and nothing happens, with no error. That's the
most common Ingress mistake. The controller sends traffic straight to the pod IPs behind the
Service, which is why the web NetworkPolicy has to allow it on 3000.
