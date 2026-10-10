#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n handoff top pods --sort-by=memory --no-headers | head -1 | awk '{print $1}' > "$CKA_DIR/work/26-top-pod.txt"
k top nodes --sort-by=cpu --no-headers | head -1 | awk '{print $1}' > "$CKA_DIR/work/26-top-node.txt"
job=$(k -n handoff get jobs -l app.kubernetes.io/component=worker --sort-by=.metadata.creationTimestamp -o name | tail -1)
k -n handoff logs "$job" | grep worker.run > "$CKA_DIR/work/26-worker.log"
