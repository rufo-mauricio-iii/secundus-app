/* Health persistence and purchase quantities. No UI or browser state. */
const HealthData = (() => {
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const round = n => Math.round(n * 1e6) / 1e6;
  function weightDocument(value) {
    if (value == null) return { schema_version: 1, unit: "lbs", entries: [] };
    if (!object(value) || !Array.isArray(value.entries)) throw Error("Weight history is invalid. Reload before saving.");
    return structuredClone(value);
  }
  function editWeight(value, change) {
    const doc = weightDocument(value);
    if (!["target", "reading", "delete"].includes(change.kind) ||
        (change.kind !== "delete" && (!Number.isFinite(change.lbs) || change.lbs <= 0)) ||
        (change.kind !== "target" && !/^\d{4}-\d{2}-\d{2}$/.test(change.date || ""))) throw Error("Invalid weight change");
    if (change.kind === "target") doc.target_lbs = change.lbs;
    else {
      const previous = doc.entries.find(e => e.date === change.date);
      doc.entries = doc.entries.filter(e => e.date !== change.date);
      if (change.kind === "reading") doc.entries.push({ ...previous, date: change.date, lbs: change.lbs });
      doc.entries.sort((a, b) => a.date.localeCompare(b.date));
    }
    doc.updated = change.updated;
    return doc;
  }

  // Read every document at one immutable head; publish only by a non-force
  // ref update. A competing commit reruns the mutation against the new head.
  function transaction({ request, readFile }) {
    return async (paths, mutate, message) => {
      const { default_branch: branch } = await request("");
      if (!branch) throw Error("Could not determine the data branch");
      const ref = branch.split("/").map(encodeURIComponent).join("/");
      for (let attempt = 0; attempt < 3; attempt++) {
        const { object: { sha: head } } = await request(`git/ref/heads/${ref}`);
        const files = await Promise.all(paths.map(p => readFile(p, head)));
        const current = Object.fromEntries(paths.map((p, i) => [p, files[i]?.data ?? null]));
        const next = mutate(structuredClone(current));
        if (next == null) return current; // The operation is already recorded.
        const changed = paths.filter(p => JSON.stringify(current[p]) !== JSON.stringify(next[p]));
        if (!changed.length) return current;
        const base = await request(`git/commits/${head}`);
        const tree = await request("git/trees", "POST", { base_tree: base.tree.sha, tree: changed.map(p => ({
          path: p, mode: "100644", type: "blob", content: JSON.stringify(next[p], null, 2) + "\n",
        })) });
        const commit = await request("git/commits", "POST", { message, tree: tree.sha, parents: [head] });
        try {
          await request(`git/refs/heads/${ref}`, "PATCH", { sha: commit.sha, force: false });
          return next;
        } catch (error) {
          if (![409, 422].includes(error.status) || attempt === 2) throw error;
        }
      }
    };
  }

  const units = {
    g: ["g", 1], kg: ["g", 1000], oz: ["g", 28.349523125], lb: ["g", 453.59237], lbs: ["g", 453.59237],
    ml: ["ml", 1], l: ["ml", 1000], ct: ["ct", 1], count: ["ct", 1],
  };
  const unit = text => units[String(text || "").trim().toLowerCase()] || [String(text || "unit"), 1];
  function convert(qty, from, to) {
    const a = unit(from), b = unit(to);
    return a[0] === b[0] ? qty * a[1] / b[1] : null;
  }
  function measure(item) {
    if (!item.noAmtLines && item.amount) {
      for (const key of ["g", "ml", "ct"]) if (Number.isFinite(item.amount[key])) return { qty: item.amount[key], unit: key };
    }
    return { qty: item.qty, unit: item.unit || "unit" };
  }
  function subtractStock(item, stock) {
    const required = measure(item);
    const rows = stock.filter(s => s.ingredient_id === item.ingredient_id && Number(s.qty_on_hand) > 0);
    let available = 0, uncertain = false;
    for (const row of rows) {
      const qty = convert(Number(row.qty_on_hand), row.unit, required.unit);
      if (qty == null) uncertain = true; else available += qty;
    }
    const need = Math.max(0, round(required.qty - available));
    const ratio = required.qty > 0 ? need / required.qty : 0;
    item.required = required;
    item.onHand = { qty: round(available), unit: required.unit };
    item.toBuy = { qty: need, unit: required.unit };
    item.home = need === 0;
    item.stockNote = uncertain ? "Some pantry stock uses different units; check it before buying." : "";
    if (available > 0) item.stockNote = `${round(available)} ${required.unit} at home; ${round(required.qty)} ${required.unit} needed. ${item.stockNote}`.trim();
    item.qty *= ratio;
    if (item.noAmtLines) item.amount = null;
    else if (item.amount) item.amount = Object.fromEntries(Object.entries(item.amount).map(([k, v]) => [k, typeof v === "number" ? v * ratio : v]));
    for (const option of item.options.values()) option.price *= ratio;
    return item;
  }
  function purchaseQuantity(item) {
    return item.pack?.stockAmount || item.toBuy || measure(item);
  }
  function inventory(value) {
    if (value == null) return { schema_version: 1, stock: [] };
    if (!object(value) || !Array.isArray(value.stock)) throw Error("Inventory is invalid. Reload before saving.");
    return value;
  }
  function spending(value) {
    if (value == null) return [];
    if (!Array.isArray(value)) throw Error("Spending history is invalid. Reload before saving.");
    return value;
  }
  function orderDocuments(docs, paths, order) {
    const log = spending(docs[paths.spend]), inv = inventory(docs[paths.inventory]);
    if (log.some(e => e.id === order.id)) return null;
    const deltas = [];
    for (const purchase of order.purchases) {
      if (!(purchase.qty > 0) || !Number.isFinite(purchase.qty)) throw Error("Invalid purchase quantity");
      let row = inv.stock.find(s => s.ingredient_id === purchase.ingredient_id && convert(1, purchase.unit, s.unit) != null);
      const created = !row;
      // Preserve an older row in incompatible units instead of inventing a
      // conversion or discarding it. Shopping sums all compatible stock rows.
      if (!row) { row = { ingredient_id: purchase.ingredient_id, qty_on_hand: 0, unit: purchase.unit }; inv.stock.push(row); }
      const add = round(convert(purchase.qty, purchase.unit, row.unit));
      row.qty_on_hand = round((Number(row.qty_on_hand) || 0) + add);
      row.confidence = "estimate";
      row.note = `+${add} ${row.unit} bought ${order.date}`;
      deltas.push({ ingredient_id: row.ingredient_id, add, unit: row.unit, created });
    }
    inv.last_updated = order.date;
    log.push({ ...order.spend, id: order.id, inv_delta: deltas });
    return { ...docs, [paths.inventory]: inv, [paths.spend]: log,
      [paths.shopping]: { ...order.payload, order_id: order.id, status: "committed" } };
  }
  function undoDocuments(docs, paths, id, date) {
    const log = spending(docs[paths.spend]), inv = inventory(docs[paths.inventory]);
    const order = log.find(e => (e.id || e.ts) === id);
    if (!order || order.undone_at) return null;
    for (const delta of order.inv_delta || []) {
      const row = inv.stock.find(s => s.ingredient_id === delta.ingredient_id && convert(1, delta.unit, s.unit) != null);
      if (!row) continue;
      row.qty_on_hand = Math.max(0, round((Number(row.qty_on_hand) || 0) - convert(delta.add, delta.unit, row.unit)));
      row.confidence = "estimate";
      row.note = `order undone ${date}`;
      if (delta.created && row.qty_on_hand === 0) inv.stock.splice(inv.stock.indexOf(row), 1);
    }
    inv.last_updated = date;
    order.undone_at = date; // Retain the receipt so delayed retries cannot replay it.
    const shopping = docs[paths.shopping];
    return { ...docs, [paths.inventory]: inv, [paths.spend]: log,
      [paths.shopping]: shopping?.order_id === id ? { ...shopping, status: "undone", undone_at: date } : shopping };
  }
  return { weightDocument, editWeight, transaction, convert, measure, subtractStock, purchaseQuantity, inventory, spending, orderDocuments, undoDocuments };
})();
if (typeof module !== "undefined" && module.exports) module.exports = HealthData;
