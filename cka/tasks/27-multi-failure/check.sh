#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
check "web has 2 ready replicas" wait_for 180 bash -c "[ \"\$(kubectl --context kind-$CLUSTER -n $NS get deploy handoff-web -o jsonpath='{.status.readyReplicas}')\" = 2 ]"
check "the app is healthy through the NodePort" wait_for 30 curl -fsS --max-time 5 http://localhost:8097/api/health
check "NetworkPolicy handoff-web still exists" k -n $NS get netpol handoff-web
check "NetworkPolicy handoff-default-deny still exists" k -n $NS get netpol handoff-default-deny
expect "web ingress allowed only on 3000" 3000 "$(k -n $NS get netpol handoff-web -o jsonpath='{.spec.ingress[0].ports[0].port}')"
summary
