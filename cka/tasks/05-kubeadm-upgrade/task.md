# 05: Upgrade the control plane with kubeadm (destructive, slow)

**Domain:** Cluster Architecture, Installation and Configuration · **Time:** 20 min · **Start from a fresh cluster (`cka/lab.sh reset`), and reset again afterwards to get back to v1.35**

The cluster runs Kubernetes v1.35.8. Upgrade **the control plane node only** to v1.36.4:

1. Upgrade kubeadm on `cka-control-plane` to v1.36.4, check the plan, and apply the upgrade.
2. Drain the node, upgrade kubelet and kubectl to v1.36.4, restart the kubelet, and uncordon it.

Leave the workers on v1.35.8 (one minor version of kubelet skew is supported).

_The lab nodes don't use apt; download the binaries from `https://dl.k8s.io/release/v1.36.4/bin/linux/amd64/`._
