# Solution 27

Work from the outside in, and re-test after each fix:

```sh
curl -v http://localhost:8097/api/health                 # hangs or refused

kubectl -n handoff get deploy,pods,svc,endpointslices
#   pods Running but 0/1 READY  → readiness probe
kubectl -n handoff describe pod <web-pod> | grep -A3 Readiness
#   Readiness probe failed: HTTP probe failed with statuscode: 404 (path /api/healthz)
kubectl -n handoff edit deploy handoff-web               # readinessProbe.httpGet.path: /api/health

kubectl -n handoff get svc handoff-web -o yaml | grep targetPort     # 3001, container listens on 3000
kubectl -n handoff patch svc handoff-web --type json \
  -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'

kubectl -n handoff get netpol handoff-web -o yaml        # ingress port 3001: traffic to 3000 dropped
kubectl -n handoff edit netpol handoff-web               # port: 3000
```

**Why this is realistic:** each fault alone produces a different symptom (not Ready, no
response, timeout), and together they hide each other. Fixing the Service alone still times out
because of the policy. Check every layer in order:

1. Pods Ready?
2. Endpoints exist?
3. Service port → targetPort → containerPort?
4. Policy allows that pod port?
5. DNS?
