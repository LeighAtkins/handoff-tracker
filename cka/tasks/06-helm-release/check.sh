#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
h() { helm --kube-context kind-$CLUSTER -n staging "$@" 2>/dev/null; }
expect "release handoff-staging is deployed" deployed "$(h status handoff-staging -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)["info"]["status"])' 2>/dev/null)"
expect "release is at revision 3" 3 "$(h status handoff-staging -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null)"
expect "revision 3 is a rollback to 1" "Rollback to 1" "$(h history handoff-staging -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)[-1]["description"])' 2>/dev/null)"
expect "revision 2 set Europe/London" Europe/London "$(h get values handoff-staging --revision 2 -o json | python3 -c 'import json,sys; print(json.load(sys.stdin).get("config",{}).get("appTimeZone",""))' 2>/dev/null)"
expect "time zone is back to Asia/Tokyo" Asia/Tokyo "$(k -n staging get configmap handoff-staging-config -o jsonpath='{.data.APP_TIME_ZONE}' 2>/dev/null)"
expect "one web replica" 1 "$(k -n staging get deploy handoff-staging-web -o jsonpath='{.spec.replicas}' 2>/dev/null)"
expect "worker schedule is */15" "*/15 * * * *" "$(k -n staging get cronjob handoff-staging-worker -o jsonpath='{.spec.schedule}' 2>/dev/null)"
summary
