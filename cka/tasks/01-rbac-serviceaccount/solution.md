# Solution 01

```sh
kubectl -n handoff create serviceaccount log-reader
kubectl -n handoff create role pod-log-reader --verb=get,list,watch --resource=pods,pods/log
kubectl -n handoff create rolebinding log-reader --role=pod-log-reader --serviceaccount=handoff:log-reader

# Verify the way the exam expects you to:
kubectl auth can-i get pods --subresource=log -n handoff --as=system:serviceaccount:handoff:log-reader   # yes
kubectl auth can-i delete pods -n handoff --as=system:serviceaccount:handoff:log-reader                  # no
```

**Why:** a Role is namespaced, so the grant cannot leak into other namespaces. `pods/log` is a
subresource and must be listed explicitly. Imperative `create role` is the fastest way to write
this in the exam; add `--dry-run=client -o yaml` if you need to edit before applying.
