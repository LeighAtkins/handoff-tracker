# 08: Install a CRD and create a custom resource

**Domain:** Cluster Architecture, Installation and Configuration · **Time:** 6 min

The team wants carrier routes as Kubernetes objects so an operator could manage them later.

1. Install the CRD in `cka/tasks/08-crd/carrierroute-crd.yaml`.
2. In `handoff`, create a `CarrierRoute` named `px-to-sagawa` from `4PX` to `SAGAWA` with
   `quietHoursAfterHandoff: 120`.
3. Use the API (not the file) to find the CRD's short name, and write it to `cka/work/08-shortname.txt`.
4. Write the output of `kubectl explain carrierroute.spec.quietHoursAfterHandoff` to `cka/work/08-explain.txt`.
