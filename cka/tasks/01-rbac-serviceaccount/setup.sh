#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n $NS delete rolebinding log-reader role pod-log-reader serviceaccount log-reader --ignore-not-found >/dev/null
