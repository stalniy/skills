---
name: spec-learning
license: Apache-2.0
description: Turn evidence from a specification review into drafting habits the author can reuse. Use when the author asks what they can learn from a particular draft, review conversation, or set of findings.
---

Help the author write a better specification on a different subject. Ground feedback in observed writing gaps and the planning habits that would have prevented them.

## Evidence

Use available evidence from the specification and its review. A grilling session is one source; this skill also works with other specification reviews.

| Source | What it supports |
| --- | --- |
| Original draft or before/after diff | What the author stated, omitted, or left ambiguous before review. |
| Review findings or conversation | Why a gap mattered, what clarification was needed, and how it was resolved. |
| Decision graph | Recorded issues, evidence, dependencies, recommendations, and their review status. |
| Author responses | Intent, deliberate scope choices, corrections to the reviewer, and explanations already supplied. |
| Revised spec, ADRs, context, glossary, or relevant code | Verification of a finding or its resolution against project evidence. |

Start with the material provided and inspect relevant linked evidence. Use the original draft when available to distinguish a writing gap from a new requirement, a changed constraint, or a reviewer preference. A final specification alone shows current content; it does not establish what was missing before review.

When consuming a grilling decision graph, read the [decision graph contract](references/decision-graph.md) for statuses and provenance. Read a pending baseline and editable companion together when available. Distinguish the recommendation from the author's response. Leave review artifacts unchanged.

Work with partial evidence when it supports useful feedback. State the limitation and narrow the claim. Request missing material only when it is needed to support the requested feedback. If no material writing gap is supported, say so.

## Derive lessons

1. Cite the draft passage, review finding, graph issue ID, or conversation statement that shows the gap. Identify what a reader could not determine from the specification. Describe an impact as observed only when the source documents it. Label any predicted impact as a risk.
2. Identify the writing or planning habit that would have exposed the gap earlier. Prioritize gaps that caused strategic uncertainty, costly rework, repeated clarification, or a recurring misunderstanding. Lower-impact cleanup can support a lesson when it exposes a useful pattern.
3. Account for intent and review status. A deliberate deferral with a valid boundary is not a writing failure. An accepted recommendation is evidence of a resolution, not proof that the original draft was defective. For a provisional finding, teach only what the evidence already establishes and label unresolved interpretations.
4. Test transfer: would the lesson still tell the author what to examine or decide in an unrelated specification? Keep the concrete issue as evidence and express the habit above its domain terms, chosen fix, and implementation details.
5. Group findings that share one habit. Call a pattern recurring only when multiple examples support it. One consequential gap can justify a lesson; it does not establish a recurring author weakness.

Useful habits include:

- Identify who has authority over a shared fact before specifying how participants coordinate around it.
- Define the guarantees people can rely on before choosing the mechanism that provides them.
- Separate decisions the specification must make from values supplied by an external authority or configuration.
- State the boundary of deferred work so current requirements do not silently depend on it.

Omit a lesson when it only restates the issue, recommends the same fix, or offers generic advice without an actionable check. Describe the observed writing, rather than inferring the author's ability, motives, or understanding.

## Feedback

Give a concise set of the most useful lessons. Connect the evidence, habit, and next-spec check in each one.

- **Evidence.** Cite the source and name the decision the reader could not make. Include documented impact when available and label any predicted impact as a risk.
- **Habit.** Identify a transferable principle that would have prevented or exposed the gap.
- **Next-spec check.** Give a concrete question or action the author can use while drafting another specification.

Summarize shared patterns when supported, rather than listing every review decision. Keep feedback separate from project requirements. Producing learning feedback does not accept recommendations, reopen settled decisions, revise the specification, or resume its review.

### Example from a report API draft

> **Evidence.** The “Report API” section says a report can take up to 20 minutes and leaves open whether `POST /reports` waits for the report or returns a job. A client developer cannot tell whether a successful response means the report is ready.
>
> **Habit.** When work can continue after acknowledgement, define what the acknowledgement guarantees.
>
> **Next-spec check.** At each handoff, what can the recipient safely do next?
