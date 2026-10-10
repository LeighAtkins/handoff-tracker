#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
q() { k -n sandbox get resourcequota compute -o jsonpath="{.spec.hard.$1}" 2>/dev/null; }
expect "quota pods" 4 "$(q pods)"
expect "quota requests.cpu" 500m "$(q 'requests\.cpu')"
expect "quota requests.memory" 512Mi "$(q 'requests\.memory')"
expect "quota limits.cpu" 1 "$(q 'limits\.cpu')"
expect "quota limits.memory" 1Gi "$(q 'limits\.memory')"
lr=$(k -n sandbox get limitrange defaults -o jsonpath='{.spec.limits[0].defaultRequest.cpu} {.spec.limits[0].defaultRequest.memory} {.spec.limits[0].default.cpu} {.spec.limits[0].default.memory}' 2>/dev/null)
expect "LimitRange defaults" "100m 64Mi 200m 128Mi" "$lr"
expect "probe runs 4 of 6 replicas (quota-capped)" "6 4" "$(k -n sandbox get deploy probe -o jsonpath='{.spec.replicas} {.status.readyReplicas}' 2>/dev/null)"
expect "probe pods got default requests" 100m "$(k -n sandbox get pods -l app=probe -o jsonpath='{.items[0].spec.containers[0].resources.requests.cpu}' 2>/dev/null)"
check "reason mentions the exceeded quota" grep -qi "exceeded quota: compute" "$CKA_DIR/work/12-reason.txt"
summary
