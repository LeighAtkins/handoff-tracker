#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n $NS delete ingress handoff --ignore-not-found >/dev/null
