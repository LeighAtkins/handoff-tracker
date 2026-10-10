#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n handoff patch cronjob handoff-worker --type json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/resources/limits/memory","value":"512Mi"},{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/resources/requests/memory","value":"192Mi"}]'
k -n handoff create job worker-verify --from=cronjob/handoff-worker
k -n handoff wait --for=condition=complete job/worker-verify --timeout=180s
