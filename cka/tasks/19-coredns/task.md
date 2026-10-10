# 19: DNS trouble after a CoreDNS change

**Domain:** Services and Networking · **Time:** 10 min

Someone edited the CoreDNS configuration this morning. Since then new web pods never become Ready.

1. Find and fix the problem so cluster DNS works and the web Deployment is fully available.
2. Also make the name `ship24.cka.test` resolve to `192.0.2.10` for every pod in the cluster,
   using CoreDNS (not `/etc/hosts` in the pods).
