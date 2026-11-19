---
name: spec-review
license: Apache-2.0
description: Verify a specification for defects before implementation and recommend which requirements formal methods (Quint, TLA+, Lean) should check. Use after spec-grilling, typically in a subagent, or when the author wants a final jidoka check of a spec.
---

Verify the specification the way we verify code. A spec can contain bugs, and every implementation decision builds on it.

Report each defect that would carry into code, so the author can resolve it first.

This skill is a read-only verification pass. Report findings. Leave the specification, ADRs, glossary, and decision graph unchanged.

## Input and independence

Review the specification as it stands now. A grilling session usually settled its load-bearing decisions. Treat the grilled spec as the artifact under test, not as proof of quality.

- Read `GLOSSARY.md` when present and use its terms.
- Read relevant ADRs, tests, configuration, and code that the spec touches.
- Read `.spec-grill/<spec-slug>/decision-graph.ai.md` when present, with the [decision graph contract](references/decision-graph.md). Accepted decisions are settled. Deferred issues keep their boundary. Provisional decisions are unverified claims.
- Do not reopen an accepted decision because another option is better. Report it when it contradicts another requirement, an ADR, or evidence.

## Checks

Run every check. Cite the spec passage, ADR, or code that shows each finding.

1. **Internal contradiction.** Can all requirements hold at the same time? Compare each requirement with every other requirement that shares an entity, state, or trigger. Include requirements added by grilling.
2. **ADR conflict.** Does the spec reverse or weaken an accepted ADR? If the change is intentional, name the ADR that needs an update. If it is accidental, name the requirement that must change.
3. **Ambiguity.** Could two reasonable implementations behave differently while both appear to satisfy the spec? Write both readings.
4. **Missing information.** Are failure cases, boundaries, ordering, concurrency, and recovery rules undefined? Walk each state and transition, including cancel, retry, timeout, and partial failure.
5. **Assumption.** What must the implementer guess? Mark each guess that needs a human decision.
6. **Observable behavior change.** What will users or dependent systems experience differently? Is the change intentional, testable, and backward compatible? Check APIs, events, persisted data, and defaults.
7. **Upfront refactoring.** Does the current structure make the change unnecessarily hard or risky? Name the refactor that should happen first and why.

## Select findings

Keep attention on decisions that affect architecture or behavior, or that are expensive to reverse. Report a lower-impact defect only when it is a certain, cheap fix. Fold it into a single `Minor` line.

Check project evidence before you raise a finding. When evidence settles it, report the settled answer, not a question.

For each finding, make the author's next step clear:

- **Stop** — implementation would build on a defect. A human must decide.
- **Clarify** — the spec can be fixed from evidence or by a local edit. Give the proposed wording.

## Formal verification candidates

Prose has limits. A requirement can sound clear until we describe every state and transition. Identify requirements where a formal model finds defects that review and tests miss.

Recommend only requirements that meet a property type below. Skip plain CRUD, validation, and formatting rules.

| Property type | Tool | Example |
| --- | --- | --- |
| Concurrent or interleaved actions on shared state; races; ordering | **Quint** | A cancelled order must never ship, even when cancel and dispatch race. |
| Safety and liveness of distributed protocols, retries, leader election, or fairness assumptions, especially when the team already uses TLA+ | **TLA+** | Every accepted message is eventually processed after any number of crashes. |
| Invariants over data or arithmetic that must hold for all inputs, or a pure algorithm needing a proof | **Lean** | Every allowed inventory operation keeps stock non-negative. |

Quint and TLA+ explore behavior within the chosen model and bounds and show a counterexample trace. Lean proves a stated property under explicit assumptions. Prefer Quint when both model-checkers fit. Choose TLA+ for liveness, refinement, or an existing TLA+ practice.

For each candidate give:

- the requirement and its source passage;
- the property: the invariant, the temporal property, or the race to check;
- the tool and why it fits;
- the assumptions and bounds the model needs (for example, number of actors, queue size);
- the finding it could expose, when a check above already suggests one.

Rank candidates by cost of a missed defect. State when the spec has no worthwhile candidate.

Recommend the formal model; do not write it. Note that a verified model also yields traces and counterexamples the author can turn into acceptance and edge-case tests.

## Report

Return one report. Lead with the verdict.

```md
## Spec review: <spec title>

**Verdict:** `stop` | `clarify` | `ready`
**Basis:** <spec revision or file, ADRs and evidence read>

### Findings

#### F1 — <title> · <check name> · stop | clarify

**Evidence:** <passage, ADR, or code reference>

**Problem:** <contradiction, two readings, missing rule, or hidden assumption>

**Resolution needed:**

> <question for the author, or the smallest spec change>

### Minor
<one line per cheap fix, or `None`>

### Formal verification candidates
<table or list from the section above, or `None`>
```

Use `ready` only when no `stop` finding exists. List `stop` findings first. Write `None` under an empty section. Keep each finding to what a reader needs to decide.

## Completion

Finish when every check ran against the whole spec, each finding cites evidence, each requirement with a qualifying property type has a recommendation, and the verdict is stated. Do not start implementation or edit the spec. The caller owns clarification with the author and the next review pass.
