---
name: spec-grilling
license: Apache-2.0
description: Stress-test and improve a specification by resolving strategic, hard-to-reverse uncertainty first, then fixing lower-impact issues. Use when the user wants to review, refine, challenge, or improve a spec before implementation.
disable-model-invocation: true
---

Review the specification until it has enough certainty for implementation.

Do not interview the user or turn every gap into a question.

Resolve **load-bearing uncertainty** interactively. Resolve lower-impact uncertainty yourself after the load-bearing decisions are settled.

The goal is **minimum sufficient certainty**: a competent implementer should be able to proceed without asking the author a strategic, hard-to-reverse design question.

## Language and terminology

Before review, read `GLOSSARY.md` when present. Use its established domain terms. Normalize synonyms only after confirming they name the same concept. Report terms with multiple meanings.

Use ASD-STE100-style Simplified Technical English. Write short, direct sentences, prefer active voice, and make requirements observable and testable where possible.

## Load-bearing issues

A decision is **load-bearing** only when both conditions hold:

1. **Strategic impact:** Reasonable alternatives materially change required behavior, architecture, contracts, ownership, or future design choices.
2. **High change cost:** Reversing the choice later would require significant redesign, migration, compatibility work, coordination, rollout risk, or revalidation.

Choosing which component owns authoritative state meets both tests when moving ownership later requires migration. A business default can affect important behavior and still belong in cleanup when it is cheap to reverse.

## Evidence and unknown facts

Before raising an issue, check relevant project evidence, including specifications, ADRs, tests, configuration, domain documents, and code. If the evidence settles the decision, use it. When project evidence conflicts with the specification or an accepted decision, report the mismatch. Preserve any settled requirement and apply the load-bearing test to choices that remain open.

For an open design choice, recommend the best-supported option. Mention alternatives when they clarify a material trade-off. For a missing fact, inspect its authoritative source when accessible and use the value it establishes. If the value remains unknown, record the factual dependency and its source. Parameterize an unknown value when its exact value is non-load-bearing. If the missing fact blocks a load-bearing decision, identify that decision.

State the behavioral guarantee at the highest level that resolves the issue. When a feature extends an existing abstraction, specify which behavior the shared implementation owns and which details may vary behind its extension interface. If the interface lacks required information, consider extending it before duplicating shared behavior. For a proposed exception, identify which required behavior differs. Differences in data, encoding, rendering, or metadata alone are insufficient.

## Interactive review

The agent owns the recommendation. The user owns scope and veto.

Present the **load-bearing frontier** together: all open load-bearing issues
that can be decided independently with the available evidence. If one choice
could change another recommendation, defer the dependent issue until all
its prerequisites are settled.

Use this format for each issue:

```md
🔎 **I1 — <issue title>**

**Issue:** <material ambiguity, contradiction, or missing strategic decision>

**Why it is load-bearing:** <strategic constraint and later change cost>

**Recommendation:**

> <smallest sufficient specification change>

`accept (a)` · `edit (e)` · `out of scope (o)`
```

Copy the action line verbatim under each issue. Accept replies that pair a
shortcut with an issue ID, such as `a I1`, `e I1: <revision>`, and `o I1`.
Apply accepted decisions and user edits to the relevant project knowledge.
For deferred issues, follow “Out of scope.” Recompute the graph after each
decision and present the next frontier. When all in-scope load-bearing
issues are settled, proceed to cleanup.

## Out of scope

`out of scope` means the concern is intentionally deferred from the current specification.

It does not mean the concern is solved or invalid.

If project evidence already places an open concern outside the current
requirements and establishes a boundary that lets every in-scope guarantee
hold independently, treat the scope as settled. Keep the concern out of the
interactive frontier. Record the concern and its existing boundary in the
specification and decision graph during cleanup, and cite the evidence in the
graph.

An out-of-scope issue is settled for the current specification only when in-scope behavior does not require its resolution.

If an in-scope decision depends on it, recommend one of these:

- move the dependent behavior out of scope;
- define a boundary contract that isolates the deferred decision;
- bring the decision back into scope.

Do not describe the specification as implementation-ready while an unresolved deferred decision can materially change in-scope design.

## Cleanup mode

Resolve lower-impact uncertainty yourself and preserve accepted decisions. If cleanup exposes a choice that meets both load-bearing tests, pause cleanup and return that choice to the frontier.

In the final response, report each cleanup issue and its resolution, including issues resolved without an artifact edit. Group them by which load-bearing test they meet:

1. Strategic impact only.
2. High change cost only.
3. Neither.

Leave empty groups empty. If cleanup found no issues, say so.

## Decision graph

Read [the graph contract](references/decision-graph.md) before discovery or graph changes. If an automatic batch is pending, preserve both files and follow `spec-grilling-auto` before writing. Reconcile any existing graph with the specification and project evidence. Carry forward settled decisions with their provenance.

In interactive review, maintain only `decision-graph.ai.md`. Explore only the current frontier and keep provisional recommendations in the graph. Write the graph before presenting each frontier and after each user decision once affected recommendations have been recomputed.

After final cleanup, write the complete graph even if review found no new issues. Include all identified in-scope load-bearing decisions and relevant scope boundaries.

## Knowledge artifacts

Apply accepted decisions, user edits, and cleanup resolutions to the relevant artifacts:

- **Specification** — required behavior, constraints, and scope.
- **ADR** — an accepted architectural or strategic decision that is expensive to reverse, and its rationale.
- **GLOSSARY.md** — new, changed, clarified, or normalized domain terms.

Keep these two sections current at the end of the specification, in this order:
1. `## Out of scope` — each deferred issue and its current boundary. Deferral leaves the proposed resolution open.
2. `## Cleanup summary` — each cleanup issue and its resolution, including issues resolved without an artifact edit.

Write `None` under either heading when it has no entries.

## Completion

Before finishing, ask “Could an implementer satisfy every behavioral requirement while bypassing the intended abstraction or duplicating its responsibilities?” If yes, resolve the ambiguity from project evidence or raise it when it meets both load-bearing tests.

Finish when every load-bearing issue is accepted or deferred behind a valid boundary, important assumptions and factual dependencies are explicit, terminology is consistent, and cleanup and relevant artifact updates are complete. Leave safely configurable values and local implementation choices open.

Provide or apply the updated specification and supporting artifact changes. Summarize accepted decisions, important deferrals and their boundaries, and unresolved factual dependencies. Include the cleanup report, a Markdown link such as `[Decision graph](.spec-grill/<spec-slug>/decision-graph.ai.md)` using the actual graph path, and its review status. Begin implementation only when the user explicitly requests it.
