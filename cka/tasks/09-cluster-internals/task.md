# 09: Know your cluster's extension points

**Domain:** Cluster Architecture, Installation and Configuration · **Time:** 8 min

Find these facts from the cluster and its nodes (not from this repo), and write them to
`cka/work/09-answers.txt`, one `KEY=value` per line:

| Key                | Question                                                              |
| ------------------ | --------------------------------------------------------------------- |
| `CNI_CONFIG`       | Full path of the CNI configuration file on the nodes                  |
| `CNI_PLUGIN`       | Name of the CNI plugin it configures (the `type` of the first plugin) |
| `CRI_ENDPOINT`     | The container runtime endpoint the kubelet uses (e.g. `unix:///…`)    |
| `POD_CIDR_WORKER2` | The pod CIDR assigned to `cka-worker2`                                |
| `SERVICE_CIDR`     | The cluster's Service IP range                                        |
| `ETCD_DATA_DIR`    | etcd's `--data-dir`                                                   |
| `STATIC_POD_PATH`  | Where the kubelet on the control plane looks for static pod manifests |
