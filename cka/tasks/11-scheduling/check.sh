#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
expect "cka-worker2 labelled pool=batch" batch "$(k get node $W2 -o jsonpath='{.metadata.labels.pool}')"
expect "cka-worker2 tainted workload=batch:NoSchedule" "workload=batch:NoSchedule" "$(k get node $W2 -o jsonpath='{range .spec.taints[?(@.key=="workload")]}{.key}={.value}:{.effect}{end}')"
spec=$(k -n $NS get cronjob handoff-worker -o jsonpath='{.spec.jobTemplate.spec.template.spec}')
check "CronJob tolerates the taint" grep -q '"key":"workload"' <<<"$spec"
check "CronJob is pinned to pool=batch" grep -Eq '"pool":"batch"|"key":"pool"' <<<"$spec"
expect "no web pods on cka-worker2" "" "$(k -n $NS get pods -l app.kubernetes.io/component=web --field-selector spec.nodeName=$W2 -o name)"
check "web is still fully available" web_ready
expect "Job worker-on-batch succeeded" 1 "$(k -n $NS get job worker-on-batch -o jsonpath='{.status.succeeded}' 2>/dev/null)"
expect "Job worker-on-batch ran on cka-worker2" $W2 "$(k -n $NS get pods -l job-name=worker-on-batch -o jsonpath='{.items[0].spec.nodeName}' 2>/dev/null)"
summary
