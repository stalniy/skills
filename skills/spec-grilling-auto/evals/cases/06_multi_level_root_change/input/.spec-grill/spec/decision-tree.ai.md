---
review-status: pending
---
# Spec review
## S1
status: provisional
depends-on: []
affects: [S2, S3]
### Issue
Root choice.
### Decision
A.
## S2
status: provisional
depends-on: [S1]
affects: [S4, S5]
### Issue
Branch choice.
### Decision
B.
## S3
status: provisional
depends-on: [S1]
affects: [S6]
### Issue
Other branch choice.
### Decision
C.
## S4
status: provisional
depends-on: [S2]
affects: []
### Issue
Leaf one.
### Decision
D.
## S5
status: provisional
depends-on: [S2]
affects: []
### Issue
Leaf two.
### Decision
E.
## S6
status: provisional
depends-on: [S3]
affects: []
### Issue
Other leaf.
### Decision
F.
## S7
status: provisional
depends-on: []
affects: []
### Issue
Independent choice.
### Decision
G.
