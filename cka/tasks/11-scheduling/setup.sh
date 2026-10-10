#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k taint node $W2 workload- >/dev/null 2>&1 || true
k label node $W2 pool- >/dev/null 2>&1 || true
k -n $NS delete job worker-on-batch --ignore-not-found >/dev/null
k -n $NS patch cronjob handoff-worker --type json -p '[{"op":"remove","path":"/spec/jobTemplate/spec/template/spec/tolerations"}]' >/dev/null 2>&1 || true
k -n $NS patch cronjob handoff-worker --type json -p '[{"op":"remove","path":"/spec/jobTemplate/spec/template/spec/affinity"}]' >/dev/null 2>&1 || true
k -n $NS patch cronjob handoff-worker --type json -p '[{"op":"remove","path":"/spec/jobTemplate/spec/template/spec/nodeSelector"}]' >/dev/null 2>&1 || true
# Make sure at least one web pod starts out on the node that is about to be dedicated.
k -n $NS patch deploy handoff-web --type merge -p '{"spec":{"template":{"spec":{"affinity":null}}}}' >/dev/null 2>&1
