# Job retry identity

A failed Job can be handled in one of two ways:

- retry the same Job identity; or
- create a new Attempt identity linked to the Job.

External consumers store Job identifiers and use them for reconciliation.

Clients also send idempotency keys for retries. The scope of a key depends on what it identifies. Clients persist these keys with their identifiers.

Changing either identity contract after clients integrate requires migration.
