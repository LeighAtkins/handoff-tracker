# 24: Web pods stuck initialising

**Domain:** Troubleshooting · **Time:** 8 min

A colleague "rotated the database password" in the app's Secret. The database itself was not
changed. Since the restart that followed, new web pods never become Ready.

Find out why from the pods' output, and fix it **without changing the database**.
