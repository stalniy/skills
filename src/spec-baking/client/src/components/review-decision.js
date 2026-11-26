import { html, LitElement, nothing } from "lit";
import { guard } from "lit/directives/guard.js";
import { keyed } from "lit/directives/keyed.js";
import { statusLabel } from "../graph.js";
import { markdown, markdownInline } from "../markdown.js";

const ACTION_LABELS = { accept: "Accept", edit: "Edit", defer: "Out of scope", clarify: "Clarify" };
// Evidence is free-form prose. Recognize file citations (including line suffixes) and URLs.
const EVIDENCE_REFERENCE = /https?:\/\/[^\s<>`\])]+|(?<![\w@./:-])((?:\.{0,2}\/)?(?:[\w.-]+\/)*[\w-]+(?:\.[\w-]+)*\.(?:[chrsR]|[a-zA-Z][a-zA-Z0-9]{1,9}))(?::\d+(?:(?:-\d+)|(?::\d+))?|#L\d+(?:-L\d+)?)?(?![\w/-]|\.[\w-])/g;

function fieldText(value) {
  return Array.isArray(value) ? value.map(item => "- " + item).join("\n") : value;
}

function decisionField(label, value, className = "decision-field") {
  return value ? html`<section class=${className}><h4>${label}</h4>${markdown(fieldText(value))}</section>` : nothing;
}

function evidenceInline(value) {
  return markdownInline(value, text => {
    const parts = [];
    let offset = 0;
    for (const match of text.matchAll(EVIDENCE_REFERENCE)) {
      if (!match[1]) continue;
      parts.push(text.slice(offset, match.index), html`<code>${match[0]}</code>`);
      offset = match.index + match[0].length;
    }
    parts.push(text.slice(offset));
    return parts;
  });
}

function renderEvidence(evidence) {
  const text = fieldText(evidence) ?? "";
  const citations = text.replace(/\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/g, "$1");
  const references = new Set(Array.from(citations.matchAll(EVIDENCE_REFERENCE), ([reference, file]) =>
    file?.replace(/^\.\//, "") ?? reference.replace(/[.,;:!?]+$/, "")));
  const count = references.size || (Array.isArray(evidence) ? evidence.length : 0);
  return html`
    <details class="decision-evidence" open>
      <summary>Evidence
        ${count ? html`<span class="decision-meta">${count} ${count === 1 ? "source" : "sources"}</span>` : nothing}
      </summary>
      ${text.trim() ? markdown(text, false, evidenceInline) : html`<p>No evidence provided.</p>`}
    </details>
  `;
}

function renderMetric(issue, id, field, label, fullLabel) {
  const assessment = issue[`${field}_value`] ?? issue[field]?.value;
  if (assessment === undefined) return nothing;
  const reason = issue[`${field}_reason`] ?? issue[field]?.reason;
  const value = typeof assessment === "boolean" ? (assessment ? "Yes" : "No") :
    String(assessment).replace(/^./, letter => letter.toUpperCase());
  const highImpact = value.toLowerCase() === "high";
  const reasonId = `assessment-${id}-${field}`;
  return html`
    <div class="decision-metric">
      <dt>${label}</dt>
      <dd ?data-high-impact=${highImpact}>
        ${reason ? html`
          <button type="button" aria-label=${`${fullLabel} ${value}`} aria-describedby=${reasonId}>${value}</button>
          <span id=${reasonId} class="metric-reason" role="tooltip">${reason}</span>
        ` : value}
      </dd>
    </div>
  `;
}

function renderMetadata({ id, issue }) {
  const metrics = [
    renderMetric(issue, id, "strategic_impact", "Impact", "Strategic impact"),
    renderMetric(issue, id, "cost", "Cost", "Change cost"),
    renderMetric(issue, id, "externally_observable", "Observable", "Externally observable"),
  ];
  const hasMetrics = metrics.some(metric => metric !== nothing);
  if (!hasMetrics && !issue.assessment && !issue.type && !issue.function) return nothing;
  return html`
    <section class="decision-metadata" aria-label="Issue metadata">
      ${issue.type || issue.function ? html`
        <dl class="decision-attributes">
          ${issue.type ? html`<div><dt>Issue Type</dt><dd>${markdown(fieldText(issue.type))}</dd></div>` : nothing}
          ${issue.function ? html`<div><dt>Function</dt><dd>${markdown(fieldText(issue.function))}</dd></div>` : nothing}
        </dl>
      ` : nothing}
      ${hasMetrics ? html`<dl class="decision-metrics" aria-label="Assessment">${metrics}</dl>`
        : decisionField("Assessment", issue.assessment)}
    </section>
  `;
}

class ReviewDecision extends LitElement {
  static properties = {
    node: { attribute: false },
    actions: { attribute: false },
    active: { attribute: false },
    busy: { attribute: false },
    clarification: { attribute: false },
  };

  createRenderRoot() {
    return this;
  }

  updated(changed) {
    if (changed.has("node") && changed.get("node")?.id !== this.node?.id && this.node) {
      this.querySelector(".graph-detail").scrollTop = 0;
    }
  }

  chooseAction(action, node) {
    this.dispatchEvent(new CustomEvent("review-action", { detail: { action, node }, bubbles: true }));
  }

  clearSelection() {
    this.dispatchEvent(new CustomEvent("decision-clear"));
  }

  renderDetails(node) {
    const { issue, resolution } = node;
    if (node.requirement) {
      const { text, source, type, function: functionName, criterion, verification } = node.requirement;
      return html`
        ${decisionField("Requirement", text)}
        ${decisionField("Function", functionName)}
        ${decisionField("Type", type)}
        ${decisionField("Source", source)}
        ${decisionField("Acceptance criterion", criterion)}
        ${decisionField("Verification", verification)}
      `;
    }
    if (!issue) return html`<h3 class="decision-question">${markdownInline(node.title)}</h3>`;
    const accepted = node.status === "accepted";
    const changes = resolution?.requirement_changes ?? issue.requirement_changes;
    return html`
      <h3 class="decision-question">${markdownInline(issue.issue)}</h3>
      ${renderMetadata(node)}
      ${accepted ? decisionField("Decision", node.decision, "decision-field decision-recommendation") : nothing}
      ${!accepted || issue.recommendation !== node.decision
        ? decisionField("Recommendation", issue.recommendation, "decision-field decision-recommendation") : nothing}
      ${node.status !== "out-of-scope" && changes ? html`
        <section class="decision-field">
          <h4>Requirement changes</h4>
          <ul>${changes.map(({ operation, id, text }) => html`
            <li><strong>${{ add: "Add", replace: "Replace", remove: "Remove" }[operation]} ${id}</strong>
              ${text ? markdown(text) : nothing}
            </li>
          `)}</ul>
        </section>
      ` : nothing}
      ${decisionField("Rationale", issue.rationale, "decision-field decision-rationale")}
      ${keyed(node.id, renderEvidence(issue.evidence))}
      ${decisionField("Source", resolution?.source)}
      ${decisionField("Prerequisites", node.parents.join(", "))}
      ${decisionField("Affected source requirements", node.affects.join(", "))}
      ${decisionField("Deferral reason", resolution?.reason)}
      ${decisionField("Boundary", resolution?.boundary)}
      ${decisionField("Previous decision", node.previous?.decision)}
      ${decisionField("Assumptions", issue.assumptions)}
      ${decisionField("Alternatives", issue.alternatives)}
    `;
  }

  renderActions(node) {
    const actions = this.actions ?? [];
    if (!actions.length) return nothing;
    const renderButton = action => html`
      <button type="button" class=${action === "accept" ? "primary" : action === "defer" ? "decision-defer" : nothing}
        ?disabled=${action !== "clarify" && this.busy}
        @click=${() => this.chooseAction(action, node)}>${ACTION_LABELS[action]}</button>
    `;
    return html`
      <footer class="decision-footer">
        <fieldset id="decision-actions" aria-label="Decision actions" ?disabled=${!this.active}>
          <div class="request-actions">
            ${actions.filter(action => action !== "defer").map(renderButton)}
            ${actions.includes("defer") ? renderButton("defer") : nothing}
          </div>
        </fieldset>
      </footer>
    `;
  }

  render() {
    const { node, clarification } = this;
    if (!node) return nothing;
    return html`
      <header class="decision-toolbar">
        <span class="decision-meta">${node.status === "function" ? statusLabel(node) : `${node.id} · ${statusLabel(node)}`}</span>
        <button type="button" aria-label="Clear graph selection" @click=${this.clearSelection}>Close</button>
      </header>
      <div class="graph-detail">
        ${guard([node], () => this.renderDetails(node))}
        ${guard([clarification?.question, clarification?.answer], () => clarification ? html`
          <section class="decision-field">
            <h4>Clarification</h4>
            <p class="decision-meta">${clarification.question}</p>
            ${markdown(clarification.answer)}
          </section>
        ` : nothing)}
      </div>
      <p id="decision-help" class="review-empty" ?hidden=${!node.blocked}>
        Apply the prerequisite decisions to unlock these actions.
      </p>
      ${this.renderActions(node)}
    `;
  }
}

customElements.define("review-decision", ReviewDecision);
