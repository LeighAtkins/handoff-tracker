#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k label node cka-worker2 pool=batch --overwrite
k taint node cka-worker2 workload=batch:NoSchedule --overwrite
k -n handoff patch cronjob handoff-worker --type merge -p '{"spec":{"jobTemplate":{"spec":{"template":{"spec":{
  "tolerations":[{"key":"workload","operator":"Equal","value":"batch","effect":"NoSchedule"}],
  "nodeSelector":{"pool":"batch"}}}}}}}'
k -n handoff rollout restart deploy/handoff-web && k -n handoff rollout status deploy/handoff-web --timeout=180s
k -n handoff create job worker-on-batch --from=cronjob/handoff-worker
k -n handoff wait --for=condition=complete job/worker-on-batch --timeout=180s
