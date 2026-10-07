# Job retry identity

A failed Job can be handled in one of two ways:

- retry the same Job identity; or
- create a new Attempt identity linked to the Job.

External consumers store Job identifiers and use them for reconciliation.

The specification also does not define whether an idempotency key identifies the Job or each Attempt.

Changing either identity contract after clients integrate requires migration.
