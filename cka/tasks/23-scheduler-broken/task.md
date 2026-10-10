# 23: New pods stay Pending

**Domain:** Troubleshooting · **Time:** 8 min

After maintenance on the control plane, every new pod in the cluster stays `Pending`, including
the web pods from a routine restart. Nodes are Ready and have plenty of room.

Find the broken component and fix it so pods schedule again.
