#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n handoff create serviceaccount log-reader
k -n handoff create role pod-log-reader --verb=get,list,watch --resource=pods,pods/log
k -n handoff create rolebinding log-reader --role=pod-log-reader --serviceaccount=handoff:log-reader
