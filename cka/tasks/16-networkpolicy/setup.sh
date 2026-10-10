#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k delete namespace reporting --ignore-not-found --wait=true >/dev/null
k create namespace reporting >/dev/null
k -n reporting run reporter --image=busybox:1.36 --labels=app=reporter -- sleep 1d >/dev/null
k -n reporting wait --for=condition=Ready pod/reporter --timeout=120s >/dev/null
