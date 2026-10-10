#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n $NS delete pod archiver --ignore-not-found --wait=true >/dev/null
k -n $NS delete pvc audit-archive --ignore-not-found --wait=true >/dev/null
k delete pv audit-archive --ignore-not-found >/dev/null
on $W1 'mkdir -p /mnt/audit-archive && echo "Audit archive: fake data for the CKA lab" > /mnt/audit-archive/README'
