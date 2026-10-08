/* Shared session model for the outline, active movement, and full plan. */
const WorkoutSession = (() => {
  const cleanName = value => String(value || "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const formatDate = value => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!parts) return String(value || "");
    const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(parts[2]) - 1];
    return month ? `${month}-${parts[3]}-${parts[1]}` : String(value);
  };
  const validWeight = value => /^\d+(?:\.\d+)?$/.test(String(value ?? "").trim()) && Number(value) > 0;
  function recoveryFor(plan, dayKey, asOf) {
    const dayIndex = plan.days.findIndex(day => day.key === dayKey);
    if (dayIndex < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
    const today = new Date(asOf + "T12:00:00");
    const next = new Date(today);
    next.setDate(today.getDate() + (dayIndex - (today.getDay() + 6) % 7 + 7) % 7);
    const nextDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    const override = plan.recovery_overrides?.[nextDate];
    return override?.day === dayKey ? { ...override, date: nextDate, preview: nextDate !== asOf } : null;
  }
  function latestWeight(records, name, asOf) {
    const canon = cleanName(name).toLowerCase();
    return records.filter(row => cleanName(row.exercise).toLowerCase() === canon && row.date <= asOf && validWeight(row.weight))
      .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  }
  function prescription(item, meta = {}, logged = null) {
    const load = item.load_override ?? item.l ?? meta.load ?? "";
    // A recorded starting weight resolves a calibration placeholder. It does
    // not override an explicit prescription or imply automatic progression.
    const calibrated = /calibrat/i.test(load) && validWeight(logged?.weight);
    return { load: calibrated ? `${String(logged.weight).trim()} kg` : load,
      reps: item.r || meta.reps || "", ...(calibrated ? { calibrated_from: logged.date } : {}) };
  }
  const isBodyweight = load => /^body\s?weight$/i.test(String(load).trim());
  function target(item, meta, logged) {
    const { load, reps } = prescription(item, meta, logged);
    return [isBodyweight(load) ? "" : /calibrate/i.test(load) ? "Choose starting load" : load, reps].filter(Boolean).join(" × ");
  }
  function seconds(value) {
    const text = String(value || "").trim().toLowerCase();
    const clock = /^(\d+):(\d{1,2})$/.exec(text);
    if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
    const match = /(\d+)\s*(s(?:ec)?|m(?:in)?)\b/.exec(text);
    return match ? Number(match[1]) * (match[2][0] === "m" ? 60 : 1) : 0;
  }
  function build(day, gear, roomSession, resolve = () => ({})) {
    const room = gear === "room" && roomSession;
    const source = room || day, rounds = gear === "blue" ? 2 : gear === "red" ? 3 : 1;
    const blocks = [], steps = [];
    const add = (id, title, items, extra = {}) => {
      const block = { id, title, items, rounds: 1, rest: 0, kind: id, ...extra, first: steps.length, steps: [] };
      blocks.push(block);
      if (!items.length) {
        const step = { id, block, mode: "none", round: 1 };
        block.steps.push(step); steps.push(step);
      } else {
        for (let round = 1; round <= block.rounds; round++) items.forEach((item, index) => {
          const mode = item.log || (block.kind === "ss" ? "full" : block.kind === "finisher" ? "check" : "none");
          const rest = block.kind === "warmup" ? (index < items.length - 1 ? 30 : 0)
            : index === items.length - 1 && round < block.rounds ? block.rest : 0;
          const step = { id: `${id}:${index}:${round}`, block, item, canon: cleanName(item.n), meta: resolve(item.n) || {}, mode, round, index, rest };
          block.steps.push(step); steps.push(step);
        });
      }
      return block;
    };
    const justMove = gear === "blue-r" && day.type === "strength" && day.just_move;
    if (justMove) {
      add("activity", "Just move", [], { prose: justMove.items || [] });
    } else {
      if (source.warmup?.length) add("warmup", "Warm-up", source.warmup);
      if (source.engine) add("engine", "Engine", [], { prose: source.engine });
      (source.ss || []).forEach((block, i) => add(`ss${i}`, block.title || `Pair ${i + 1}`, block.ex || [], {
        kind: "ss", label: block.label, location: (String(block.label || "").match(/\((.*?)\)/) || [])[1] || "",
        rounds: room ? block.rounds ?? rounds : rounds, rest: room ? block.rest ?? 60 : i === 0 ? 90 : 60,
      }));
      const finishers = source.finisher || [], title = day.type === "engine" && !room ? "Core" : "Finisher";
      if (finishers.some(item => item.rounds)) {
        finishers.forEach((item, i) => add(`fin${i}`, cleanName(item.n), [item], { kind: "finisher", rounds: item.rounds || 1, rest: 60 }));
      } else if (finishers.length) add("finisher", title, finishers, { rounds, rest: 60 });
      if (source.cool?.length) add("cool", "Cool-down", source.cool);
      if (!blocks.length) add("activity", day.title || "Activity", [], { prose: source.note || day.tag || "" });
    }
    add("end", "Finish", []);
    return { blocks, steps, source, title: justMove ? "Just move" : source.title || day.title,
      movements: blocks.reduce((n, block) => n + block.items.length, 0) };
  }
  return { cleanName, formatDate, prescription, isBodyweight, target, seconds, build, latestWeight, recoveryFor };
})();
if (typeof module !== "undefined" && module.exports) module.exports = WorkoutSession;
