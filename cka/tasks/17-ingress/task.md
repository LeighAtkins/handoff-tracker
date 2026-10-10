# 17: Publish the app through an Ingress

**Domain:** Services and Networking · **Time:** 6 min

ingress-nginx is installed (IngressClass `nginx`) and published on http://localhost:8096.

Create an Ingress `handoff` in `handoff` so that requests for host `tracker.cka.local` reach
Service `handoff-web` on port 80, for every path.

Test: `curl -H 'Host: tracker.cka.local' http://localhost:8096/api/live`
