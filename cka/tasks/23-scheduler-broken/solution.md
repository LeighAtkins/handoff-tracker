# Solution 23

```sh
kubectl -n handoff get pods                       # Pending, no events about nodes at all
kubectl -n handoff describe pod <pending-pod>     # no "Scheduled" event: nobody is scheduling
kubectl -n kube-system get pods                   # kube-scheduler-… CrashLoopBackOff
kubectl -n kube-system logs kube-scheduler-cka-control-plane
#   …stat /etc/kubernetes/scheduller.conf: no such file or directory

docker exec -it cka-control-plane bash
vi /etc/kubernetes/manifests/kube-scheduler.yaml  # fix the --kubeconfig path (and the volume, if changed)
crictl ps | grep scheduler                         # the kubelet recreates the static pod by itself
```

**Static pods:**

- The control plane components are files in `/etc/kubernetes/manifests`. The kubelet runs them
  and mirrors them into the API, so `kubectl delete` on them does nothing lasting.
- Fix the file.
- If the API server itself is broken, `kubectl` won't help: use `crictl ps -a` and
  `crictl logs <id>` on the node, or `/var/log/pods/`.
