#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
url=$(k -n handoff get secret handoff-secrets -o jsonpath='{.data.DATABASE_URL}' | base64 -d)
good=$(sed 's#handoff:[^@]*@#handoff:handoff@#' <<<"$url")
k -n handoff patch secret handoff-secrets --type merge -p "{\"stringData\":{\"DATABASE_URL\":\"$good\"}}"
k -n handoff rollout restart deploy/handoff-web && k -n handoff rollout status deploy/handoff-web --timeout=240s
