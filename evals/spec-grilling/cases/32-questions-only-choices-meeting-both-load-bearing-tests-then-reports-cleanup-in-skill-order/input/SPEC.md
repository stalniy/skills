# Claims register

Accounting and Intake each propose owning the authoritative claim balance. Both provide durable storage and the same command interface. Moving live balances between them requires a coordinated ledger migration.

A live configuration switch sets the threshold for automatic approval. Its setting materially affects which claims require manual review. Operators can reverse it immediately for future claims, with no backfill or client change.

Storage must pick a physical page layout. Repacking the retained archive takes weeks. Both layouts satisfy all required behavior and capacity targets, and the choice is invisible outside the storage engine.

The claim search box needs placeholder text. Copy can be updated at any time.
