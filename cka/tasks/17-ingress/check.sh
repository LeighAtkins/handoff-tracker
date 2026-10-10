#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
expect "Ingress uses class nginx" nginx "$(k -n $NS get ingress handoff -o jsonpath='{.spec.ingressClassName}' 2>/dev/null)"
expect "host tracker.cka.local -> handoff-web:80" "tracker.cka.local handoff-web 80" "$(k -n $NS get ingress handoff -o jsonpath='{.spec.rules[0].host} {.spec.rules[0].http.paths[0].backend.service.name} {.spec.rules[0].http.paths[0].backend.service.port.number}' 2>/dev/null)"
check "the app answers through the ingress" wait_for 60 curl -fsS --max-time 5 -H 'Host: tracker.cka.local' http://localhost:8096/api/live
check "other hosts do not reach the app" bash -c "! curl -fsS --max-time 5 -H 'Host: other.cka.local' http://localhost:8096/api/live"
summary
