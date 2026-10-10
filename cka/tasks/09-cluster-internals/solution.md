# Solution 09

```sh
docker exec -it cka-worker2 bash
ls /etc/cni/net.d/                         # CNI_CONFIG: /etc/cni/net.d/10-kindnet.conflist
grep -m1 '"type"' /etc/cni/net.d/*.conflist  # CNI_PLUGIN: ptp (kindnet writes a ptp + portmap chain)
exit

docker exec cka-worker2 grep containerRuntimeEndpoint /var/lib/kubelet/config.yaml
#   CRI_ENDPOINT: unix:///run/containerd/containerd.sock (crictl uses the same, see /etc/crictl.yaml)
kubectl get node cka-worker2 -o jsonpath='{.spec.podCIDR}'

docker exec cka-control-plane grep service-cluster-ip-range /etc/kubernetes/manifests/kube-apiserver.yaml
docker exec cka-control-plane grep data-dir /etc/kubernetes/manifests/etcd.yaml
docker exec cka-control-plane grep staticPodPath /var/lib/kubelet/config.yaml
```

**The three interfaces:**

- **CRI** is how the kubelet talks to the container runtime (containerd here).
- **CNI** is how the runtime gets pod networking set up (kindnet here; Calico or Cilium elsewhere).
- **CSI** is how storage drivers provide volumes. The `standard` StorageClass here uses
  rancher's local-path provisioner, an external provisioner rather than a full CSI driver.
