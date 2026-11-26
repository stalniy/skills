function graphNodes(review) {
  const requirements = review.source?.requirements ?? [];
  const sourceIds = new Set(requirements.map(requirement => requirement.id));
  const functions = new Map();
  function addFunction(name) {
    if (!functions.has(name)) {
      functions.set(name, { id: `function:${name}`, title: name, status: "function", parents: [], links: [] });
    }
    return functions.get(name).id;
  }

  const sourceNodes = requirements.map(requirement => ({
    id: requirement.id,
    title: requirement.text,
    status: "source-requirement",
    parents: [],
    links: [{ from: addFunction(requirement.function), kind: "group" }],
    requirement,
  }));
  const decisions = Object.entries(review.records).map(([id, record]) => {
    const { issue, resolution, applied, recheck, previous } = record;
    const changes = resolution?.requirement_changes ?? issue.requirement_changes ?? [];
    const affects = [...new Set(changes.map(change => change.id).filter(id => sourceIds.has(id)))];
    const links = affects.map(from => ({ from, kind: "affects" }));
    if (review.source && issue.function && !links.length && !issue.depends_on.length) {
      links.push({ from: addFunction(issue.function), kind: "group" });
    }
    return {
      id,
      status: recheck ? "needs-recheck" : resolution?.status ?? "provisional",
      parents: issue.depends_on,
      links,
      affects,
      blocked: issue.depends_on.some(parent => !review.records[parent]?.applied),
      title: issue.title,
      decision: resolution?.decision ?? issue.recommendation,
      issue,
      resolution,
      applied,
      previous,
    };
  }).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return [...functions.values(), ...sourceNodes, ...decisions];
}

export function statusLabel(node) {
  if (node.status === "source-requirement") return "From source spec";
  if (node.status === "function") return "Function";
  return node.status === "needs-recheck" ? "Needs reassessment" : node.status;
}

function layout(nodes, parents) {
  const depths = new Map();
  depths.set("", 0);

  function depth(id) {
    if (depths.has(id)) return depths.get(id);
    const value = Math.max(...parents.get(id).map(depth)) + 1;
    depths.set(id, value);
    return value;
  }

  const rows = [[{ id: "", parents: [], decision: "Spec review" }]];
  for (const node of nodes) (rows[depth(node.id)] ??= []).push(node);
  return rows;
}

export const NODE_WIDTH = 11.5;
export const NODE_HEIGHT = 4.15;
export const STEP_X = NODE_WIDTH + 1.25;
export const STEP_Y = NODE_HEIGHT + 3;
export const INSET = 1;

export function graphLayout(review) {
  const nodes = review ? graphNodes(review) : [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const children = new Map([["", []], ...nodes.map(node => [node.id, []])]);
  const parents = new Map([["", []]]);
  const edges = [];
  for (const node of nodes) {
    const incoming = node.parents.filter(parent => byId.has(parent)).map(from => ({ from, kind: "prerequisite" }));
    incoming.push(...node.links);
    if (!incoming.length) incoming.push({ from: "", kind: "group" });
    parents.set(node.id, incoming.map(edge => edge.from));
    for (const edge of incoming) {
      children.get(edge.from).push(node.id);
      edges.push({ ...edge, to: node.id });
    }
  }

  const rows = layout(nodes, parents);
  const columns = Math.max(...rows.map(row => row.length));
  const points = new Map();
  rows.forEach((entries, row) => entries.forEach((node, column) => {
    points.set(node.id, {
      x: INSET + STEP_X * (column + (columns - entries.length) / 2),
      y: INSET + STEP_Y * row,
    });
  }));
  return { nodes, byId, children, parents, edges, rows: rows.length, columns, points };
}

export function decisionPaths(graph, selectedId) {
  const paths = new Map();
  if (!graph?.byId.has(selectedId)) return paths;
  const ancestors = reachableDecisions(graph.parents, selectedId);
  const dependents = reachableDecisions(graph.children, selectedId);
  for (const id of graph.points.keys()) {
    let path = "unrelated";
    if (id === selectedId) path = "selected";
    else if (dependents.has(id)) path = "dependent";
    else if (ancestors.has(id)) path = "ancestor";
    paths.set(id, path);
  }
  return paths;
}

function reachableDecisions(adjacency, selectedId) {
  const highlighted = new Set();
  const pending = [selectedId];
  while (pending.length) {
    const id = pending.pop();
    if (highlighted.has(id)) continue;
    highlighted.add(id);
    pending.push(...adjacency.get(id));
  }
  return highlighted;
}

export function drawEdges(view, graph, paths, entering) {
  const canvas = view.querySelector("canvas");
  if (!canvas || !view.clientWidth || !view.clientHeight) return;
  const map = canvas.parentElement;
  const width = Math.min(view.clientWidth, map.clientWidth);
  const height = Math.min(view.clientHeight, map.clientHeight);
  const ratio = window.devicePixelRatio;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.left = `${view.scrollLeft}px`;
  canvas.style.top = `${view.scrollTop}px`;
  const ctx = canvas.getContext("2d");
  ctx.resetTransform();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(ratio, 0, 0, ratio, -view.scrollLeft * ratio, -view.scrollTop * ratio);
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const style = getComputedStyle(view);
  const selectionColor = style.getPropertyValue("--graph-selection").trim();
  const defaultEdgeColor = style.getPropertyValue('--graph-color').trim();
  const ancestorOpacity = Number(style.getPropertyValue("--graph-ancestor-opacity"));
  const unrelatedOpacity = Number(style.getPropertyValue("--graph-unrelated-opacity"));
  const moving = new Map();
  const mapRect = map.getBoundingClientRect();

  function elementAnchors(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left - mapRect.left + rect.width / 2, top: rect.top - mapRect.top, bottom: rect.bottom - mapRect.top };
  }

  for (const node of entering) {
    if (map.contains(node)) moving.set(node.dataset.nodeId, elementAnchors(node));
  }

  function anchors(id) {
    const { x, y } = graph.points.get(id);
    return moving.get(id) ?? {
      x: (x + NODE_WIDTH / 2) * rem, top: y * rem, bottom: (y + NODE_HEIGHT) * rem,
    };
  }

  function traceEdge(start, end) {
    const mid = (start.bottom + end.top) / 2;
    ctx.moveTo(start.x, start.bottom);
    ctx.bezierCurveTo(start.x, mid, end.x, mid, end.x, end.top);
  }

  function edgeOpacity({ from, to }) {
    const source = paths.get(from);
    const target = paths.get(to);
    if (source === "unrelated" || target === "unrelated") return unrelatedOpacity;
    if (source === "ancestor" || target === "ancestor") return ancestorOpacity;
    return 1;
  }

  function strokeEdges(opacity, color, width, affects) {
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(affects ? [5, 4] : []);
    ctx.beginPath();
    for (const edge of graph.edges) {
      if ((edge.kind === "affects") !== affects || edgeOpacity(edge) !== opacity) continue;
      const end = anchors(edge.to);
      traceEdge(anchors(edge.from), end);
      if (edge.kind === "group" || affects) continue;
      ctx.moveTo(end.x - 3, end.top - 6);
      ctx.lineTo(end.x, end.top);
      ctx.lineTo(end.x + 3, end.top - 6);
    }
    ctx.stroke();
  }

  for (const affects of [false, true]) {
    if (paths.size) {
      strokeEdges(unrelatedOpacity, defaultEdgeColor, 1.6, affects);
      strokeEdges(ancestorOpacity, selectionColor, 2.8, affects);
      strokeEdges(1, selectionColor, 2.8, affects);
    } else {
      strokeEdges(1, defaultEdgeColor, 1.6, affects);
    }
  }
}
