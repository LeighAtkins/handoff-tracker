#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
url=$(k -n $NS get secret handoff-secrets -o jsonpath='{.data.DATABASE_URL}' | base64 -d)
bad=$(sed 's#handoff:[^@]*@#handoff:rotated-2026@#' <<<"$url")
k -n $NS patch secret handoff-secrets --type merge -p "{\"stringData\":{\"DATABASE_URL\":\"$bad\"}}" >/dev/null
k -n $NS rollout restart deploy/handoff-web >/dev/null
sleep 15
