# 02: A user certificate for the support team

**Domain:** Cluster Architecture, Installation and Configuration · **Time:** 10 min

Jane from support needs read-only access to `handoff`, authenticated with a client certificate
signed by the cluster CA. Do it through the CertificateSigningRequest API (no copying CA keys).

1. Generate a private key `cka/work/jane.key` and a CSR for user `jane` in group `support`.
2. Submit it as a CertificateSigningRequest `jane` (signer `kubernetes.io/kube-apiserver-client`,
   usage `client auth`), approve it, and save the issued certificate as `cka/work/jane.crt`.
3. Write a kubeconfig `cka/work/jane.kubeconfig` that connects to this cluster as jane.
4. Bind the built-in ClusterRole `view` to user `jane` in namespace `handoff` only (RoleBinding `jane-view`).
