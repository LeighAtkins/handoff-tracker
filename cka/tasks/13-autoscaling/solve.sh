#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n handoff autoscale deploy handoff-web --min=2 --max=4 --cpu=60%
k -n handoff create pdb handoff-web --selector=app.kubernetes.io/component=web --min-available=1
k drain cka-worker --ignore-daemonsets --delete-emptydir-data --timeout=180s
k uncordon cka-worker
k -n handoff rollout status deploy/handoff-web --timeout=180s
