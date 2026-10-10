#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
ready=$(k -n $NS get deploy handoff-web -o jsonpath='{.status.readyReplicas}')
eps=$(k -n $NS get endpointslices -l kubernetes.io/service-name=handoff-web -o jsonpath='{range .items[*].endpoints[*]}{.addresses[0]}{"\n"}{end}' | grep -c .)
expect "handoff-web has an endpoint per ready pod" "$ready" "$eps"
expect "NodePort is still 30095" 30095 "$(k -n $NS get svc handoff-web -o jsonpath='{.spec.ports[0].nodePort}')"
check "http://localhost:8097/api/live answers" curl -fsS --max-time 5 http://localhost:8097/api/live
expect "handoff-web-internal is ClusterIP on 8080" "ClusterIP 8080" "$(k -n $NS get svc handoff-web-internal -o jsonpath='{.spec.type} {.spec.ports[0].port}' 2>/dev/null)"
check "handoff-web-internal:8080 answers from inside the cluster" incluster_get $NS http://handoff-web-internal:8080/api/live
summary
