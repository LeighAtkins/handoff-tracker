#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
expect "CRD is established" True "$(k get crd carrierroutes.handoff.dev -o jsonpath='{.status.conditions[?(@.type=="Established")].status}' 2>/dev/null)"
expect "px-to-sagawa goes 4PX -> SAGAWA" "4PX SAGAWA" "$(k -n $NS get carrierroute px-to-sagawa -o jsonpath='{.spec.from} {.spec.to}' 2>/dev/null)"
expect "quietHoursAfterHandoff is 120" 120 "$(k -n $NS get carrierroute px-to-sagawa -o jsonpath='{.spec.quietHoursAfterHandoff}' 2>/dev/null)"
expect "short name recorded" crt "$(tr -d '[:space:]' < "$CKA_DIR/work/08-shortname.txt" 2>/dev/null)"
check "explain output recorded" grep -q "Hours without news" "$CKA_DIR/work/08-explain.txt"
summary
