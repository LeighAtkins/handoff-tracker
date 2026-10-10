# Helpers shared by lab.sh and the task scripts. Source it; do not run it.
# shellcheck shell=bash
CKA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER=cka
CP=cka-control-plane
W1=cka-worker
W2=cka-worker2
NS=handoff
export KUBECONFIG_CONTEXT="kind-$CLUSTER"

# The exam uses kubectl v1.35; lab.sh up puts that version in cka/.bin.
[ -x "$CKA_DIR/.bin/kubectl" ] && export PATH="$CKA_DIR/.bin:$PATH"
k() { kubectl --context "kind-$CLUSTER" "$@"; }
# Run a command on a node, as you would after `ssh <node>` in the exam.
on() { local node=$1; shift; docker exec "$node" bash -c "$*"; }

PASSED=0
FAILED=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; PASSED=$((PASSED + 1)); }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILED=$((FAILED + 1)); }
# check "description" command...   passes when the command succeeds.
check() { local what=$1; shift; if "$@" >/dev/null 2>&1; then pass "$what"; else fail "$what"; fi; }
# expect "description" "expected" "actual"
expect() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected '$2', got '${3:-<empty>}')"; fi; }
summary() {
  echo
  if [ "$FAILED" -eq 0 ]; then printf '\033[32mPASS\033[0m  %d checks\n' "$PASSED"; return 0; fi
  printf '\033[31mFAIL\033[0m  %d of %d checks failed\n' "$FAILED" "$((PASSED + FAILED))"; return 1
}

wait_for() { # wait_for <seconds> <command...>
  local deadline=$((SECONDS + $1)); shift
  until "$@" >/dev/null 2>&1; do [ $SECONDS -ge $deadline ] && return 1; sleep 2; done
}
# Put the cluster back to the state every task assumes, undoing anything a task (or its solution)
# changes. Each step is a no-op when nothing drifted, so this is cheap to run before every task.
baseline() {
  k uncordon $CP $W1 $W2 >/dev/null 2>&1
  k taint node $W2 workload- >/dev/null 2>&1 || true
  k label node $W2 pool- >/dev/null 2>&1 || true
  k -n $NS delete hpa handoff-web --ignore-not-found >/dev/null 2>&1
  k -n $NS delete pdb handoff-web --ignore-not-found >/dev/null 2>&1
  k -n default delete deploy drain-canary --ignore-not-found >/dev/null 2>&1
  # Bare pods left by other tasks would block drains (they have no controller to recreate them).
  k -n $NS delete pod archiver exporter --ignore-not-found --wait=false >/dev/null 2>&1
  k -n reporting delete pod reporter --ignore-not-found --wait=false >/dev/null 2>&1
  # Worker CronJob: no scheduling constraints, chart default resources.
  local path=/spec/jobTemplate/spec/template/spec
  for field in tolerations nodeSelector affinity; do
    k -n $NS patch cronjob handoff-worker --type json -p "[{\"op\":\"remove\",\"path\":\"$path/$field\"}]" >/dev/null 2>&1 || true
  done
  k -n $NS patch cronjob handoff-worker --type json -p "[{\"op\":\"replace\",\"path\":\"$path/containers/0/resources\",
    \"value\":{\"requests\":{\"cpu\":\"50m\",\"memory\":\"192Mi\"},\"limits\":{\"cpu\":\"500m\",\"memory\":\"512Mi\"}}}]" >/dev/null 2>&1
  # Web: image, readiness probe and replicas as installed. A rollout only happens if something drifted.
  k -n $NS patch deploy handoff-web --type json -p '[
    {"op":"replace","path":"/spec/template/spec/containers/0/image","value":"handoff-web:kind"},
    {"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/api/health"}]' >/dev/null 2>&1
  k -n $NS scale deploy handoff-web --replicas=2 >/dev/null 2>&1
  # Service, NetworkPolicy and Secret as installed.
  k -n $NS patch svc handoff-web --type json -p '[
    {"op":"replace","path":"/spec/selector/app.kubernetes.io~1component","value":"web"},
    {"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]' >/dev/null 2>&1
  k -n $NS patch netpol handoff-web --type json -p '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":3000}]' >/dev/null 2>&1
  k -n $NS patch secret handoff-secrets --type merge \
    -p '{"stringData":{"DATABASE_URL":"postgresql://handoff:handoff@handoff-postgres:5432/handoff?schema=public"}}' >/dev/null 2>&1
}

# GET a URL from a throwaway busybox pod (retrying while endpoints settle). Prints the body.
incluster_get() { # incluster_get <namespace> <url>
  local i out
  for i in 1 2 3 4 5; do
    out=$(k -n "$1" run probe-$RANDOM --rm -i --restart=Never --image=busybox:1.36 -q -- wget -qO- -T 5 "$2" 2>/dev/null) && [ -n "$out" ] && { echo "$out"; return 0; }
    sleep 3
  done
  return 1
}

web_ready() { [ "$(k -n $NS get deploy handoff-web -o jsonpath='{.status.readyReplicas}')" = "$(k -n $NS get deploy handoff-web -o jsonpath='{.spec.replicas}')" ]; }
