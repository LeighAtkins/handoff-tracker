# Solution 03

```sh
docker exec -it cka-control-plane bash

# The flags you need are all in the static pod manifest:
grep -E 'listen-client-urls|trusted-ca-file|cert-file|key-file' /etc/kubernetes/manifests/etcd.yaml

mkdir -p /opt/etcd-backup
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save /opt/etcd-backup/snapshot.db

etcdutl snapshot status /opt/etcd-backup/snapshot.db -w table
```

**Why:** etcd only accepts mutual TLS, so `etcdctl` needs the CA plus a client certificate and key.
Copy the paths from the manifest rather than memorising them. In etcd 3.6, `etcdutl` handles
offline file operations (`status`, `restore`).
