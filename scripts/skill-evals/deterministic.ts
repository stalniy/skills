const openQuestionPatterns = [
  /\bwhat should\b/i,
  /\bwhich .* do you want\b/i,
  /\bdo you want\b/i,
  /\bwould you like\b/i,
  /\bhow should\b/i,
];

export function deterministicScore(response: string, expected: DeterministicExpectation): DeterministicResult {
  const problems: string[] = [];
  const interactiveIssueCount = [...response.matchAll(/^🔎\s+\*\*S\d+\b/gm)].length;
  if (expected.interactive_min !== undefined && interactiveIssueCount < expected.interactive_min) {
    problems.push(`interactive issues ${interactiveIssueCount} < min ${expected.interactive_min}`);
  }
  if (expected.interactive_max !== undefined && interactiveIssueCount > expected.interactive_max) {
    problems.push(`interactive issues ${interactiveIssueCount} > max ${expected.interactive_max}`);
  }
  if (expected.must_contain_any?.length && !expected.must_contain_any.some(term => response.toLowerCase().includes(term.toLowerCase()))) {
    problems.push("none of must_contain_any matched");
  }
  for (const term of expected.must_not_contain ?? []) {
    if (response.toLowerCase().includes(term.toLowerCase())) problems.push(`forbidden text present: ${term}`);
  }
  for (const pattern of expected.must_not_match ?? []) {
    if (new RegExp(pattern, "is").test(response)) problems.push(`forbidden regex matched: ${pattern}`);
  }
  if (expected.forbid_open_design_questions) {
    for (const pattern of openQuestionPatterns) {
      if (pattern.test(response)) problems.push(`open design question matched: ${pattern.source}`);
    }
  }
  return { pass: problems.length === 0, interactive_issue_count: interactiveIssueCount, problems };
}

export type DeterministicExpectation = {
  interactive_min?: number;
  interactive_max?: number;
  must_contain_any?: string[];
  must_not_contain?: string[];
  must_not_match?: string[];
  forbid_open_design_questions?: boolean;
};

export type DeterministicResult = {
  pass: boolean;
  interactive_issue_count: number;
  problems: string[];
};
