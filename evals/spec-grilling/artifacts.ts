import { expect } from "vitest";
import { parse } from "yaml";
import type { ReviewTurn } from "./review.ts";

const graphPathPattern = /^\.spec-grill\/[^/]+\/decision-graph\.ai\.md$/;
const automaticGraphPathPattern = /^\.spec-grill\/[^/]+\/decision-graph\.md$/;

export function expectDecisionGraph(turn: ReviewTurn, status: "in-progress" | "complete") {
  const paths = Object.keys(turn.after);
  const graphPaths = paths.filter(path => graphPathPattern.test(path));
  expect(graphPaths, `Interactive graph paths in ${turn.artifacts}`).toHaveLength(1);
  const path = graphPaths[0]!;
  const contents = turn.after[path]!;
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(contents);
  expect(frontmatter, `Decision-graph frontmatter in ${turn.artifacts}`).not.toBeNull();
  expect(parse(frontmatter![1]!)).toMatchObject({
    "review-mode": "interactive",
    "review-status": status,
  });
  expect(paths.filter(path => automaticGraphPathPattern.test(path))).toEqual([]);
  if (status === "complete") {
    const links = Array.from(turn.output.matchAll(/\[[^\]\n]+\]\(<?([^)>\n]+)>?\)/g), match => match[1]!);
    expect(links.some(link => link === path || link.endsWith(`/${path}`)), `Link to ${path} in ${turn.artifacts}`).toBe(true);
  }
  return { path, contents };
}

export function graphNodes(graph: string) {
  return Array.from(graph.matchAll(/^## (I\d+)[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/gm), ([, id, body]) => {
    const status = /^status:[ \t]*(\S+)[ \t]*$/m.exec(body!)?.[1];
    const dependencies = /^depends-on:[ \t]*(.+)$/m.exec(body!)?.[1];
    expect(dependencies, `depends-on for ${id}`).toBeDefined();
    const evidence = body!.split(/^### /m).find(section => /^Evidence[ \t]*\r?\n/.test(section));
    expect(evidence?.slice(evidence.indexOf("\n") + 1).trim(), `Evidence for ${id}`).toBeTruthy();
    return { id, status, dependsOn: parse(dependencies!) };
  });
}

export function expectClosingSections(turn: ReviewTurn, { noDeferrals = false } = {}) {
  const spec = turn.after["SPEC.md"] ?? "";
  const tail = /^## Out of scope[ \t]*\r?\n([\s\S]+?)^## Cleanup summary[ \t]*\r?\n([\s\S]+)$/m.exec(spec);
  expect(tail, `Closing sections of SPEC.md in ${turn.artifacts}`).not.toBeNull();
  const [, scope, cleanup] = tail!;
  expect(scope!.trim()).not.toBe("");
  expect(cleanup!.trim()).not.toBe("");
  expect(`${scope}${cleanup}`).not.toMatch(/^#{1,2}\s/m);
  if (noDeferrals) expect(scope!.trim()).toMatch(/^None\.?$/i);
}
