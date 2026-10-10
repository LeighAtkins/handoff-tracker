#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
mkdir -p "$CKA_DIR/work"; rm -f "$CKA_DIR"/work/jane.*
k delete csr jane --ignore-not-found >/dev/null
k -n $NS delete rolebinding jane-view --ignore-not-found >/dev/null
