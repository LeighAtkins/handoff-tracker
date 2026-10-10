#!/usr/bin/env bash
# One command from a clean machine (Docker, kind, kubectl) to Handoff Tracker on Kubernetes:
#   kind cluster -> metrics-server (for the HPA) -> Argo CD -> Application syncing infra/helm.
# The app is then on http://localhost:8095 with fake data. Tear down with: kind delete cluster --name handoff
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER=handoff
ARGOCD_VERSION=v3.5.4
METRICS_SERVER_VERSION=v0.8.0

need() { command -v "$1" >/dev/null || { echo "Missing $1. Install it first." >&2; exit 1; }; }
need docker; need kind; need kubectl

if ! kind get clusters | grep -qx "$CLUSTER"; then
  kind create cluster --config infra/kind/cluster.yaml --wait 120s
fi
kubectl config use-context "kind-$CLUSTER" >/dev/null

echo "Building images (fake data only; nothing under data/ goes into them)…"
docker build -q -f infra/docker/web.Dockerfile -t handoff-web:kind . >/dev/null
docker build -q -f infra/docker/worker.Dockerfile -t handoff-worker:kind . >/dev/null
kind load docker-image handoff-web:kind handoff-worker:kind --name "$CLUSTER"

echo "Installing metrics-server so the HPA has CPU numbers…"
kubectl apply -f "https://github.com/kubernetes-sigs/metrics-server/releases/download/$METRICS_SERVER_VERSION/components.yaml" >/dev/null
# kind's kubelets use self-signed certificates.
kubectl -n kube-system patch deployment metrics-server --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]' >/dev/null 2>&1 || true

echo "Installing Argo CD $ARGOCD_VERSION…"
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl apply -n argocd --server-side --force-conflicts \
  -f "https://raw.githubusercontent.com/argoproj/argo-cd/$ARGOCD_VERSION/manifests/install.yaml" >/dev/null
kubectl -n argocd rollout status deployment/argocd-repo-server --timeout=300s
kubectl -n argocd rollout status deployment/argocd-server --timeout=300s
kubectl -n argocd rollout status statefulset/argocd-application-controller --timeout=300s

echo "Pointing Argo CD at infra/helm on main…"
kubectl apply -f infra/argocd/application.yaml

echo "Waiting for the app to become healthy…"
for _ in $(seq 1 90); do
  if curl -fsS http://localhost:8095/api/health >/dev/null 2>&1; then break; fi
  sleep 5
done
curl -fsS http://localhost:8095/api/health >/dev/null || { echo "App did not become healthy; see: kubectl -n handoff get pods" >&2; exit 1; }

cat <<MSG

Handoff Tracker is running on http://localhost:8095 (fake data; developer login on localhost).

  Argo CD UI:  kubectl -n argocd port-forward svc/argocd-server 8443:443   -> https://localhost:8443
  Password:    kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
  Worker now:  kubectl -n handoff create job --from=cronjob/handoff-worker manual-\$(date +%s)
  Tear down:   kind delete cluster --name $CLUSTER
MSG
