#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
expect "web image is back to handoff-web:kind" handoff-web:kind "$(k -n $NS get deploy handoff-web -o jsonpath='{.spec.template.spec.containers[?(@.name=="web")].image}')"
check "web is fully rolled out" wait_for 120 web_ready
expect "broken revision recorded" "$(cat "$CKA_DIR/work/.14-broken-revision" 2>/dev/null)" "$(tr -d '[:space:]' < "$CKA_DIR/work/14-revision.txt" 2>/dev/null)"
expect "strategy maxUnavailable 0, maxSurge 1" "0 1" "$(k -n $NS get deploy handoff-web -o jsonpath='{.spec.strategy.rollingUpdate.maxUnavailable} {.spec.strategy.rollingUpdate.maxSurge}')"
summary
