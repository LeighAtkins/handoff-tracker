# Solution 22

```sh
kubectl get nodes
kubectl describe node cka-worker2 | grep -A5 Conditions    # "Kubelet stopped posting node status"

docker exec -it cka-worker2 bash
systemctl status kubelet                 # inactive (dead), and disabled
systemctl enable --now kubelet
journalctl -u kubelet -n 30 --no-pager   # "dial tcp …:6444: connect: connection refused"
grep server /etc/kubernetes/kubelet.conf # wrong port: 6444
sed -i 's/:6444/:6443/' /etc/kubernetes/kubelet.conf
systemctl restart kubelet
exit
kubectl get nodes -w
```

**Node troubleshooting checklist:** is the kubelet running and enabled? What does
`journalctl -u kubelet` say? Typical causes are a wrong API endpoint or certificate in
`/etc/kubernetes/kubelet.conf`, a bad `/var/lib/kubelet/config.yaml`, the container runtime being
down (`crictl ps`, `systemctl status containerd`), swap, or a full disk. Two faults at once is
common in the exam: fixing the first just reveals the second.
