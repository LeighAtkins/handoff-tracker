#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
H="helm --kube-context kind-$CLUSTER"
CHART="$CKA_DIR/../infra/helm/handoff-tracker"
$H install handoff-staging "$CHART" -n staging --create-namespace -f "$CKA_DIR/tasks/06-helm-release/staging-values.yaml" \
  --set web.replicas=1 --set worker.schedule="*/15 * * * *" --wait --timeout 5m
$H upgrade handoff-staging "$CHART" -n staging --reuse-values --set config.appTimeZone=Europe/London --wait
$H rollback handoff-staging 1 -n staging --wait
