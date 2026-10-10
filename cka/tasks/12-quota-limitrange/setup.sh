#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k delete namespace sandbox --ignore-not-found --wait=true >/dev/null
mkdir -p "$CKA_DIR/work"; rm -f "$CKA_DIR/work/12-reason.txt"
