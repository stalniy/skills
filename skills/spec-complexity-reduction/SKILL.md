---
name: spec-complexity-reduction
license: Apache-2.0
description: Reduce accidental complexity in implementation specifications by analyzing a decision graph and replacing unnecessary provisional mechanisms while preserving required semantics. Use after spec exploration or when architectural machinery appears disproportionate to a requirement. For code refactoring alone, use another workflow.
disable-model-invocation: true
---

# Spec complexity reduction

Reach minimum sufficient design complexity before human review. Challenge the chosen framing, not just the implementation of that framing.

**Essential complexity** comes from required domain behavior, invariants, external systems, safety properties, or operational constraints. **Accidental complexity** comes from the selected framing, abstraction, decomposition, or implementation strategy.

The agent owns the recommendation. The user owns scope and veto.

## Inputs and authority

Before consuming or changing a graph, read [`references/decision-graph.md`](references/decision-graph.md) for the shared artifact contract.

Read the specification, complete decision graph, and relevant project evidence. Inspect code, tests, ADRs, configuration, `CONTEXT.md`, and `GLOSSARY.md` where they establish constraints or explain a hotspot. Use established domain terms consistently.

Read [`../spec-grilling/SKILL.md`](../spec-grilling/SKILL.md) for load-bearing classification, evidence, scope, and unknown facts. A decision is load-bearing when it has both strategic impact and high later change cost. This pass reduces design complexity; grilling resolves load-bearing uncertainty.

Treat the graph as a projection of load-bearing decisions, not a complete inventory of supporting mechanisms. Inspect the spec and repository for those mechanisms without turning every detail into a decision node.

If requirements or enough of the graph are missing, obtain available evidence first. Analyze independent branches where possible and identify missing inputs. Claim stability only for the branches examined.

## Work before publication

The intended pipeline is:

```text
explore provisional decisions
  → reduce complexity
  → recompute affected decisions
  → repeat until stable
  → publish human-review batch
```

Work on an unpublished graph or an explicitly designated working draft. If the input is an existing reviewed artifact, preserve it and provide proposed replacements or a separate draft. Accepted decisions remain protected even in a writable draft.

For automatic review artifacts, read [`../spec-grilling-auto/SKILL.md`](../spec-grilling-auto/SKILL.md). That skill owns migration, batch reconciliation, publication, and final knowledge updates. Inspect both `decision-graph.ai.md` and `decision-graph.md`, their review metadata, and their `diff -u` before planning changes. A nonzero diff exit status can indicate differences.

A pending batch freezes the agent baseline and preserves all user edits. Analyze it without modifying either file, even when the copies are identical. Return proposed edits for a future batch. A completed automatic batch must be reconciled by its owning protocol before this pass changes affected working branches. Preserve incomplete pairs and unexpected edits; leave recovery to that protocol. An interactive graph does not require a companion file.

Keep provisional changes out of the final specification, ADRs, `CONTEXT.md`, and `GLOSSARY.md`. This skill does not publish review batches or implement the proposed system.

## Find hotspots

Scan the whole graph and its supporting design for concrete signals:

- One requirement causes many mechanisms or new invariants.
- Local behavior requires global state or parent orchestration.
- A feature introduces history, replay, traversal, or coordination machinery.
- An abstraction mainly supports another abstraction.
- Components must stay synchronized because of an earlier design choice.
- A general mechanism serves one local use case.
- A mechanism appears in requirements without a behavioral reason.
- Removing one decision could collapse many downstream obligations.

These signals prioritize investigation. They do not prove a defect. A small branch can hide expensive machinery; a large branch can represent essential complexity.

Investigate the causal decision, not just its symptoms. Combine overlapping hotspots that arise from the same choice. Keep independent branches independent.

## Analyze a hotspot

### Recover WHAT and WHY

State the underlying function in observable behavioral terms. Cite its requirement or authoritative source. Separate required outcomes and constraints, accepted decisions and explicit user direction, provisional implementation choices, and assumptions or unknown facts.

An implementation-shaped requirement is a candidate for reopening, not permission to discard it. Broaden the question only when the graph or evidence shows why a higher-level choice materially determines this hotspot.

Identify the originating decision and the mechanisms, state, invariants, and coordination obligations it causes. Explain which obligations follow from required semantics and which follow only from this HOW. Record concise evidence and rationale, not hidden reasoning.

### Generate simpler HOWs

Use the lenses relevant to this hotspot:

| Lens | Question |
| --- | --- |
| Locality | Can the behavior belong to the component that needs it? |
| Requirement relaxation | Is this design providing a stronger guarantee than required? |
| Primitive substitution | Can a loop, call, recursion, state machine, queue, transaction, constraint, or existing runtime behavior provide the function? |
| Abstraction collapse | Can abstractions combine without losing required semantics? |
| State elimination | Can derived, persistent, or coordinated state disappear? |
| Responsibility relocation | Would another layer own this behavior with fewer obligations? |
| WHY/HOW reset | If this mechanism disappeared, what function would still be required? |

Distinguish dropping an unrequired design guarantee from relaxing an actual requirement. The latter needs review. Generate credible alternatives, not a quota. Prefer locality and ordinary primitives when they satisfy the constraints.

### Compare semantics and burden

Compare alternatives with the current design against original requirements and relevant load-bearing decisions. Inspect failure, concurrency, side effects, recovery, ordering, caching, compatibility, security, and performance where the hotspot makes them relevant.

State what remains equivalent, what machinery disappears, and what cost or uncertainty the alternative introduces. Validate consequential claims against evidence or concrete execution scenarios. A short code example alone does not establish equivalence.

A meaningful reduction removes a mechanism, state obligation, invariant, coordination boundary, or comparable implementation burden without shifting an equal or greater burden to callers, operators, storage, or another layer. Fewer words or graph nodes alone are insufficient.

### Apply or reopen

| Outcome | Action |
| --- | --- |
| Supported simplification preserves requirements, accepted decisions, and user direction | Rewrite affected provisional working decisions. Keep them provisional. A provisional HOW can be replaced even when it is load-bearing. |
| Simplification changes a load-bearing requirement, accepted decision, explicit user direction, or scope boundary | Preserve the current constraint and record a concrete reopening recommendation for grilling or human review. |
| Equivalence depends on an unknown fact | Identify the fact and authoritative source. Preserve the current choice until evidence supports replacement. |
| Complexity is required, or alternatives offer no meaningful improvement | Retain the design and identify the constraint that justifies it. |

Apply supported reductions autonomously to the authorized draft. A reopening recommendation must state the current constraint, proposed change, benefit, and semantic cost. Do not present it as approved or stop independent simplifications while it awaits review.

## Rewrite the affected graph

Follow the shared contract for schema, statuses, metadata, stable IDs, dependencies, retirement, and reopening. Leave review completion to its owning protocol.

Update affected decisions, evidence, assumptions, alternatives, and rationale. Keep `Why load-bearing` accurate. Include reopening recommendations in the reduction report as required by the shared contract.

Recompute recommendations whose correct values could change, including transitive descendants and dependents shared across branches. Rebuild `depends-on` and `affects` to agree. Preserve independent decisions. Recomputed provisional recommendations remain provisional; accepted constraints stay authoritative unless human review changes them.

Retire obsolete provisional issues when a simplification eliminates the issue itself. Record the retired IDs and reasons in the reduction report.

If rewriting exposes new load-bearing uncertainty, record it provisionally with evidence and a concrete recommendation for grilling. Ensure the resulting graph has no dangling references or contradictory recommendations. Recheck the affected design against protected semantics before another pass.

## Reach a practical fixed point

After each meaningful rewrite, rescan the graph. Revisit rejected alternatives only when changed decisions or new evidence could change their assessment. Stop when a full pass produces no further supported, meaningful simplification.

Avoid alternating between equivalent framings or pursuing a theoretical minimum. If alternatives trade different essential costs and neither dominates, preserve the current choice or present the material tradeoff for review.

Stability is relative to known requirements and evidence. Outstanding reopening recommendations and factual dependencies remain unresolved even when independent reductions are complete. Do not claim implementation readiness while they can materially change in-scope design.

## Report

Provide or link the resulting working graph, or concrete proposed edits when mutation is unavailable. Briefly report:

- Applied reductions: affected IDs, underlying function, removed machinery, and evidence that semantics remain intact.
- Reopening recommendations: protected constraint, alternative, benefit, and semantic cost.
- Retired IDs and reasons.
- Material retained hotspots and their essential constraints.
- Unknown facts and the next review action.

State whether a full pass found no further supported reduction. If none was found, say so; do not manufacture a redesign. Preserve human review for provisional decisions.

For a worked example, read [`references/redo.md`](references/redo.md) when evaluating redo, history, replay, or cache machinery.
