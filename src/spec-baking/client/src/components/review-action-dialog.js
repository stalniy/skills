import { html, LitElement, nothing } from "lit";
import { guard } from "lit/directives/guard.js";
import { markdown } from "../markdown.js";

class ReviewActionDialog extends LitElement {
  static properties = {
    snapshot: { attribute: false },
    submission: { attribute: false },
    busy: { attribute: false },
    submitDecision: { attribute: false },
    draft: { state: true },
    draftValue: { state: true },
    draftBoundary: { state: true },
    dialogError: { state: true },
    saving: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  updated() {
    const version = this.clarification?.version;
    if (version !== this.lastThreadVersion) {
      this.lastThreadVersion = version;
      const log = this.querySelector("#clarification-thread");
      log.scrollTop = log.scrollHeight;
    }
  }

  get clarification() {
    if (this.draft?.action !== "clarify") return null;
    const state = this.snapshot;
    const { id } = this.draft;
    const exchanges = state.clarifications[id] ?? [];
    const pending = state.active ? state.pending_clarification ?? this.submission?.event : null;
    const question = pending?.action === "clarify" && pending.id === id ? pending.question : null;
    const available = state.active && state.actions[id]?.includes("clarify");
    const status = !available ? "Clarification is no longer available for this issue."
      : this.busy && !question ? "Waiting for the agent…" : "";
    return { exchanges, question, available, status, version: JSON.stringify([id, exchanges, question]) };
  }

  async open(action, node) {
    const { id } = node;
    const state = this.snapshot;
    const hasThread = state.clarifications[id]?.length || state.pending_clarification?.id === id
      || (this.submission?.event.action === "clarify" && this.submission.event.id === id);
    const fields = {
      edit: ["Edit", "Revised decision", node.decision],
      defer: ["Mark out of scope", "Reason", ""],
      clarify: ["Clarify", "Clarification request", hasThread ? "" : `Please clarify ${id}, I don't understand`],
    };
    const [title, label, value] = fields[action];
    const draft = { action, id, revision: state.revision, title: `${title} ${id}`, label };
    this.draft = draft;
    this.draftValue = value;
    this.draftBoundary = "";
    this.dialogError = "";
    this.saving = false;
    await this.updateComplete;
    if (this.draft !== draft || !this.isConnected) return;
    this.querySelector("#action-dialog").showModal();
    this.querySelector("#action-value").focus();
  }

  closeDialog() {
    this.querySelector("#action-dialog").close();
  }

  resetDialog(event) {
    if (event.currentTarget.open) return;
    this.draft = null;
    this.saving = false;
  }

  async saveDialog(event) {
    event.preventDefault();
    if (!this.draft || this.saving) return;
    const draft = this.draft;
    const { action, id, revision } = draft;
    const clarify = action === "clarify";
    const value = this.draftValue.trim();
    const fields = {
      edit: { decision: value },
      clarify: { question: value },
      defer: { reason: value, boundary: this.draftBoundary.trim() },
    }[action];
    const dialog = this.querySelector("#action-dialog");
    const isCurrent = () => this.draft === draft && dialog.open;
    this.saving = true;
    this.dialogError = "";
    try {
      if (Object.values(fields).some(field => !field)) throw new Error("Complete the required fields.");
      await this.submitDecision({ action, id, ...fields }, clarify ? this.snapshot.revision : revision);
      if (!isCurrent()) return;
      if (clarify) {
        if (this.draftValue.trim() === value) this.draftValue = "";
        this.querySelector("#action-value").focus();
      } else {
        dialog.close();
      }
    } catch (error) {
      if (isCurrent()) this.dialogError = error.message;
    } finally {
      if (this.draft === draft) this.saving = false;
    }
  }

  renderThread(thread) {
    return html`
      <div id="clarification-thread" class="clarification-thread" role="log" aria-label="Clarification conversation"
        ?hidden=${!thread?.exchanges.length && !thread?.question}>
        ${guard([thread?.version], () => {
          if (!thread) return nothing;
          const question = text => html`<div class="clarification-message user"><strong>You</strong><p>${text}</p></div>`;
          return html`
            ${thread.exchanges.map(exchange => html`
              ${question(exchange.question)}
              <div class="clarification-message agent"><strong>Agent</strong>${markdown(exchange.answer)}</div>
            `)}
            ${thread.question ? html`
              ${question(thread.question)}
              <div class="clarification-message agent">
                <strong>Agent</strong>
                <span class="clarification-loader" aria-hidden="true"><span></span><span></span><span></span></span>
                <span class="sr-only">Waiting for a reply…</span>
              </div>
            ` : nothing}
          `;
        })}
      </div>
    `;
  }

  render() {
    const draft = this.draft;
    const thread = this.clarification;
    const defer = draft?.action === "defer";
    return html`
      <dialog id="action-dialog" aria-labelledby="action-title" @close=${this.resetDialog}>
        <form class="dialog-form" @submit=${this.saveDialog}>
          <h2 id="action-title">${draft?.title}</h2>
          ${this.renderThread(thread)}
          <label for="action-value">${draft?.label}</label>
          <textarea id="action-value" rows=${thread ? 3 : 6} required ?readonly=${thread && !thread.available}
            .value=${this.draftValue ?? ""} @input=${event => { this.draftValue = event.target.value; }}></textarea>
          <div ?hidden=${!defer}>
            <label for="action-boundary">Boundary</label>
            <textarea id="action-boundary" rows="4" placeholder="How will in-scope behavior proceed independently?"
              ?required=${defer} .value=${this.draftBoundary ?? ""}
              @input=${event => { this.draftBoundary = event.target.value; }}></textarea>
          </div>
          <p class="clarification-status" role="status" ?hidden=${!thread?.status}>${thread?.status}</p>
          <p class="form-error" role="alert" ?hidden=${!this.dialogError}>${this.dialogError}</p>
          <div class="dialog-actions">
            <button type="button" @click=${this.closeDialog}>${thread ? "Close" : "Cancel"}</button>
            <button type="submit" class="primary" ?disabled=${this.saving || (thread && (!thread.available || this.busy))}>
              ${thread ? "Send" : "Save decision"}
            </button>
          </div>
        </form>
      </dialog>
    `;
  }
}

customElements.define("review-action-dialog", ReviewActionDialog);
