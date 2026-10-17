/* Durable, repository-scoped writes. Never serialize callbacks or credentials. */
const SyncClient = (() => {
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  class Conflict extends Error { constructor(path) { super(`Conflicting edits at ${path || 'document'}. Your pending edit is retained.`); this.conflict = true; } }
  function merge(base, local, remote, path = '') {
    if (same(local, base)) return clone(remote);
    if (same(remote, base) || same(local, remote)) return clone(local);
    if (/\/(updated_at|updated|last_updated)$/.test(path) && [base, local, remote].every(x => typeof x === 'string' && Number.isFinite(Date.parse(x)))) return Date.parse(local) > Date.parse(remote) ? local : remote;
    if (object(base) && object(local) && object(remote)) {
      const result = {};
      for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
        const value = merge(base[key], local[key], remote[key], path + '/' + key);
        if (value !== undefined) Object.defineProperty(result, key, {value, enumerable: true, writable: true, configurable: true});
      }
      return result;
    }
    // Stable record IDs allow independent edits/additions without replacing a list.
    const key = ['id', 'date', 'event_key'].find(k => [base, local, remote].every(a => Array.isArray(a) && a.every(x => object(x) && typeof x[k] === 'string') && new Set(a.map(x => x[k])).size === a.length));
    if (key) {
      const maps = [base, local, remote].map(a => new Map(a.map(x => [x[key], x]))), result = [];
      for (const id of new Set([...remote.map(x => x[key]), ...local.map(x => x[key])])) {
        const value = merge(...maps.map(m => m.get(id)), path + '/' + id);
        if (value !== undefined) result.push(value);
      }
      return result;
    }
    throw new Conflict(path);
  }
  function mergeText(base, local, remote) {
    if (local === base) return remote;
    if (remote === base || local === remote) return local;
    // Append-only logs can reconcile independent appenders, including uncertain retries.
    if (typeof base === 'string' && local?.startsWith(base) && remote?.startsWith(base)) {
      const addition = local.slice(base.length);
      return remote.includes(addition, base.length) ? remote : remote + addition;
    }
    try {
      const current = JSON.parse(remote), result = merge(JSON.parse(base), JSON.parse(local), current);
      return same(result, current) ? remote : JSON.stringify(result, null, 2) + '\n';
    }
    catch (error) { if (error.conflict) throw error; throw new Conflict('file'); }
  }
  function create({storage, repo, read, write, changed = () => {}, lock = fn => fn(), now = Date.now}) {
    const prefix = `secundus.sync:${repo}:`, pending = () => {
      const values = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(prefix)) {
          const op = JSON.parse(storage.getItem(key));
          if (!op || op.repo !== repo || typeof op.path !== 'string') throw Error('Pending sync data is invalid; retained for recovery.');
          values.push(op);
        }
      }
      return values.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
    };
    const persist = op => storage.setItem(prefix + op.id, JSON.stringify(op));
    let running = null, lastError = null, verified = null;
    function status() {
      try { const items = pending(); return {pending: items.length, conflicts: items.filter(x => x.conflict).length, running: !!running, error: lastError, verified}; }
      catch (e) { return {pending: 1, conflicts: 1, running: false, error: e.message, verified}; }
    }
    function enqueue(path, base, text, message) {
      const id = `${now()}-${Math.random().toString(36).slice(2)}`;
      const op = {id, repo, path, base, text, message, created: now()};
      persist(op); changed(status()); return op;
    }
    function append(path, text, message, header = '') {
      const id = `${now()}-${Math.random().toString(36).slice(2)}`;
      const op = {id, repo, path, text, message, header, kind: 'append', created: now()};
      persist(op); changed(status()); return op;
    }
    async function flush() {
      if (running) return running;
      running = lock(async () => {
        const blocked = new Set(); lastError = null;
        for (const op of pending()) {
          if (blocked.has(op.path) || op.conflict) { blocked.add(op.path); continue; }
          try {
            for (let attempt = 0; attempt < 3; attempt++) {
              const current = await read(op.path);
              const marker = op.path.endsWith('.log') ? `# sync:${op.id}\n` : `<!-- sync:${op.id} -->\n`;
              const text = op.kind === 'append' ? (current?.raw?.includes(marker) ? current.raw : (current?.raw || op.header) + op.text + marker) : mergeText(op.base, op.text, current?.raw ?? null);
              if (text !== (current?.raw ?? null)) {
                try { await write(op.path, text, current?.sha, op.message); }
                catch (e) { if ([409, 422].includes(e.status) && attempt < 2) continue; throw e; }
                // Acknowledgement alone isn't enough: read back the committed bytes.
                const check = await read(op.path);
                if ((check?.raw ?? null) !== text) {
                  // A subsequent independent edit is valid if our delta is already present.
                  if (op.kind === 'append' ? !check?.raw?.includes(marker) : mergeText(op.base, op.text, check?.raw ?? null) !== (check?.raw ?? null)) throw Error('Readback pending');
                }
              }
              storage.removeItem(prefix + op.id); verified = now(); break;
            }
          } catch (e) {
            lastError = e.message; blocked.add(op.path);
            if (e.conflict) { op.conflict = true; op.error = e.message; persist(op); }
          }
        }
      }).finally(() => { running = null; changed(status()); });
      changed(status()); await running; return status().pending === 0;
    }
    // An explicit new edit rebases the retained intent after the user resolves it.
    function resolve(id, base, text) {
      const op = pending().find(x => x.id === id);
      if (!op) throw Error('Pending edit not found');
      persist({...op, base, text, conflict: false, error: null}); changed(status());
    }
    return {enqueue, append, flush, pending, status, resolve};
  }
  function watch({refresh, enabled = () => true, schedule = setTimeout, cancel = clearTimeout, interval = 30000}) {
    let timer, running, stopped = false, delay = interval;
    const arm = () => { if (!stopped) timer = schedule(wake, delay); };
    function wake() {
      cancel(timer); if (stopped) return Promise.resolve(); if (running) return running;
      if (!enabled()) { arm(); return Promise.resolve(); }
      running = Promise.resolve().then(refresh).then(ok => { delay = ok === false ? Math.min(delay * 2, 300000) : interval; }, () => { delay = Math.min(delay * 2, 300000); })
        .finally(() => { running = null; arm(); }); return running;
    }
    arm(); return {wake, stop() {stopped = true; cancel(timer);}};
  }
  return {create, merge, mergeText, Conflict, watch};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SyncClient;
