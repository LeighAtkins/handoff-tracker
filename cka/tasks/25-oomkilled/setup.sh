#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n $NS delete job worker-verify worker-oom --ignore-not-found >/dev/null
k -n $NS patch cronjob handoff-worker --type json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/resources/limits/memory","value":"24Mi"},{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/resources/requests/memory","value":"16Mi"}]' >/dev/null
k -n $NS create job worker-oom --from=cronjob/handoff-worker >/dev/null
sleep 15
