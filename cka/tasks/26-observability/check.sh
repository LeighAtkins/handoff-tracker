#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
pod=$(tr -d '[:space:]' < "$CKA_DIR/work/26-top-pod.txt" 2>/dev/null)
mem_of() { k -n $NS top pod "$1" --no-headers 2>/dev/null | awk '{print $3}' | tr -d 'Mi'; }
max=$(k -n $NS top pods --no-headers 2>/dev/null | awk '{gsub("Mi","",$3); print $3}' | sort -n | tail -1)
mine=$(mem_of "$pod")
# Usage moves between your measurement and the check, so allow 15% slack.
check "top memory pod recorded ($pod: ${mine:-?}Mi, max ${max}Mi)" bash -c "[ -n '$mine' ] && [ \$(( ${mine:-0} * 100 )) -ge \$(( ${max:-1} * 85 )) ]"
node=$(tr -d '[:space:]' < "$CKA_DIR/work/26-top-node.txt" 2>/dev/null)
nmax=$(k top nodes --no-headers 2>/dev/null | awk '{gsub("m","",$2); print $2}' | sort -n | tail -1)
nmine=$(k top node "$node" --no-headers 2>/dev/null | awk '{gsub("m","",$2); print $2}')
check "top CPU node recorded ($node: ${nmine:-?}m, max ${nmax}m)" bash -c "[ -n '$nmine' ] && [ \$(( ${nmine:-0} * 100 )) -ge \$(( ${nmax:-1} * 75 )) ]"
latest=$(k -n $NS get jobs -l app.kubernetes.io/component=worker --sort-by=.metadata.creationTimestamp -o name 2>/dev/null | tail -1)
latest=${latest:-job/worker-observe}
want=$(k -n $NS logs "$latest" 2>/dev/null | grep worker.run)
got=$(cat "$CKA_DIR/work/26-worker.log" 2>/dev/null)
check "worker.run lines recorded" test -n "$got"
check "only worker.run lines" bash -c "! grep -v worker.run '$CKA_DIR/work/26-worker.log' | grep -q ."
expect "lines match the latest worker Job's log" "$want" "$got"
summary
