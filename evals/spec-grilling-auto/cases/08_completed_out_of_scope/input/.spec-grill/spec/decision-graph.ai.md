---
review-mode: automatic
review-status: pending
---
# Spec review
## S1
status: provisional
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
