# Solution 14

```sh
kubectl -n handoff rollout status deploy/handoff-web       # stuck
kubectl -n handoff get pods                                # ErrImageNeverPull on the new pods
kubectl -n handoff describe pod <new-pod> | tail           # image handoff-web:v2 is not on the node
kubectl -n handoff rollout history deploy/handoff-web      # the newest revision: "release v2"
kubectl -n handoff rollout history deploy/handoff-web --revision=<n>   # shows the image

echo <n> > cka/work/14-revision.txt
kubectl -n handoff rollout undo deploy/handoff-web         # to the previous revision
kubectl -n handoff patch deploy handoff-web --type merge \
  -p '{"spec":{"strategy":{"rollingUpdate":{"maxUnavailable":0,"maxSurge":1}}}}'
```

**Why it never went down:** a rolling update only removes old pods as new ones become Ready, so
the old ReplicaSet kept serving. With `maxUnavailable: 0` capacity never drops at all during a
rollout. `rollout undo` makes the old ReplicaSet current again, and it gets a _new_ revision number.
