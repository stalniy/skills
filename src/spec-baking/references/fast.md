# Function Analysis System Technique (FAST)

Use FAST to discover what a system must accomplish and explain how its functions serve one another. The main path reads from purpose on the left to means on the right. Read it rightward by asking **how?** and leftward by asking **why?**

## Discover functions

1. **Set the scope.** Name the system, who relies on it, and the outcome they need. Identify the basic function by asking “What must this system accomplish to earn its place?” Put the broader purpose it serves just outside the left scope boundary.
2. **Collect candidates from evidence.** Walk through a successful case and a failure case. At each boundary, ask what enters, what changes, what leaves, and who uses the result. For each component or prescribed step, ask “What outcome would disappear if we removed this?” Record the requirement, observation, or example that led to each candidate.
3. **Name each function with an active verb and a concrete noun.** For a review tool, “red banner” names a design choice. Asking what the banner accomplishes might yield *signal conflict*. Split a phrase such as *detect and signal conflicts* so each effect can be tested independently.
4. **Check what each name means.** Describe one observable sign that the function succeeded. Merge candidates when they describe the same effect under different names. Keep performance targets beside the function they qualify. For *signal conflict*, “within one second” supplies a test criterion.

## Build and test the links

Start with the basic function. For each proposed link `A → B`, complete both sentences aloud.

| Direction | Question | Sentence to test |
| --- | --- | --- |
| Rightward | How do we accomplish A? | We accomplish A by doing B. |
| Leftward | Why do we do B? | We do B in order to accomplish A. |

- **Find the immediate means.** If either sentence needs an unstated function to make sense, name it and test the two shorter links. If the only explanation is “B happens next,” record the sequence separately and look for the purpose B serves.
- **Distinguish joint means from alternatives.** Ask whether A can still succeed with B removed and its siblings retained. If several siblings must work together, group them and label the group *all required*. If each could achieve A on its own, record the alternatives and identify which design the diagram describes.
- **Place supporting functions.** Ask “When we perform this function, what else must happen?” Attach a supporting function beside the function it accompanies and state the condition or reason. For example, a requirement to retain review history could attach *record decision* to *resolve conflict*. Identify system-wide support once and state where it applies.
- **Stop at the scope boundary.** Stop moving right when the next answer belongs to an external system or reaches implementation detail beyond the decision at hand. Record an unresolved “how?” as an open question.

## Worked example

A specification review tool must alert an author when two rules prescribe incompatible actions under the same conditions. Take *signal conflict* as the tool's basic function. The author owns the broader outcome of resolving the conflict.

```text
                    |                  ┌─ detect conflict
resolve conflict    |  signal conflict ┤
                    |                  └─ notify author
   broader purpose  |  basic function     both means required
```

Read across the scope line. Why signal a conflict? So the author can resolve it. How does the tool signal a conflict? It detects the incompatible rules and notifies the author. With detection alone, the author receives no signal. A generic notification alone gives the author no indication that the rules conflict. Those checks justify the two branches. The fact that detection happens first describes execution order.

Review the map with someone who uses the system. Ask them to read each link in both directions, challenge each group marked *all required*, and trace one concrete case from the observed effect back to the purpose it serves.
