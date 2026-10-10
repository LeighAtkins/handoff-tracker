#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
r() { k -n reporting exec reporter -- "$@" 2>/dev/null; }
check "default-deny selects every pod, both directions" bash -c "kubectl --context kind-$CLUSTER -n reporting get netpol default-deny -o jsonpath='{.spec.podSelector} {.spec.policyTypes}' | grep -q '{} \\[\"Ingress\",\"Egress\"\\]'"
check "reporter-egress exists" k -n reporting get netpol reporter-egress
check "DNS works from reporter" r nslookup handoff-web.handoff.svc.cluster.local
check "reporter reaches the web app" r wget -qO- -T 5 http://handoff-web.handoff/api/live
check "reporter cannot reach ingress-nginx" bash -c "! kubectl --context kind-$CLUSTER -n reporting exec reporter -- wget -qO- -T 4 http://ingress-nginx-controller.ingress-nginx"
check "reporter cannot reach Postgres" bash -c "! kubectl --context kind-$CLUSTER -n reporting exec reporter -- nc -z -w 3 handoff-postgres.handoff 5432"
summary
