#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
SA=system:serviceaccount:handoff:log-reader
can() { k auth can-i "$@" --as=$SA 2>/dev/null; }
check "ServiceAccount log-reader exists" k -n $NS get sa log-reader
expect "can list pods in handoff" yes "$(can list pods -n $NS)"
expect "can watch pods in handoff" yes "$(can watch pods -n $NS)"
expect "can get pod logs in handoff" yes "$(can get pods --subresource=log -n $NS)"
expect "cannot delete pods" no "$(can delete pods -n $NS)"
expect "cannot read secrets" no "$(can get secrets -n $NS)"
expect "cannot list pods in kube-system" no "$(can list pods -n kube-system)"
expect "RoleBinding log-reader uses Role pod-log-reader" pod-log-reader "$(k -n $NS get rolebinding log-reader -o jsonpath='{.roleRef.name}' 2>/dev/null)"
summary
