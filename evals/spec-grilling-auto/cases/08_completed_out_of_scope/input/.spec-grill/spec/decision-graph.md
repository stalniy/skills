---
review-mode: automatic
review-status: complete
---
# Spec review
## S1
status: out-of-scope
depends-on: []
affects: []
### Issue
Cross-region Session recovery.
### Decision
The service uses active-active recovery.
### Why load-bearing
Changing recovery later changes durable state ownership and requires migration.
### Evidence
- `SPEC.md`
### Assumptions
- None
### Out-of-scope reason
Cross-region recovery is deferred to a later specification.
### Boundary
This release runs in one region and promises no cross-region Session continuity. No current requirement depends on recovery topology.
