#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
mkdir -p "$CKA_DIR/work"; rm -f "$CKA_DIR/work/14-revision.txt"
k -n $NS patch deploy handoff-web --type merge -p '{"spec":{"strategy":{"rollingUpdate":{"maxUnavailable":"25%","maxSurge":"25%"}}}}' >/dev/null
k -n $NS set image deploy/handoff-web web=handoff-web:v2 >/dev/null
k -n $NS annotate deploy/handoff-web kubernetes.io/change-cause="release v2" --overwrite >/dev/null
k -n $NS get deploy handoff-web -o jsonpath='{.metadata.annotations.deployment\.kubernetes\.io/revision}' > "$CKA_DIR/work/.14-broken-revision"
sleep 5
