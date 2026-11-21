# Audit log

The system stores a high-volume Audit Log. Accepted records are append-only until they expire.

This release must choose one retention policy for the Audit Log:

- Finite retention. Delete records and their stored copies when their configured retention period ends.
- Permanent retention. Keep records available indefinitely without age-based deletion.

If finite retention is chosen, operators can set the retention period. The exact duration can be set before rollout.
