# Solution 04

```sh
docker exec -it cka-control-plane bash

# 1. Restore the snapshot into a fresh directory (etcd keeps running on the old one meanwhile).
etcdutl snapshot restore /opt/etcd-backup/pre-change.db --data-dir /var/lib/etcd-restore

# 2. Point the etcd static pod's data volume at it. Only the hostPath changes.
vi /etc/kubernetes/manifests/etcd.yaml
#   volumes:
#   - hostPath:
#       path: /var/lib/etcd-restore     # was /var/lib/etcd
#       type: DirectoryOrCreate
#     name: etcd-data

# 3. The kubelet notices the manifest change and recreates etcd. Wait, then check.
watch crictl ps            # etcd and kube-apiserver come back within a minute or two
exit
kubectl get cm -n default
```

**Why:** restoring into a new directory leaves the old data intact if you need to back out.
Changing the hostPath (not `--data-dir`, which is the path _inside_ the container) keeps the
container's view the same. If the API server is slow to come back, `crictl ps -a` and
`crictl logs <id>` on the node show why.

**Gotcha found while building this lab:** kubeadm remembers etcd's data directory in its own
config (`kubectl -n kube-system get cm kubeadm-config`). A later `kubeadm upgrade` regenerates
the etcd manifest from that config and silently switches back to `/var/lib/etcd`. On a real
cluster, either restore into `/var/lib/etcd` itself (stop etcd first by moving its manifest out,
then move the old directory aside), or update `etcd.local.dataDir` in kubeadm-config as well.
