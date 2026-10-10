# 16: Lock down a reporting namespace

**Domain:** Services and Networking · **Time:** 10 min

The BI team runs a pod `reporter` in namespace `reporting`. It should be able to call the web
app, and nothing else.

1. In `reporting`, create a NetworkPolicy `default-deny` that denies **all** ingress and egress
   for every pod in the namespace.
2. Create a NetworkPolicy `reporter-egress` that lets pods labelled `app=reporter` reach:
   - DNS (kube-dns in `kube-system`, UDP and TCP 53), and
   - the Handoff Tracker web pods (`app.kubernetes.io/component=web` in namespace `handoff`) on TCP 3000.

Afterwards `reporter` must reach `http://handoff-web.handoff/api/live` but **not**
`http://ingress-nginx-controller.ingress-nginx` or anything else.
