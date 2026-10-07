---
name: spec-grilling-auto
license: Apache-2.0
description: Review a specification automatically with provisional load-bearing decisions and a dependency-aware decision graph for later file review. Use for unattended or automatic spec grilling, or when the user wants to edit a Markdown decision graph instead of resolving issues interactively. For interactive accept/edit/out-of-scope review, use spec-grilling.
disable-model-invocation: true
---

# Automatic specification review

Before any review work, read [`../spec-grilling/SKILL.md`](../spec-grilling/SKILL.md). It is the authority for load-bearing classification, evidence, stress testing, scope, unknown facts, language, knowledge artifacts, cleanup, and completion. This skill changes the interaction and execution model only. Where interaction mechanics differ, follow this skill. **The agent owns the recommendation. The user owns scope and veto.**

## Run order

1. Read [`../references/decision-graph.md`](../references/decision-graph.md) before discovery or graph changes. Locate the specification and its stable review directory according to that contract.
2. Before new discovery, migrate legacy `decision-tree.ai.md` and `decision-tree.md` to the corresponding `decision-graph` names when no destination exists, preserving their exact contents and edits. If old and new artifacts coexist, preserve them and resolve the conflicting review state before publishing. Legacy files without `review-mode` follow this automatic protocol. Then inspect any existing `decision-graph.ai.md` and `decision-graph.md` there. If both exist, run `diff -u` on them and reconcile the review as described below. A nonzero exit status means differences, not a failed review. If the sole agent graph has `review-mode: interactive`, treat it as input from an interactive review rather than an incomplete automatic batch. Preserve accepted decisions and valid scope boundaries; discover only remaining uncertainty, and create an automatic pair when publishing. If an interactive graph and a companion file coexist, reconcile their provenance before writing. Otherwise, if only one exists, preserve it and report the incomplete pair; recover the missing file only when its intended contents are unambiguous.
3. If a review batch is pending, preserve it. Continue only work that cannot conflict with that batch. Do not infer acceptance from silence or overwrite either file.
4. If there is no pending batch, follow the base skill's evidence and stress-testing rules. Explore every in-scope load-bearing branch using supported provisional recommendations.
5. Write the active decision graph. If it contains provisional decisions, start a pending review batch as described below. Stop before final cleanup. Resume automatically on the next invocation; the user needs only to edit `decision-graph.md`.
6. If discovery leaves no provisional nodes, write both files with `review-mode: automatic` and `review-status: complete`, without opening an empty pending batch. When all in-scope load-bearing decisions are accepted or validly out of scope, apply accepted knowledge and perform the base skill's cleanup. If cleanup exposes a load-bearing issue, stop cleanup, add that issue to the graph, and start a new pending batch.

Do not present provisional decisions as user-approved. Temporary consequences used to explore a branch must be clearly provisional and reversible. Keep final specification, ADR, `CONTEXT.md`, and `GLOSSARY.md` knowledge tied to accepted decisions only; reconcile stale consequences after a changed decision.

## Decision graph

Use the shared decision graph contract for structure, IDs, metadata, dependencies, statuses, provenance, and changes. Use the base skill for load-bearing classification and review policy. This mode explores supported dependent recommendations provisionally and uses `review-mode: automatic` with `review-status: pending` or `complete`. Publication follows the two-file protocol below rather than the interactive graph-update schedule.

## Two-file review protocol

The review directory contains:

- `decision-graph.ai.md`: the exact agent-generated baseline for the active batch. Keep it unchanged while that batch is pending.
- `decision-graph.md`: the user-editable copy. At batch creation it must be byte-identical to the baseline. Both files use `review-mode: automatic`.

The user may edit `Decision`, decision status, `Assumptions`, `Out-of-scope reason`, `Boundary`, and `review-status` in `decision-graph.md`. They complete a batch by changing `review-status: pending` to `review-status: complete`. This is the complete review interface. Use the filesystem; do not depend on Git, an editor API, comments, or hidden external state.

Before continuing a review, run:

```bash
diff -u .spec-grill/<spec-slug>/decision-graph.ai.md .spec-grill/<spec-slug>/decision-graph.md
```

Interpret semantic changes to the editable fields as feedback. Ignore formatting-only differences such as wrapping, spacing, or punctuation that does not change meaning. Keep ambiguous edits intact and ask for clarification only when their meaning is required to proceed. Preserve other unexpected edits until you can safely reconcile them; do not silently discard user input.

While `review-status` is `pending`, keep the batch and all user edits. Untouched provisional nodes stay provisional. A changed individual status does not complete the batch. Do not create a replacement batch or normalize `decision-graph.md`.

When the editable file changes from `pending` to `complete`:

1. Compare it with the immutable baseline and reconcile all semantic edits. Edited Decisions and corrected assumptions are authoritative user input. Preserve explicit `out-of-scope` states with a valid reason and boundary. Promote untouched provisional decisions in this batch to `accepted`. Preserve explicit accepted states.
2. Apply accepted decisions to project knowledge according to the base skill. A provisional decision cannot become a final ADR, context, glossary, or specification decision.
3. For each changed decision or assumption, find transitive descendants using `depends-on`, and invalidate only nodes whose correct recommendation could change. Preserve independent accepted nodes unchanged. Recompute affected recommendations under the reviewed upstream values; keep IDs for the same issues and mark recomputed nodes `provisional`. Recheck an edited descendant against the new upstream value before accepting it; retain its edit as user intent during recomputation.
4. Discover any new load-bearing issues exposed by those changes. Rebuild the full current active graph. If provisional nodes remain, write a new `review-status: pending` baseline and an exact copy as the editable file. Do this only after processing every edit from the completed batch.
5. If no provisional nodes remain, do not open an empty pending batch. Synchronize both files to the reconciled `review-status: complete` graph so the completed batch is not processed again, then continue to cleanup. Synchronize the completed pair after cleanup as well.

Changing `S2` in `S1 → S2 → S4` and `S1 → S3 → S6` recomputes `S4` and preserves `S1`, `S3`, and `S6` if their recommendations do not depend on `S2`. An independent `S7` stays accepted. Changing `S1` can recompute both branches transitively. The graph, not file order, determines invalidation.

## Reporting

After each invocation, state the review status and the next file action. Link `decision-graph.ai.md` as the input for downstream complexity reduction. A pending baseline remains immutable; reduction must not rewrite it during human review. Summarize newly accepted or changed load-bearing decisions. If provisional nodes remain, give their count and link to `decision-graph.md`. Summarize newly deferred concerns and boundaries, and unresolved factual dependencies when present. Follow the base skill for author feedback.

After cleanup runs, always include **Cleanup summary** in the response. For each cleanup change, state what changed and why. If none was needed, say `No cleanup changes were required.` Maintain the base skill's cleanup record in the specification as well.
