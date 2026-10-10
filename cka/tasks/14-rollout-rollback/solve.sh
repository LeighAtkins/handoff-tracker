#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n handoff get deploy handoff-web -o jsonpath='{.metadata.annotations.deployment\.kubernetes\.io/revision}' > "$CKA_DIR/work/14-revision.txt"
k -n handoff rollout undo deploy/handoff-web
k -n handoff patch deploy handoff-web --type merge -p '{"spec":{"strategy":{"rollingUpdate":{"maxUnavailable":0,"maxSurge":1}}}}'
k -n handoff rollout status deploy/handoff-web --timeout=180s
