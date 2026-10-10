#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
mkdir -p "$CKA_DIR/work"; rm -f "$CKA_DIR/work/20-pv.txt"
k -n $NS delete pod exporter --ignore-not-found --wait=true >/dev/null
k -n $NS delete pvc exports --ignore-not-found --wait=true >/dev/null
for pv in $(k get pv -o jsonpath='{range .items[?(@.spec.storageClassName=="retain-local")]}{.metadata.name}{"\n"}{end}'); do k delete pv "$pv" --wait=false >/dev/null; done
k delete storageclass retain-local --ignore-not-found >/dev/null
