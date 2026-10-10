#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
mkdir -p "$CKA_DIR/work"; rm -f "$CKA_DIR"/work/26-*
k -n $NS delete job worker-observe --ignore-not-found >/dev/null
k -n $NS create job worker-observe --from=cronjob/handoff-worker >/dev/null
k -n $NS wait --for=condition=complete job/worker-observe --timeout=180s >/dev/null 2>&1 || true
