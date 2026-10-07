---
name: spec-grilling-auto
description: Review a specification automatically with provisional load-bearing decisions and a dependency-aware decision tree for later file review. Use for unattended or automatic spec grilling, or when the user wants to edit a Markdown decision tree instead of resolving issues interactively. For interactive accept/edit/out-of-scope review, use spec-grilling.
disable-model-invocation: true
---

# Automatic specification review

Before any review work, read [`../spec-grilling/SKILL.md`](../spec-grilling/SKILL.md). It is the authority for load-bearing classification, evidence, stress testing, scope, unknown facts, language, knowledge artifacts, cleanup, and completion. This skill changes the interaction and execution model only. Where interaction mechanics differ, follow this skill. **The agent owns the recommendation. The user owns scope and veto.**

## Run order

1. Locate the specification and its stable review directory, `.spec-grill/<spec-slug>/`. Reuse an existing directory for that specification. Follow a repository naming convention if one exists; otherwise derive a short deterministic slug from its file name or feature name. Keep a slug collision from mixing two specifications.
2. Before new discovery, inspect any existing `decision-tree.ai.md` and `decision-tree.md` there. If both exist, run `diff -u` on them and reconcile the review as described below. A nonzero exit status means differences, not a failed review. If only one exists, preserve it and report the incomplete pair; recover the missing file only when its intended contents are unambiguous.
3. If a review batch is pending, preserve it. Continue only work that cannot conflict with that batch. Do not infer acceptance from silence or overwrite either file.
4. If there is no pending batch, follow the base skill's evidence and stress-testing rules. Explore every in-scope load-bearing branch using supported provisional recommendations. Record a dependency only when changing the upstream decision can change the correct downstream recommendation. Discovery order alone creates no dependency.
5. Write the active decision tree. If it contains provisional decisions, start a pending review batch as described below. Stop before final cleanup. Resume automatically on the next invocation; the user needs only to edit `decision-tree.md`.
6. When all in-scope load-bearing decisions are accepted or validly out of scope, apply accepted knowledge and perform the base skill's cleanup. If cleanup exposes a load-bearing issue, stop cleanup, add that issue to the tree, and start a new pending batch.

Do not present provisional decisions as user-approved. Temporary consequences used to explore a branch must be clearly provisional and reversible. Keep final specification, ADR, `CONTEXT.md`, and `GLOSSARY.md` knowledge tied to accepted decisions only; reconcile stale consequences after a changed decision.

## Decision tree

Give each underlying issue a stable `S1`, `S2`, ... ID. Keep its ID when recomputing its recommendation. Use a new ID only for a genuinely new issue; never reuse a retired ID for another issue. Keep superseded history only when useful, outside the active tree.

For each active decision, record its status, issue, recommendation in `Decision`, why it is load-bearing, concise evidence, material assumptions, up to three credible alternatives when useful, `depends-on`, and `affects` when known. Explain briefly why the recommendation is preferred. Record decision provenance and rationale, not hidden reasoning. Use the base skill's terminology and language rules.

Use stable, machine-readable Markdown fields and headings. Keep this structure across batches:

```md
---
review-status: pending
---

# Spec review

## S1

status: provisional
depends-on: []
affects: [S3]

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

The active states are `provisional`, `accepted`, and `out-of-scope`. For an `out-of-scope` node, also require `### Out-of-scope reason` and `### Boundary` with concrete text. Apply the base skill's scope semantics: a deferred decision is settled for this specification only when its boundary prevents it from determining in-scope behavior. Resolve a blocking dependency through the base skill's permitted scope or boundary choices; do not call it solved.

## Two-file review protocol

The review directory contains:

- `decision-tree.ai.md`: the exact agent-generated baseline for the active batch. Keep it unchanged while that batch is pending.
- `decision-tree.md`: the user-editable copy. At batch creation it must be byte-identical to the baseline.

The user may edit `Decision`, decision status, `Assumptions`, `Out-of-scope reason`, `Boundary`, and `review-status` in `decision-tree.md`. They complete a batch by changing `review-status: pending` to `review-status: complete`. This is the complete review interface. Use the filesystem; do not depend on Git, an editor API, comments, or hidden external state.

Before continuing a review, run:

```bash
diff -u .spec-grill/<spec-slug>/decision-tree.ai.md .spec-grill/<spec-slug>/decision-tree.md
```

Interpret semantic changes to the editable fields as feedback. Ignore formatting-only differences such as wrapping, spacing, or punctuation that does not change meaning. Keep ambiguous edits intact and ask for clarification only when their meaning is required to proceed. Preserve other unexpected edits until you can safely reconcile them; do not silently discard user input.

While `review-status` is `pending`, keep the batch and all user edits. Untouched provisional nodes stay provisional. A changed individual status does not complete the batch. Do not create a replacement batch or normalize `decision-tree.md`.

When the editable file changes from `pending` to `complete`:

1. Compare it with the immutable baseline and reconcile all semantic edits. Edited Decisions and corrected assumptions are authoritative user input. Preserve explicit `out-of-scope` states with a valid reason and boundary. Promote untouched provisional decisions in this batch to `accepted`. Preserve explicit accepted states.
2. Apply accepted decisions to project knowledge according to the base skill. A provisional decision cannot become a final ADR, context, glossary, or specification decision.
3. For each changed decision or assumption, find transitive descendants using `depends-on`, and invalidate only nodes whose correct recommendation could change. Preserve independent accepted nodes unchanged. Recompute affected recommendations under the reviewed upstream values; keep IDs for the same issues and mark recomputed nodes `provisional`. Recheck an edited descendant against the new upstream value before accepting it; retain its edit as user intent during recomputation.
4. Discover any new load-bearing issues exposed by those changes. Rebuild the full current active tree. If provisional nodes remain, write a new `review-status: pending` baseline and an exact copy as the editable file. Do this only after processing every edit from the completed batch.
5. If no provisional nodes remain, do not open an empty pending batch. Synchronize both files to the reconciled `review-status: complete` tree so the completed batch is not processed again, then continue to cleanup.

Changing `S2` in `S1 → S2 → S4` and `S1 → S3 → S6` recomputes `S4` and preserves `S1`, `S3`, and `S6` if their recommendations do not depend on `S2`. An independent `S7` stays accepted. Changing `S1` can recompute both branches transitively. The graph, not file order, determines invalidation.

## Reporting

After each invocation, state the review status and the next file action. Summarize newly accepted or changed load-bearing decisions. If provisional nodes remain, give their count and link to `decision-tree.md`. Summarize newly deferred concerns and boundaries, and unresolved factual dependencies when present. Follow the base skill for author feedback.

After cleanup runs, always include **Cleanup summary** in the response. For each cleanup change, state what changed and why. If none was needed, say `No cleanup changes were required.` Maintain the base skill's cleanup record in the specification as well.
