/* Shared approval card for Home and Workout. All writes are decisions only. */
const WorkoutReview = (() => {
  const BASE = "orgs/health/data/workout/reviews/";
  const views = new Map();
  let current = null, decision = null, loading = null, queued = false, error = "";
  const pending = p => ["awaiting_approval", "needs_clarification", "revision_requested", "stale"].includes(p?.status);
  const actionable = p => p?.status === "awaiting_approval" && Array.isArray(p.changes) && p.changes.length > 0 && !p.question;
  function element(parent, tag, cls, content) {
    const node = document.createElement(tag); if (cls) node.className = cls;
    if (content != null) node.textContent = content; parent.appendChild(node); return node;
  }
  function button(parent, label, action, cls = "") {
    const node = element(parent, "button", cls, label); node.type = "button";
    node.onclick = action; return node;
  }
  function dateLabel(value) { return WorkoutSession.formatDate(value); }
  function repaint() {
    for (const [root, options] of views) {
      if (!root.isConnected) { views.delete(root); continue; }
      paint(root, options);
    }
  }
  async function refresh() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const [review, saved] = await Promise.all([readFile(BASE + "current.json"), readFile(BASE + "decision.json")]);
        current = review?.data || null; decision = saved?.data || null; error = "";
        queued = !!(pending(current) && decision?.proposal_id === current.id && decision?.approval_digest === current.approval_digest
          && decision.decided_at !== current.decision_request_at && !current.last_error);
      } catch (_) { error = "Could not load workout reviews. Try again."; }
      finally { loading = null; repaint(); }
    })();
    return loading;
  }
  async function submit(action, note = "") {
    if (!current || queued) return;
    const shown = current;
    if (action === "revise" && !note.trim()) { error = "Add your clarification or requested revision first."; repaint(); return; }
    queued = true; error = ""; repaint();
    try {
      const latest = (await readFile(BASE + "current.json"))?.data;
      if (latest?.id !== shown.id || latest?.approval_digest !== shown.approval_digest || !pending(latest)) {
        throw new Error("The review changed. Refresh and review the current proposal before deciding.");
      }
      const value = { version: 1, proposal_id: shown.id, approval_digest: shown.approval_digest,
        action, note: note.trim(), decided_at: new Date().toISOString() };
      await saveJSON(BASE + "decision.json", () => value, `workout: ${action} proposal ${shown.id} [site]`);
      decision = value; repaint();
      // GitHub processes the decision in the cloud. A saved click is not proof
      // that the plan was applied; show success only after reading its result.
      for (const delay of [4000, 8000, 15000, 20000]) {
        await new Promise(resolve => setTimeout(resolve, delay));
        await refresh(); if (!queued) break;
      }
    } catch (e) { queued = false; error = e.message || "Decision could not be saved. Try again."; repaint(); }
  }
  function paint(root, options) {
    root.textContent = ""; root.className = "workout-review";
    options.onPendingChange?.(pending(current) ? 1 : 0);
    if (!current && !error) { root.hidden = true; return; }
    root.hidden = false;
    const head = element(root, "div", "wr-head");
    element(head, "h3", "wr-title", pending(current) ? "Workout review needs your attention" : "Workout review");
    button(head, "Refresh review", refresh, "wr-quiet");
    if (error) element(root, "p", "wr-error", error);
    if (!current) return;
    if (current.review_date) element(root, "p", "wr-meta", `${dateLabel(current.review_date)} · ${current.applies_from || "Nightly review"}`);
    if (current.last_error) element(root, "p", "wr-error", `Review not applied: ${current.last_error}`);
    if (current.message) element(root, "p", "wr-note", current.message);
    if (current.status === "applied") {
      element(root, "p", "wr-note", "Approved changes have been applied.");
      button(root, "Reload app to use the updated plan", () => location.reload(), "wr-primary"); return;
    }
    if (current.status === "no_changes" || current.status === "kept") {
      element(root, "p", "wr-note", current.status === "kept" ? "Current plan kept." : "Reviewed. No changes needed."); return;
    }
    if (current.status === "revision_requested") {
      element(root, "p", "wr-note", "Your revision is saved for the next nightly review.");
      if (current.revision_note) element(root, "blockquote", "wr-note", current.revision_note);
    }
    for (const change of current.changes || []) {
      const row = element(root, "section", "wr-change");
      element(row, "h4", "", change.exercise);
      element(row, "p", "wr-prescription", `${change.field === "load" ? "Weight" : "Reps"}: ${change.old} → ${change.new}`);
      element(row, "p", "wr-reason", change.reason);
      for (const evidence of change.evidence || []) {
        const key = String(evidence.source || "").split("#")[1] || "";
        const label = /^\d{4}-\d{2}-\d{2}/.test(key) ? dateLabel(key.slice(0, 10)) : "Your saved feedback";
        element(row, "p", "wr-evidence", `${label}: “${evidence.quote}”`);
      }
    }
    for (const source of current.research || []) {
      const item = element(root, "p", "wr-evidence");
      element(item, "span", "", source.finding + " ");
      try {
        const url = new URL(source.url);
        if (url.protocol === "https:" && !url.username && !url.password) {
          const link = element(item, "a", "", source.title); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
        }
      } catch (_) {}
    }
    if (current.question) element(root, "p", "wr-question", current.question);
    const status = element(root, "p", "wr-note"); status.setAttribute("role", "status");
    status.textContent = queued ? "Decision saved. Waiting for cloud confirmation…" : "Changes are applied only after you approve them.";
    const actions = element(root, "div", "wr-actions");
    if (actionable(current)) button(actions, "Approve changes", () => submit("approve"), "wr-primary").disabled = queued;
    if (pending(current)) {
      button(actions, "Keep current plan", () => submit("keep")).disabled = queued;
      const revision = element(root, "details", "wr-revision");
      element(revision, "summary", "", current.question ? "Answer / request revision" : "Request revision");
      const label = element(revision, "label", "", "Your clarification or requested change");
      const input = element(label, "textarea"); input.maxLength = 2000;
      input.placeholder = "Name the exercise and explain what should change.";
      button(revision, "Send revision", () => submit("revise", input.value)).disabled = queued;
    }
  }
  function mount(root, options = {}) {
    views.set(root, options); paint(root, options); refresh();
  }
  return { mount, refresh };
})();
