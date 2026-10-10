#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n handoff patch configmap handoff-config --type merge -p '{"data":{"APP_TIME_ZONE":"Europe/London"}}'
k -n handoff rollout restart deploy/handoff-web
k -n handoff rollout status deploy/handoff-web --timeout=180s
