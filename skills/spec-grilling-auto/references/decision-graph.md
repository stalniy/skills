# Decision graph contract

Read this reference before creating, consuming, or changing a decision graph. It defines the shared artifact interface for specification grilling and complexity reduction. Each skill owns its review workflow, publication timing, and authorization to change the artifact.

## Location and metadata

Store the agent graph at `.spec-grill/<spec-slug>/decision-graph.ai.md`. Reuse the directory for the same specification. Follow repository naming conventions or derive a short deterministic slug from the specification file or feature name. Keep slug collisions from mixing specifications.

Use these frontmatter values:

| `review-mode` | `review-status` | Meaning |
| --- | --- | --- |
| `interactive` | `in-progress` | Interactive review is underway. |
| `interactive` | `complete` | Interactive review and cleanup are complete. |
| `automatic` | `pending` | A published batch awaits human review. |
| `automatic` | `complete` | The batch has been marked complete or reconciled, according to its owning protocol. |

Document review status is distinct from node acceptance. An automatic editable file can be marked complete before reconciliation; its baseline and node statuses must still be interpreted by `spec-grilling-auto`. Changing mode or copying a graph does not accept decisions. Preserve review metadata during analysis; the owning review workflow controls completion.

## Nodes and provenance

The graph records load-bearing decisions and relevant scope boundaries, not every supporting implementation detail. Include relevant settled decisions as well as new issues. Record evidence of acceptance for settled decisions; the presence of a recommendation alone is not approval. Keep lower-impact cleanup outside this graph. If no load-bearing decisions exist, write metadata and an explicit empty-graph statement.

Give each underlying issue a stable `S1`, `S2`, ... ID. Keep its ID when recomputing its recommendation. Use a new ID only for a genuinely new issue; never reuse a retired ID for another issue. Keep superseded history only when useful, outside the active graph.

For each active decision, record its status, issue, recommendation in `Decision`, why it is load-bearing, concise evidence, material assumptions, up to three credible alternatives when useful, `depends-on`, and `affects` when known. Explain briefly why the recommendation is preferred. Record decision provenance and rationale, not hidden reasoning. Use established domain terms and short, direct sentences.

Use stable, machine-readable Markdown fields and headings. Keep this structure across review updates:

```md
---
review-mode: interactive
review-status: in-progress
---

# Spec review

## S1

status: provisional
depends-on: []
affects: []

### Issue

Workflow state ownership is undefined.

### Decision

Workflow owns authoritative execution state.

### Why load-bearing

Changing ownership later requires state migration and changes component boundaries.

### Evidence

- `src/workflow/...`

### Assumptions

- None

### Alternatives

1. **Workflow Run owns state** — less suitable because ...
```

## Node states and scope

- `provisional`: a supported recommendation that has not been accepted, including a recomputed recommendation awaiting review.
- `accepted`: a decision settled by explicit user input, the owning review protocol, or authoritative evidence of an existing settled decision. Record its provenance.
- `out-of-scope`: an intentionally deferred concern, not an accepted proposed solution. Also require `### Out-of-scope reason` and `### Boundary` with concrete text.

A deferred decision is settled for this specification only when its boundary prevents it from determining in-scope behavior. If an in-scope decision still depends on it, resolve the scope or boundary through the owning review workflow.

## Dependency semantics

`depends-on` lists prerequisite decision IDs whose changes could change this node's correct recommendation. Discovery order creates no dependency. Multiple parents are allowed.

Use `depends-on` to determine affected transitive descendants. `affects`, when recorded, is the inverse of those direct edges; keep it consistent with `depends-on`. All edges refer to active IDs. Preserve independent branches during recomputation.

## Changes, retirement, and reopening

Keep an ID when the underlying issue remains the same, even if its recommendation changes. Allocate a fresh ID for a genuinely new issue. When a mechanism's elimination removes an issue, retire its ID and remove its edges from the active graph. Record retired IDs and reasons outside active nodes, in a change or reduction report. Retirement is not an out-of-scope decision.

A consumer may replace provisional decisions only within its authorized workflow. Preserve accepted decisions, required semantics, user direction, and scope boundaries unless review authorizes a change. To propose reopening a protected decision, preserve its current `Decision` and status; record the proposed change and semantic cost in `Issue` and the accompanying report. No additional node state is required.

Recompute recommendations that could change after an upstream edit. Recomputed recommendations remain provisional until the owning workflow accepts them. Preserve user edits as input during recomputation. Keep the resulting graph free of dangling edges and contradictory recommendations.

The shared contract does not grant permission to edit published review files. Automatic pending baselines are immutable, and user-editable companions are governed by `spec-grilling-auto`.
