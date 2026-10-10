#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
mem=$(k -n $NS get cronjob handoff-worker -o jsonpath='{.spec.jobTemplate.spec.template.spec.containers[0].resources.limits.memory}')
mib=$(python3 -c "import re,sys; v='$mem'; m=re.match(r'(\d+)(Mi|Gi|M|G)?$',v); n=int(m.group(1)); u=m.group(2) or ''; print(n*1024 if u in('Gi','G') else n if u in ('Mi','M') else n//1048576)" 2>/dev/null)
check "CronJob memory limit is at least 256Mi (now $mem)" test "${mib:-0}" -ge 256
expect "Job worker-verify succeeded" 1 "$(k -n $NS get job worker-verify -o jsonpath='{.status.succeeded}' 2>/dev/null)"
summary
