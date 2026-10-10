#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
helm --kube-context kind-$CLUSTER -n staging uninstall handoff-staging --wait >/dev/null 2>&1 || true
k delete namespace staging --ignore-not-found --wait=true >/dev/null
