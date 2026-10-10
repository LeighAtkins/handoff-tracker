#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
KC="$CKA_DIR/work/jane.kubeconfig"
jane() { kubectl --kubeconfig "$KC" "$@" 2>/dev/null; }
check "key, certificate and kubeconfig exist" test -s "$CKA_DIR/work/jane.key" -a -s "$CKA_DIR/work/jane.crt" -a -s "$KC"
expect "CSR jane was approved" True "$(k get csr jane -o jsonpath='{.status.conditions[?(@.type=="Approved")].status}' 2>/dev/null)"
expect "certificate subject is jane in group support" "CN=jane, O=support" "$(openssl x509 -in "$CKA_DIR/work/jane.crt" -noout -subject -nameopt sep_comma_plus_space 2>/dev/null | sed 's/^subject=//; s/^ //' | awk -F', ' '{for(i=NF;i>0;i--) printf "%s%s",$i,(i>1?", ":"")}')"
expect "kubeconfig authenticates as jane" jane "$(jane auth whoami -o jsonpath='{.status.userInfo.username}')"
expect "jane can list pods in handoff" yes "$(jane auth can-i list pods -n $NS)"
expect "jane cannot delete pods" no "$(jane auth can-i delete pods -n $NS)"
expect "jane cannot read secrets (view excludes them)" no "$(jane auth can-i get secrets -n $NS)"
expect "jane cannot list pods in kube-system" no "$(jane auth can-i list pods -n kube-system)"
summary
