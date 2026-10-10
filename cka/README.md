# CKA practice lab

Exam-style tasks on a real multi-node cluster running Handoff Tracker. Each task sets up its own
situation (often by breaking something on purpose), then grades your work automatically.

- **Cluster:** kind, Kubernetes **v1.35.8** (the CKA exam version). Three nodes: `cka-control-plane`,
  `cka-worker`, `cka-worker2`.
- **Installed:** Handoff Tracker (web, worker CronJob, Postgres, NetworkPolicies) in `handoff`,
  ingress-nginx, metrics-server, and etcdctl/etcdutl on the control plane.
- **Coverage:** every line of the official [CNCF CKA curriculum v1.35](https://github.com/cncf/curriculum).

## Start

Requires Docker, kind, helm and about 4 GB of free RAM.

```sh
cka/lab.sh up                          # ~5 min the first time
export PATH="$PWD/cka/.bin:$PATH"      # kubectl v1.35.8, same as the exam
kubectl config use-context kind-cka
alias k=kubectl                         # as in the exam
```

The app is on http://localhost:8097 (developer login) and the ingress controller on http://localhost:8096.

## Practise

```sh
cka/lab.sh list                 # all tasks
cka/lab.sh start 22             # set up task 22 and print it
# … solve it with kubectl, and `docker exec -it <node> bash` where the exam would say `ssh <node>` …
cka/lab.sh check 22             # ✓/✗ per requirement
cka/lab.sh solution 22          # worked solution and the reasoning
```

`start` first resets the shared bits other tasks change (taints, cordons, HPA, replicas), so you
can do tasks in any order. Answer files go in `cka/work/`, which is gitignored.

**Tasks 04 (etcd restore) and 05 (kubeadm upgrade) change the cluster for good.** Do them last,
each on a freshly reset cluster (`cka/lab.sh reset`, about 5 minutes). Running 05 right after 04
fails, for a real reason explained in solution 04.

## Tasks

| #   | Task                                                                     | Curriculum item                | Min |
| --- | ------------------------------------------------------------------------ | ------------------------------ | --- |
|     | **Cluster Architecture, Installation and Configuration (25%)**           |                                |     |
| 01  | Read-only ServiceAccount for a log shipper                               | RBAC                           | 6   |
| 02  | User certificate via the CSR API, kubeconfig, RoleBinding                | RBAC                           | 10  |
| 03  | Back up etcd                                                             | Cluster lifecycle              | 6   |
| 04  | Restore etcd into a new data dir ⚠️                                      | Cluster lifecycle              | 15  |
| 05  | Upgrade the control plane v1.35 → v1.36 with kubeadm ⚠️                  | kubeadm, lifecycle             | 20  |
| 06  | Install, upgrade and roll back a Helm release                            | Helm                           | 10  |
| 07  | Kustomize overlay: namespace, prefix, labels, replicas, patch            | Kustomize                      | 8   |
| 08  | Install a CRD, create a custom resource, `explain` it                    | CRDs and operators             | 6   |
| 09  | Find the CNI, CRI, pod and service CIDRs, etcd data dir, static pod path | CNI/CSI/CRI, infrastructure    | 8   |
|     | **Workloads and Scheduling (15%)**                                       |                                |     |
| 10  | Change a ConfigMap and roll it out                                       | ConfigMaps and Secrets         | 5   |
| 11  | Dedicate a node with taints, tolerations and a nodeSelector              | Scheduling                     | 10  |
| 12  | ResourceQuota and LimitRange for a shared namespace                      | Admission, limits              | 8   |
| 13  | HPA, PodDisruptionBudget and a safe drain                                | Autoscaling, self-healing      | 6   |
| 14  | Diagnose a bad rollout, roll back, safer strategy                        | Rolling updates and rollbacks  | 6   |
|     | **Services and Networking (20%)**                                        |                                |     |
| 15  | Fix a broken Service; add a ClusterIP Service                            | Services and endpoints         | 8   |
| 16  | Default-deny plus a precise egress allow-list                            | Network Policies               | 10  |
| 17  | Publish the app with an Ingress                                          | Ingress                        | 6   |
| 18  | Gateway and HTTPRoute with a header filter (Envoy Gateway)               | Gateway API                    | 10  |
| 19  | Fix CoreDNS and add a custom record                                      | CoreDNS                        | 10  |
|     | **Storage (10%)**                                                        |                                |     |
| 20  | StorageClass with Retain; prove the data outlives the claim              | StorageClasses, reclaim policy | 10  |
| 21  | Pre-provisioned local PV, PVC binding, read-only mount                   | PVs and PVCs, access modes     | 8   |
|     | **Troubleshooting (30%)**                                                |                                |     |
| 22  | Worker node NotReady (two faults)                                        | Clusters and nodes             | 10  |
| 23  | Every new pod Pending: broken control plane component                    | Cluster components             | 8   |
| 24  | Pods stuck initialising after a Secret change                            | Container output streams       | 8   |
| 25  | CronJob pods OOMKilled                                                   | Resource usage                 | 8   |
| 26  | `kubectl top` and log filtering                                          | Monitoring, output streams     | 6   |
| 27  | App down with three interconnected faults                                | Services and networking        | 15  |

## Mock exam

The real exam is 2 hours, 15–20 tasks, pass mark 66%. For a timed run, do this in one sitting
without opening solutions:

```sh
for t in 01 02 03 07 08 11 12 13 15 16 18 19 20 21 22 23 24 27; do cka/lab.sh start $t > cka/work/task-$t.txt; done
# That's the 18 tasks; read each file and solve them in any order. When the timer ends:
for t in 01 02 03 07 08 11 12 13 15 16 18 19 20 21 22 23 24 27; do cka/lab.sh check $t | tail -1; done
```

(Setting up the troubleshooting tasks together stacks their faults, which makes it harder than
the real thing. If a check fails because of another task's fault, run that task's `start` again
on its own.)

## Exam habits worth drilling here

- `kubectl explain <resource>.<field> --recursive` instead of searching the docs.
- Generate YAML: `kubectl create … --dry-run=client -o yaml > x.yaml`, then edit.
- For node work in the exam you `ssh` to a node and `sudo -i`. Remember `exit` and check which
  context you're in.
- Control plane problems: `crictl ps -a`, `crictl logs`, `journalctl -u kubelet`, and the files in
  `/etc/kubernetes/manifests`.
- Verify every task before moving on: `kubectl auth can-i`, `get endpointslices`, a busybox `wget`.

## How this differs from the exam

- Nodes are containers. `docker exec` replaces `ssh`, and binaries are downloaded rather than
  installed with `apt`.
- etcd runs as a static pod; that's the same as kubeadm clusters in the exam.
- The default CNI (kindnet) enforces NetworkPolicy. Installing a CNI from scratch, and a
  multi-control-plane (HA) setup, need their own clusters. Try them with a kind config that has
  `networking.disableDefaultCNI: true` (then install Calico), or one with three `control-plane`
  nodes (kind adds an HAProxy load balancer in front).

## Maintaining the lab

`cka/lab.sh selftest <ids…>` runs each task's setup, checks that the grader fails, applies the
reference `solve.sh`, and checks that the grader passes.
