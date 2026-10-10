# Solution 02

```sh
cd cka/work
openssl genrsa -out jane.key 2048
openssl req -new -key jane.key -subj "/CN=jane/O=support" -out jane.csr

cat <<YAML | kubectl apply -f -
apiVersion: certificates.k8s.io/v1
kind: CertificateSigningRequest
metadata: { name: jane }
spec:
  request: $(base64 -w0 < jane.csr)
  signerName: kubernetes.io/kube-apiserver-client
  usages: [client auth]
YAML
kubectl certificate approve jane
kubectl get csr jane -o jsonpath='{.status.certificate}' | base64 -d > jane.crt

# kubeconfig: reuse the cluster's server and CA from your own config
SERVER=$(kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.server}')
kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d > ca.crt
kubectl config --kubeconfig jane.kubeconfig set-cluster cka --server=$SERVER --certificate-authority=ca.crt --embed-certs
kubectl config --kubeconfig jane.kubeconfig set-credentials jane --client-key=jane.key --client-certificate=jane.crt --embed-certs
kubectl config --kubeconfig jane.kubeconfig set-context jane --cluster=cka --user=jane --namespace=handoff
kubectl config --kubeconfig jane.kubeconfig use-context jane

kubectl -n handoff create rolebinding jane-view --clusterrole=view --user=jane
kubectl --kubeconfig jane.kubeconfig auth whoami
```

**Why:** the certificate's CN becomes the username and each O becomes a group. A RoleBinding to a
ClusterRole grants that ClusterRole's rules in one namespace only. The built-in `view` role
deliberately excludes Secrets.
