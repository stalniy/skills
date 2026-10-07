---
name: spec-grilling
description: Stress-test and improve a specification by resolving strategic, hard-to-reverse uncertainty first, then fixing lower-impact issues. Use when the user wants to review, refine, challenge, or improve a spec before implementation.
disable-model-invocation: true
---

Review the specification until it has enough certainty for implementation.

Do not interview the user or turn every gap into a question.

Resolve **load-bearing uncertainty** interactively. Resolve lower-impact uncertainty yourself after the load-bearing decisions are settled.

The goal is **minimum sufficient certainty**: a competent implementer should be able to proceed without asking the author a strategic, hard-to-reverse design question.

## Core principle

**The agent owns the recommendation. The user owns the scope and veto.**

For each load-bearing issue, recommend the best concrete resolution.

The user can:

- `accept`;
- `edit`;
- mark it `out of scope`.

Do not transfer design work to the user when you can make a supported recommendation.

Before you add an issue to the load-bearing frontier, try to resolve it from available evidence.

Inspect relevant code, tests, specifications, ADRs, configuration, `CONTEXT.md`, and `GLOSSARY.md`.

Do not ask the user to settle a decision that the existing project evidence already settles.

If project evidence contradicts the specification or another accepted decision, treat the contradiction as a candidate issue.

## Load-bearing issues

A decision is load-bearing only when **both** conditions are true:

1. **Strategic impact:** Different reasonable choices materially constrain important behavior, architecture, contracts, ownership, or future design decisions.
2. **High change cost:** Changing the decision later would require significant redesign, migration, compatibility work, coordination, rollout risk, or revalidation.

Ask:

> Does this decision materially constrain important behavior or future design?

> Will changing it later have a significant cost or blast radius?

Only issues with two `yes` answers belong in the interactive frontier.

Typical load-bearing areas include:

- core domain semantics;
- durable public contracts;
- system boundaries;
- component responsibilities;
- state ownership and source of truth;
- major data-model choices;
- major control flow;
- consistency guarantees;
- security and authorization boundaries;
- failure and concurrency models;
- migration and compatibility strategy.

Observable behavior is not automatically load-bearing. It must form a durable semantic expectation or contract whose later change creates significant risk or migration work.

Examples:

- Authoritative state ownership that would require migration later → load-bearing.
- Sync versus async public API used by external consumers → load-bearing.
- Configurable timeout → cleanup.
- Configurable retry count → cleanup.
- Feature-flag default that is easy to change → cleanup.
- Validation message wording that is not a stable contract → cleanup.

A lower-impact detail can become load-bearing if its possible values materially change both strategic constraints and later change cost.

## Load-bearing frontier

Model the specification as a design tree.

The **load-bearing frontier** contains load-bearing issues that can be resolved independently with the current information.

Present only this frontier to the user.

Do not surface a dependent issue before its prerequisite is settled.

Do not combine a prerequisite decision and its dependent decision into one recommendation.

If accepting one part can change the correct recommendation for another part, split them and defer the dependent issue.

After each user decision:

1. apply accepted or edited decisions;
2. record scope boundaries;
3. update relevant project knowledge;
4. recompute the design tree;
5. present the new load-bearing frontier.

Continue until the frontier is empty.

## Issue format

Use:

```md
🔎 **S1 — <issue title>**

**Issue:** <material ambiguity, contradiction, or missing strategic decision>

**Why it is load-bearing:** <strategic constraint and later change cost>

**Recommendation:**

> <smallest sufficient specification change>

`accept` · `edit` · `out of scope`
```

Prefer the smallest sufficient change.

Fix the specification at the highest level necessary to remove ambiguity and contradictions, reduce uncertainty, and make missing information explicit.

Do not select an implementation mechanism when a behavioral guarantee is sufficient.

## Out of scope

`out of scope` means the concern is intentionally deferred from the current specification.

It does not mean the concern is solved or invalid.

Record the boundary when future work can depend on it.

An out-of-scope issue is settled for the current specification only when in-scope behavior does not require its resolution.

If an in-scope decision depends on it, recommend one of these:

- move the dependent behavior out of scope;
- define a boundary contract that isolates the deferred decision;
- bring the decision back into scope.

Do not describe the specification as implementation-ready while an unresolved deferred decision can materially change in-scope design.

## Cleanup mode

When the load-bearing frontier is empty, resolve lower-impact uncertainty yourself.

Do not start another interactive grilling loop.

Cleanup can include:

- configurable parameters;
- minor failure details;
- terminology inconsistencies;
- testability improvements;
- source references;
- local operational details;
- minor observability requirements;
- wording that creates avoidable uncertainty;
- strategically important but easily reversible defaults.

Apply a cleanup fix when it preserves accepted load-bearing decisions and does not introduce a new load-bearing decision.

If cleanup exposes a decision that satisfies both load-bearing tests, stop cleanup and return it to the load-bearing frontier.

At the end, briefly report the cleanup issues found and how each was resolved. Include issues resolved without an artifact edit. The user can still correct the resolutions.

## Decisions versus unknown facts

The agent owns design recommendations.

The agent does not invent facts.

Distinguish between:

- a missing design decision;
- missing factual information.

For a missing design decision, recommend the best supported option.

For a missing fact, do not invent a value.

Missing facts can include legal requirements, business policy, contracts, external system behavior, production limits, or values controlled elsewhere.

If the exact value is not load-bearing, parameterize it and identify its authoritative source.

Example:

> The audit-log retention period is `X`. `X` comes from the applicable retention policy and is configurable.

Do not invent `X`.

If the authoritative source is available in the repository or through available tools, inspect it first.

## Language and ubiquitous language

Use ASD-STE100-style Simplified Technical English.

Use short, direct sentences. Prefer active voice. Use one term for one concept. Avoid unnecessary synonyms, vague references, idioms, and decorative prose.

Make requirements observable and testable when possible.

Before review, read `CONTEXT.md` and `GLOSSARY.md` if they exist.

Treat their domain terms as the ubiquitous language.

- Use existing domain terms consistently.
- Do not invent synonyms for established concepts.
- If several terms refer to one concept, normalize them.
- If one term refers to several concepts, report the ambiguity.
- Do not replace a technical term only because it looks similar to a glossary term. First determine whether the concepts are the same.
- If `CONTEXT.md` and `GLOSSARY.md` conflict, treat the conflict as an issue.

Do not simplify established domain terms away.

## Knowledge artifacts

Maintain:

- the specification;
- ADRs;
- `GLOSSARY.md`;
- `CONTEXT.md`.

For load-bearing decisions, update artifacts only after `accept` or `edit`.

For `out of scope`, record the scope boundary when it matters for future work. Do not record the proposed resolution as accepted.

During cleanup, update artifacts for lower-impact changes that follow from accepted decisions.

Use each artifact for one purpose:

- **Specification:** required behavior, constraints, and scope.
- **ADR:** important accepted decisions and their reasons.
- **GLOSSARY.md:** ubiquitous language.
- **CONTEXT.md:** stable system context, responsibilities, and important scope boundaries.

At the bottom of the specification, maintain `## Out of scope` followed by `## Cleanup summary`. List each deferred issue and its current scope boundary under `Out of scope`; do not present a proposed resolution as accepted. List each cleanup issue and how it was resolved under `Cleanup summary`, including issues that needed no change to requirements or supporting artifacts. Write `None` under either heading when there are no entries. Keep both sections current as the review progresses.

Create or update an ADR for an accepted architectural or strategic decision that is expensive to reverse.

Update `GLOSSARY.md` when domain terminology is introduced, changed, clarified, or normalized.

Update `CONTEXT.md` when stable concepts, boundaries, responsibilities, ownership, workflow structure, strategic constraints, or scope boundaries change.

Avoid unnecessary duplication between artifacts.

## Repository evidence

When the repository is available, inspect relevant code, tests, specifications, ADRs, configuration, `CONTEXT.md`, and `GLOSSARY.md`.

Use repository evidence to validate assumptions.

When implementation and specification conflict, report the conflict.

Do not silently change the specification to match implementation. The implementation can be wrong or obsolete.

## Preserve user intent

Do not redesign the system according to your preferences.

A preference is not a defect.

Raise an interactive issue only when both load-bearing conditions are present.

Resolve lower-impact choices yourself when a reasonable recommendation does not constrain a strategic, hard-to-reverse decision.

## Author learning

The review should help the author write a better specification on a different subject.

For an important load-bearing issue, identify the planning habit that would have prevented the gap. State that habit as a short lesson when it is useful:

> **Author lesson:** <transferable writing principle>

Test the lesson against an unrelated specification. It should still tell the author what to examine or decide. The issue itself supplies the concrete example; the lesson should rise above its domain terms, chosen resolution, and implementation details.

Useful principles include:

- Identify who has authority over a shared fact before specifying how participants coordinate around it.
- Define the guarantees people can rely on before choosing the mechanism that provides them.
- Separate decisions the specification must make from values supplied by an external authority or configuration.
- State the boundary of deferred work so current requirements do not silently depend on it.

Omit a lesson if it only restates the issue, recommends the same fix, or has no useful application beyond this specification. At the end, summarize recurring writing patterns, not a second list of case-specific decisions. The goal is fewer clarification rounds in the next specification.

## Completion

The load-bearing review is complete when every load-bearing issue is:

- accepted;
- edited and accepted; or
- explicitly out of scope with a valid boundary.

The full review is complete when:

- no unresolved in-scope load-bearing uncertainty remains;
- important assumptions and factual dependencies are explicit;
- lower-impact ambiguity is reasonably cleaned up;
- terminology is consistent;
- relevant ADR, context, and glossary changes are applied.

The specification does not need to resolve values that can safely remain configurable or local implementation choices.

At the end:

1. provide or apply the updated specification;
2. provide or apply ADR, `GLOSSARY.md`, and `CONTEXT.md` changes;
3. summarize accepted load-bearing decisions;
4. list important out-of-scope decisions;
5. report cleanup issues and resolutions as described under Cleanup mode, or state that none were found;
6. list unresolved factual dependencies;
7. provide short feedback for the author.

Do not start implementation unless the user explicitly asks for it.
