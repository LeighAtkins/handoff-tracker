# Solution 19

```sh
kubectl -n handoff get pods                                  # new pods stuck in Init (migrate)
kubectl -n handoff logs <new-pod> -c migrate                 # can't reach handoff-postgres
kubectl run t --rm -it --image=busybox:1.36 -- nslookup handoff-postgres.handoff   # NXDOMAIN / fails

kubectl -n kube-system get configmap coredns -o yaml          # "kubernetes cluster.locl" typo
kubectl -n kube-system edit configmap coredns
```

The fixed Corefile, with the custom record:

```
.:53 {
    hosts {
       192.0.2.10 ship24.cka.test
       fallthrough                  # anything else continues to the next plugin
    }
    errors
    health
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
       pods insecure
       fallthrough in-addr.arpa ip6.arpa
    }
    forward . /etc/resolv.conf
    cache 30
    ...
}
```

```sh
kubectl -n kube-system rollout restart deploy/coredns   # the reload plugin would get there too, slower
kubectl -n handoff rollout restart deploy/handoff-web
```

**Clues to remember:** pods resolve through the `kube-dns` Service (see `/etc/resolv.conf` in
any pod). `kubectl -n kube-system logs -l k8s-app=kube-dns` shows plugin errors. A typo in the
cluster domain doesn't crash CoreDNS; it just stops answering for Services.
