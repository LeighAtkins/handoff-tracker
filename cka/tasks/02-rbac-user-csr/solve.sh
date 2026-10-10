#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
cd "$CKA_DIR/work"
openssl genrsa -out jane.key 2048 2>/dev/null
openssl req -new -key jane.key -subj "/CN=jane/O=support" -out jane.csr
cat <<YAML | k apply -f -
apiVersion: certificates.k8s.io/v1
kind: CertificateSigningRequest
metadata: { name: jane }
spec:
  request: $(base64 -w0 < jane.csr)
  signerName: kubernetes.io/kube-apiserver-client
  usages: [client auth]
  expirationSeconds: 86400
YAML
k certificate approve jane
wait_for 30 test -n "$(k get csr jane -o jsonpath='{.status.certificate}')"
k get csr jane -o jsonpath='{.status.certificate}' | base64 -d > jane.crt
SERVER=$(k config view --raw --minify -o jsonpath='{.clusters[0].cluster.server}')
k config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d > ca.crt
kubectl config --kubeconfig jane.kubeconfig set-cluster cka --server="$SERVER" --certificate-authority=ca.crt --embed-certs
kubectl config --kubeconfig jane.kubeconfig set-credentials jane --client-key=jane.key --client-certificate=jane.crt --embed-certs
kubectl config --kubeconfig jane.kubeconfig set-context jane --cluster=cka --user=jane --namespace=handoff
kubectl config --kubeconfig jane.kubeconfig use-context jane
k -n handoff create rolebinding jane-view --clusterrole=view --user=jane
