#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
rm -rf "$CKA_DIR/work/kustomize"; mkdir -p "$CKA_DIR/work/kustomize"
k delete namespace kustomize-prod --ignore-not-found --wait=true >/dev/null
