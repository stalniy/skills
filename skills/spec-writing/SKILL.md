---
name: spec-writing
description: Draft a software specification from user intent and the current codebase. Use when the user asks to turn an idea, issue, or requested behavior change into a spec, or to identify the functions that a new spec must cover using FAST.
---

# Spec writing

## Establish intent and baseline

Extract the actor, intended outcome, requested behavior changes, and explicit constraints from the request and referenced material. Use the project's domain terms. Treat examples as evidence of intent and generalize them only as far as the request supports.

Trace the affected entry points through the code to externally visible effects. Check relevant contracts, tests, ADRs, configuration, and data definitions for the behavior callers rely on and the constraints the change must respect. Cite the paths and symbols that establish material facts. When sources disagree, state which behavior the code implements, which behavior another source promises, and what the discrepancy means for the proposed change. For a new system or a missing codebase, state the available starting point and mark any unverified constraints.

## Identify functions with FAST

Map the intended behavior with the Function Analysis System Technique (FAST).

1. Name the broader outcome outside the system boundary. Inside the boundary, name the basic function the system must perform to serve that outcome. Use an active verb and a concrete noun for each function and give it an observable result.
2. Ask **How does the system perform this function?** Add the immediate means. When the request names a component or solution, ask what effect would disappear without it. Read each link back with **Why does the system perform this supporting function?** Keep the link when the answer names the parent outcome. Record execution order separately.
3. Check whether sibling functions are jointly required or are alternative means. Ask **What else must happen, and under what conditions?** Walk a successful case and any failure or compatibility cases supported by the evidence. Attach each conditional obligation to the function it accompanies.
4. For each function, trace its effect to the user's request, a necessary implication of that request, or an existing obligation. Compare the desired effect with the current behavior and identify what needs to be added or changed, and what callers must still be able to rely on. Stop decomposing when the next choice can vary without affecting a requirement or constraint. Record external dependencies at the boundary.

If an answer would change a public contract, ownership boundary, data compatibility, or another costly commitment, use the available evidence to resolve it. Where the user's judgment is needed, ask a focused question with the consequences of the plausible choices. Continue drafting independent requirements and mark unresolved decisions where they affect the contract. Label reversible assumptions as provisional.

## Write and check the specification

Follow the requested format and destination, using the project's spec conventions where applicable. Explain the intended outcome and scope, then describe the relevant current behavior and the target contract. Translate each in-scope function into a requirement with its trigger or preconditions and observable result. Include failure behavior, compatibility constraints, and acceptance cases where they affect the contract. State any required mechanism with the constraint or decision that makes it necessary. Include the FAST map when seeing the function relationships helps the reader or when the user requests it.

Before delivering, check that every in-scope function has a requirement or is covered by a cited existing contract. Check that every requirement serves a function, that acceptance cases distinguish the requested change from the baseline, and that each unresolved decision names the behavior it affects.
