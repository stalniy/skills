# Redo: function versus mechanism

Required function:

> After verification fails, run the workflow again with revised input.

A provisional design chooses persistent workflow history. Its consequences include traversal, a top-of-history restriction, nested propagation, invalidation, cache coordination, and execution-pointer semantics.

Trace these obligations to the history choice. Determine whether history provides a required guarantee or merely implements redo.

One candidate is local control flow:

```ts
while (true) {
  const result = await workflow(input)

  if (result.kind === "redo") {
    input = result.input
    continue
  }

  return result
}
```

This is a candidate HOW, not proof of equivalence. Check the actual contract:

- Must redo survive a process crash or target a historical step?
- Does restarting repeat external side effects? What required guarantee prevents an incorrect repetition?
- Who validates cached steps against revised input? Can existing cache semantics remain correct without history-based invalidation?
- Is redo local to one invocation, or must nested or concurrent work coordinate?
- What termination, cancellation, and resource constraints already apply?

If only local reruns are required and existing execution and cache behavior remain correct, replace the provisional history choice. Retire issues that exist solely to support it. Keep independent caching and side-effect constraints.

If durable replay is an accepted requirement, preserve it. Consider whether a smaller durable mechanism satisfies the same guarantee. If dropping durability is the only meaningful reduction, record that requirement change for review.

If cache validity or side-effect behavior is unknown, identify missing evidence. Do not claim a loop preserves those semantics merely because cached steps can sometimes be reused.
