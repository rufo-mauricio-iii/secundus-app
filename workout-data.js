/* Workout reads and state. History is optional; the durable write outbox is separate. */
const WorkoutData = (() => {
  const paths = {
    week: "orgs/health/data/workout/workout-week.json",
    logs: "orgs/health/data/workout/workout-log",
    sessions: "orgs/health/data/workout/workout-sessions.json",
    notes: "orgs/health/data/workout/workout-review-notes.json",
  };
  const entryKey = (date, day, exercise) => `${date}|${day}|${exercise}`;
  const recordKey = row => entryKey(row.date, row.day, row.exercise);
  const validRecord = row => row && [row.date, row.day, row.exercise].every(value => typeof value === "string" && value.length > 0);

  async function retryRead(read, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    try { return await read(); }
    catch (error) {
      const status = Number(error.message?.match(/GitHub (\d{3})/)?.[1]);
      if (!(status >= 500 || error.name === "TypeError" || /timed out|network|failed to fetch|load failed/i.test(error.message))) throw error;
      await wait(500);
      return read();
    }
  }

  async function readHistory({ readFile, listDir, storage, repo, directory = paths.logs, wait }) {
    const cacheKey = `wkt-history:${repo}`;
    let cached = {};
    try { cached = JSON.parse(storage.getItem(cacheKey) || "{}"); } catch (_) {}
    if (!cached || typeof cached !== "object" || Array.isArray(cached)) cached = {};
    let files;
    try { files = (await retryRead(() => listDir(directory), wait)).filter(file => file.name.endsWith(".json")); }
    catch (error) { return { entries: [], warning: error.message }; }
    const next = {}, entries = new Array(files.length);
    let cursor = 0, stopped = false;
    // Reuse only records whose current Git SHA matches; cap cold reads at four.
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
      while (cursor < files.length && !stopped) {
        const index = cursor++, file = files[index];
        try {
          const saved = cached[file.path];
          const entry = saved?.sha === file.sha && validRecord(saved.data) ? saved
            : await retryRead(() => readFile(file.path), wait);
          if (!validRecord(entry?.data)) throw new Error("Invalid workout history entry");
          entries[index] = entry.data;
          next[file.path] = { sha: entry.sha, data: entry.data };
        } catch (error) {
          if (/GitHub (401|403|429)\b/.test(error.message)) stopped = true;
        }
      }
    }));
    try { storage.setItem(cacheKey, JSON.stringify(next)); } catch (_) {} // Never let a cache failure affect the outbox.
    const loaded = entries.filter(Boolean), missing = files.length - loaded.length;
    return { entries: loaded, warning: missing ? `${missing} past workout ${missing === 1 ? "entry is" : "entries are"} unavailable.` : "" };
  }

  function create(options) {
    const { readFile, wait, pending = () => [] } = options;
    const state = { week: null, records: new Map(), sessions: {}, notes: {}, historyStatus: "idle", historyWarning: "" };
    let coreRequest = null, historyRequest = null;
    function applyPending() {
      for (const value of pending()) {
        if (value.kind === "movement") {
          const key = recordKey(value);
          state.records.set(key, { ...state.records.get(key), ...value.patch,
            date: value.date, day: value.day, exercise: value.exercise });
        } else if (value.kind === "session") state.sessions[value.key] = value.value;
        else if (value.kind === "feedback") state.notes[value.key] = value.value;
      }
    }
    function loadCore() {
      if (coreRequest) return coreRequest;
      const before = { sessions: { ...state.sessions }, notes: { ...state.notes } };
      coreRequest = (async () => {
        const [week, sessions, notes] = await Promise.all([
          retryRead(() => readFile(paths.week), wait),
          retryRead(() => readFile(paths.sessions), wait),
          retryRead(() => readFile(paths.notes), wait),
        ]);
        if (!Array.isArray(week?.data?.days) || !week.data.days.length) throw new Error(`Could not load ${paths.week}`);
        state.week = week.data;
        for (const [key, file] of [["sessions", sessions], ["notes", notes]]) {
          const remote = file?.data;
          if (remote != null && (typeof remote !== "object" || Array.isArray(remote))) throw Error(`Invalid workout ${key}`);
          const merged = { ...(remote || {}) };
          // A save can finish while these reads are in flight and leave the
          // outbox before hydration. Preserve those newer local values too.
          for (const id of new Set([...Object.keys(before[key]), ...Object.keys(state[key])])) {
            if (before[key][id] === state[key][id]) continue;
            if (Object.hasOwn(state[key], id)) merged[id] = state[key][id]; else delete merged[id];
          }
          state[key] = merged;
        }
        applyPending();
        return state;
      })().finally(() => { coreRequest = null; });
      return coreRequest;
    }
    function loadHistory() {
      if (historyRequest) return historyRequest;
      const before = new Map(state.records);
      state.historyStatus = "loading";
      state.historyWarning = "";
      historyRequest = (async () => {
        const result = await readHistory(options);
        const merged = new Map(result.entries.map(row => [recordKey(row), row]));
        // Preserve edits and completed saves that arrived during this read.
        for (const [key, row] of state.records) if (before.get(key) !== row) merged.set(key, row);
        state.records = merged;
        state.historyWarning = result.warning;
        state.historyStatus = result.warning ? "partial" : "ready";
        applyPending();
        return state;
      })().finally(() => { historyRequest = null; });
      return historyRequest;
    }
    return Object.assign(state, { loadCore, loadHistory });
  }
  return { paths, entryKey, create, readHistory, retryRead };
})();
if (typeof module !== "undefined" && module.exports) module.exports = WorkoutData;
