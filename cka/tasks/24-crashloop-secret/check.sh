#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
url=$(k -n $NS get secret handoff-secrets -o jsonpath='{.data.DATABASE_URL}' | base64 -d)
check "DATABASE_URL uses the database's real password" grep -q 'handoff:handoff@' <<<"$url"
expect "Postgres password unchanged" handoff "$(k -n $NS get sts handoff-postgres -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="POSTGRES_PASSWORD")].value}')"
check "web is fully rolled out" wait_for 180 web_ready
check "the app reports a healthy database" curl -fsS --max-time 5 http://localhost:8097/api/health
summary
