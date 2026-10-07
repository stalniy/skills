---
review-status: pending
---
# Spec review
## S1
status: provisional
depends-on: []
affects: [S2]
### Issue
Job identity.
### Decision
Each retry creates a new Job.
### Why load-bearing
Changes a durable contract.
### Evidence
- `SPEC.md`
### Assumptions
- None
## S2
status: provisional
depends-on: [S1]
affects: []
### Issue
Idempotency scope.
### Decision
Keys are scoped to each new Job.
### Why load-bearing
Changes a durable contract.
### Evidence
- `SPEC.md`
### Assumptions
- None
## S3
status: provisional
depends-on: []
affects: []
### Issue
Document ID scope.
### Decision
IDs are globally unique.
### Why load-bearing
Changes a durable contract.
### Evidence
- `SPEC.md`
### Assumptions
- None
