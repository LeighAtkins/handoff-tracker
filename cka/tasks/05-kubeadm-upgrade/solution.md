# Solution 05

```sh
docker exec -it cka-control-plane bash
V=v1.36.4

# 1. kubeadm first (in the exam: apt-mark unhold kubeadm && apt-get install kubeadm=1.36.4-*)
curl -fsSLo /usr/bin/kubeadm https://dl.k8s.io/release/$V/bin/linux/amd64/kubeadm && chmod +x /usr/bin/kubeadm
kubeadm version
kubeadm upgrade plan
kubeadm upgrade apply $V          # upgrades the static pods, CoreDNS and kube-proxy
exit

# 2. Drain from a machine with kubectl
kubectl drain cka-control-plane --ignore-daemonsets --delete-emptydir-data

# 3. kubelet + kubectl on the node, then restart the kubelet
docker exec -it cka-control-plane bash
curl -fsSLo /tmp/kubelet https://dl.k8s.io/release/v1.36.4/bin/linux/amd64/kubelet
curl -fsSLo /usr/bin/kubectl https://dl.k8s.io/release/v1.36.4/bin/linux/amd64/kubectl
chmod +x /tmp/kubelet /usr/bin/kubectl
systemctl stop kubelet && mv /tmp/kubelet /usr/bin/kubelet
systemctl daemon-reload && systemctl restart kubelet
exit

kubectl uncordon cka-control-plane
kubectl get nodes        # control plane v1.36.4, workers v1.35.8
```

**Order matters:** kubeadm → `upgrade apply` → drain → kubelet/kubectl → restart → uncordon. On
a worker it's the same, but you run `kubeadm upgrade node` instead of `apply`. You can only move
one minor version at a time.
