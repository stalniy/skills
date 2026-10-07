---
review-status: pending
---

# Spec review

## S1

status: provisional
depends-on: []
affects: []

### Issue

Job identity is undefined.

### Decision

Each retry creates a new Job.

### Why load-bearing

Changing identity later changes durable client contracts.

### Evidence

- `SPEC.md`

### Assumptions

- None