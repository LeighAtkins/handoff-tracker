#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n $NS patch configmap handoff-config --type merge -p '{"data":{"APP_TIME_ZONE":"Asia/Tokyo"}}' >/dev/null
k -n $NS rollout restart deploy/handoff-web >/dev/null && k -n $NS rollout status deploy/handoff-web --timeout=180s >/dev/null
