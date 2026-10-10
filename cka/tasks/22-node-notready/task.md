# 22: A worker node is NotReady

**Domain:** Troubleshooting · **Time:** 10 min

`cka-worker2` went `NotReady` overnight and pods on it are being replaced elsewhere.

Bring the node back to `Ready`, and make sure the fix survives a reboot of the node.
(`docker exec -it cka-worker2 bash` gets you onto it.)
