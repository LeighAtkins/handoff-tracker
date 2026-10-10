#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
mkdir -p "$CKA_DIR/work"; rm -f "$CKA_DIR"/work/08-*
k delete crd carrierroutes.handoff.dev --ignore-not-found --wait=true >/dev/null
