#!/usr/bin/env bash
source "$(dirname "$0")/../../lib.sh"
k -n handoff create ingress handoff --class=nginx --rule="tracker.cka.local/*=handoff-web:80"
