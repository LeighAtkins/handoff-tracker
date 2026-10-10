#!/usr/bin/env bash
# CKA practice lab on Handoff Tracker. See cka/README.md.
#   cka/lab.sh up | down | reset | list     (REBUILD=1 cka/lab.sh up rebuilds the app images)
#   cka/lab.sh start <task>      set the task up (may break something on purpose) and print it
#   cka/lab.sh check <task>      grade your solution
#   cka/lab.sh solution <task>   show the worked solution
#   cka/lab.sh selftest <task>…  (maintainers) prove setup, check and solution agree
set -euo pipefail
source "$(dirname "$0")/lib.sh"
ROOT="$(cd "$CKA_DIR/.." && pwd)"

task_dir() {
  local match
  match=$(ls -d "$CKA_DIR"/tasks/"$1"* 2>/dev/null | head -1) || true
  [ -n "$match" ] || { echo "No task matching '$1'. Try: cka/lab.sh list" >&2; exit 1; }
  echo "$match"
}

up() {
  for tool in docker kind kubectl helm; do command -v $tool >/dev/null || { echo "Missing $tool" >&2; exit 1; }; done
  if [ ! -x "$CKA_DIR/.bin/kubectl" ]; then
    echo "Downloading kubectl v1.35.8 (the exam version) to cka/.bin…"
    mkdir -p "$CKA_DIR/.bin"
    curl -fsSLo "$CKA_DIR/.bin/kubectl" https://dl.k8s.io/release/v1.35.8/bin/linux/amd64/kubectl
    chmod +x "$CKA_DIR/.bin/kubectl"
    export PATH="$CKA_DIR/.bin:$PATH"
  fi
  kind get clusters | grep -qx $CLUSTER || kind create cluster --config "$CKA_DIR/cluster.yaml" --wait 180s
  for image in web worker; do
    if [ "${REBUILD:-}" = 1 ] || ! docker image inspect handoff-$image:kind >/dev/null 2>&1; then
      echo "Building handoff-$image:kind…"
      docker build -q -f "$ROOT/infra/docker/$image.Dockerfile" -t handoff-$image:kind "$ROOT" >/dev/null
    fi
  done
  echo "Loading images into the cluster…"
  kind load docker-image handoff-web:kind handoff-worker:kind --name $CLUSTER >/dev/null

  echo "Installing metrics-server and ingress-nginx…"
  k apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.8.0/components.yaml >/dev/null
  k -n kube-system patch deployment metrics-server --type=json \
    -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]' >/dev/null 2>&1 || true
  k apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.13.3/deploy/static/provider/kind/deploy.yaml >/dev/null

  echo "Installing etcdctl/etcdutl on the control plane (the exam nodes have them)…"
  on $CP 'command -v etcdctl >/dev/null || (cd /tmp && curl -fsSL https://github.com/etcd-io/etcd/releases/download/v3.6.5/etcd-v3.6.5-linux-amd64.tar.gz | tar xz && cp etcd-v3.6.5-linux-amd64/etcdctl etcd-v3.6.5-linux-amd64/etcdutl /usr/local/bin/)'

  echo "Installing Handoff Tracker…"
  helm --kube-context kind-$CLUSTER upgrade --install handoff "$ROOT/infra/helm/handoff-tracker" \
    -f "$CKA_DIR/values-cka.yaml" -n $NS --create-namespace --wait --timeout 6m >/dev/null
  k -n $NS wait --for=condition=complete job/handoff-seed --timeout=180s >/dev/null
  k -n ingress-nginx wait --for=condition=available deployment/ingress-nginx-controller --timeout=180s >/dev/null
  echo
  k get nodes
  echo
  echo "Lab ready. App: http://localhost:8097   Tasks: cka/lab.sh list"
}

list() {
  printf '%-4s %-60s %s\n' ID TASK DOMAIN
  for d in "$CKA_DIR"/tasks/*/; do
    local id title domain
    id=$(basename "$d" | cut -d- -f1)
    title=$(sed -n 's/^# //p' "$d/task.md" | head -1)
    domain=$(sed -n 's/^\*\*Domain:\*\* //p' "$d/task.md" | head -1 | sed 's/ · .*//')
    printf '%-4s %-60s %s\n' "$id" "${title#*: }" "$domain"
  done
}

case "${1:-}" in
  up) up ;;
  down) kind delete cluster --name $CLUSTER ;;
  reset) kind delete cluster --name $CLUSTER; up ;;
  list) list ;;
  start)
    d=$(task_dir "${2:?task id}")
    echo "Setting up…"; baseline
    [ -x "$d/setup.sh" ] && "$d/setup.sh"
    echo
    cat "$d/task.md" ;;
  check)
    d=$(task_dir "${2:?task id}")
    echo "Checking $(basename "$d")"; "$d/check.sh" ;;
  solution)
    d=$(task_dir "${2:?task id}"); cat "$d/solution.md" ;;
  selftest)
    # For maintaining the lab: setup -> check must fail -> reference solution -> check must pass.
    for id in "${@:2}"; do
      d=$(task_dir "$id"); name=$(basename "$d")
      baseline; [ -x "$d/setup.sh" ] && "$d/setup.sh" >/dev/null 2>&1
      if "$d/check.sh" >/dev/null 2>&1; then echo "✗ $name: check passed before solving"; continue; fi
      "$d/solve.sh" >/dev/null 2>&1 || true
      if "$d/check.sh" >/tmp/cka-selftest.log 2>&1; then echo "✓ $name"; else echo "✗ $name"; cat /tmp/cka-selftest.log; fi
    done ;;
  *) sed -n '2,7p' "$0"; exit 1 ;;
esac
