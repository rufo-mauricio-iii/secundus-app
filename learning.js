/* Learning reads only the curated static publication. No reader API or repo token. */
(function (scope) {
  'use strict';
  const assetBase = typeof document !== 'undefined' && document.currentScript ? new URL('.', document.currentScript.src).href : '';
  const TOPICS = [
    ['models-reasoning', 'Models and reasoning', 'Goals, policies and robot intelligence.'],
    ['data-simulation', 'Training data and simulation', 'Practice, transfer and generalization.'],
    ['hardware-control', 'Hardware and control', 'Compute, sensing and useful motion.'],
    ['deployments', 'Deployments and applications', 'From a capable machine to useful work.'],
    ['safety-reliability', 'Safety and reliability', 'Recovery, limits and dependable operation.']
  ];
  const topicIds = new Set(TOPICS.map(t => t[0]));
  const mounted = new WeakMap();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const id = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
  const texts = value => Array.isArray(value) && value.every(text);
  const ids = value => Array.isArray(value) && value.every(id) && new Set(value).size === value.length;
  const topics = value => ids(value) && value.length && value.every(t => topicIds.has(t));
  function safeURL(value) {
    if (!text(value) || /[\s\x00-\x1f\x7f\\]/.test(value)) return null;
    try { const u = new URL(value); return /^https?:$/.test(u.protocol) && u.hostname && !u.username && !u.password ? value : null; } catch (_) { return null; }
  }
  function dateLabel(value, timestamp = false) {
    if (!text(value) || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return 'Unknown';
    if (timestamp && !value.includes('T')) return 'Unknown';
    const day = value.slice(0, 10), parsedDay = new Date(day + 'T00:00:00Z');
    if (!Number.isFinite(parsedDay.getTime()) || parsedDay.toISOString().slice(0, 10) !== day || !Number.isFinite(Date.parse(value))) return 'Unknown';
    return value;
  }
  function validRecords(items, key, valid) {
    const counts = new Map();
    for (const item of items) if (object(item)) counts.set(item[key], (counts.get(item[key]) || 0) + 1);
    return items.filter(item => object(item) && id(item[key]) && counts.get(item[key]) === 1 && valid(item));
  }
  function foundationSection(section) {
    if (!object(section) || !Array.isArray(section.explainers) || !Array.isArray(section.reading_order)) return null;
    let partial = false;
    const records = validRecords(section.explainers, 'id', x => topics(x.subtopics) &&
      ['title','preview','editorial_implication','example'].every(k => text(x[k])) && texts(x.synopsis) && x.synopsis.length &&
      texts(x.questions) && x.questions.length && ids(x.related) && object(x.source) &&
      ['title','publisher','access_note','url'].every(k => text(x.source[k])));
    partial ||= records.length !== section.explainers.length;
    const known = new Set(records.map(x => x.id));
    const explainers = records.map(x => {
      const related = x.related.filter(r => known.has(r));
      partial ||= related.length !== x.related.length;
      return {...x, related};
    });
    const reading_order = [...new Set(section.reading_order.filter(x => known.has(x)))];
    partial ||= reading_order.length !== section.reading_order.length || reading_order.length !== known.size;
    for (const x of explainers) if (!reading_order.includes(x.id)) reading_order.push(x.id);
    return {data: {explainers, reading_order}, partial};
  }
  function newsSection(section) {
    if (!object(section) || !Array.isArray(section.developments) || !Array.isArray(section.citations) || !Array.isArray(section.context)) return null;
    const citations = validRecords(section.citations, 'source_id', x => ['title','publisher','url','date_basis','evidence_kind'].every(k => text(x[k])) && typeof x.historical === 'boolean');
    const sources = new Set(citations.map(x => x.source_id));
    const developments = validRecords(section.developments, 'event_key', x => topics(x.subtopics) &&
      ['headline','what_happened','why_it_matters','uncertainties'].every(k => text(x[k])) && ids(x.source_ids) && x.source_ids.length && x.source_ids.every(s => sources.has(s)));
    const known = new Map(developments.map(x => [x.event_key, x]));
    const context = section.context.filter(x => object(x) && ['synthesis','interpretation','uncertainty','question'].includes(x.kind) && text(x.text) && ids(x.development_keys) && x.development_keys.length &&
      x.development_keys.every(k => known.has(k)) && ids(x.source_ids) && (x.kind !== 'synthesis' || x.source_ids.length) &&
      x.source_ids.every(s => sources.has(s) && x.development_keys.some(k => known.get(k).source_ids.includes(s))));
    return {data: {published_at: section.published_at, baseline_at: section.baseline_at, developments, citations, context},
      partial: citations.length !== section.citations.length || developments.length !== section.developments.length || context.length !== section.context.length};
  }
  function sourceLink(source) {
    const url = safeURL(source.url);
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ↗</a>` : `<span>${esc(source.title)} · ${esc(source.url)} (link unavailable)</span>`;
  }
  const motifs = [
    '<path d="M16 42 32 16 50 40 76 18M16 42l20 22 14-24 24 25M32 16l4 48M50 40l26-22"/><circle cx="16" cy="42" r="5"/><circle cx="32" cy="16" r="5"/><circle cx="50" cy="40" r="6"/><circle cx="36" cy="64" r="5"/><circle cx="76" cy="18" r="5"/><circle cx="74" cy="65" r="5"/>',
    '<path d="m14 27 32-16 32 16-32 16Z M14 40l32 16 32-16M14 54l32 16 32-16M46 43v27"/>',
    '<rect x="30" y="20" width="36" height="40" rx="4"/><path d="M38 10v10m10-10v10m10-10v10M38 60v12m10-12v12m10-12v12M18 30h12M18 40h12M18 50h12M66 30h12M66 40h12M66 50h12"/><circle cx="48" cy="40" r="9"/>',
    '<path d="M12 65h72M20 65V30h26v35m0-24h28v24M27 41h11m-11 10h11M55 52h11M19 20l23-9 31 15"/><circle cx="74" cy="25" r="5"/>',
    '<path d="M48 10 77 23v20c0 15-17 24-29 30-12-6-29-15-29-30V23Z M32 41l11 11 23-26"/>'
  ];
  function mount(host) {
    if (mounted.has(host)) return mounted.get(host);
    const root = host.shadowRoot || host.attachShadow({mode: 'open'});
    root.innerHTML = `<link rel="stylesheet" href="${esc(assetBase + 'learning.css')}"><div class="learning"></div>`;
    const content = root.querySelector('.learning');
    const state = {view: 'feed', topic: null, expanded: null, origin: 'topic-models-reasoning', foundations: null, news: null, notices: {}, loading: false};
    let request = 0;
    const button = (action, value, label, extra = '') => `<button type="button" data-action="${action}" data-value="${esc(value)}" ${extra}>${esc(label)}</button>`;
    const topicTitle = value => TOPICS.find(t => t[0] === value)?.[1] || 'All topics';
    const matching = records => records.filter(x => !state.topic || x.subtopics.includes(state.topic));
    function citationList(refs) {
      return `<ul class="sources">${refs.map(key => {
        const s = state.news.citations.find(x => x.source_id === key);
        return `<li>${sourceLink(s)}<small>${esc(s.publisher)} · Source date: ${esc(dateLabel(s.date))}<br>${esc(s.date_basis)} · ${esc(s.evidence_kind)}${s.historical ? ' · Dated background' : ''}</small></li>`;
      }).join('')}</ul>`;
    }
    function foundation(item) {
      return `<details class="foundation" id="foundation-${item.id}" ${state.expanded === item.id ? 'open' : ''}><summary id="summary-${item.id}"><span class="eyebrow">Dated background · ${esc(item.source.publisher)}</span><h3>${esc(item.title)}</h3><span>${esc(item.preview)}</span></summary><div class="reading-body">${item.synopsis.map(p => `<p>${esc(p)}</p>`).join('')}<h4>Editorial implication</h4><p>${esc(item.editorial_implication)}</p><h4>Original teaching example · hypothetical</h4><p>${esc(item.example)}</p><h4>Questions to carry into the news</h4><ul>${item.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul><h4>Related reading</h4><div class="related">${item.related.map(key => button('related', key, state.foundations.explainers.find(x => x.id === key).title)).join('')}</div><div class="source-note">${sourceLink(item.source)}<p>Original source date: ${esc(dateLabel(item.source.article_date))} · ${esc(item.source.publisher)}</p><p>${esc(item.source.access_note)}</p></div></div></details>`;
    }
    function news() {
      if (!state.news) return '';
      const records = matching(state.news.developments), keys = new Set(records.map(x => x.event_key));
      const context = state.news.context.filter(x => x.development_keys.some(k => keys.has(k)));
      return `<section aria-label="Reviewed news"><div class="section-heading"><div><span class="eyebrow">Reviewed news</span><h2>${records.length} developments${state.topic ? ' in this topic' : ''}</h2></div></div><p class="metadata">Saved publication time: ${esc(dateLabel(state.news.published_at, true))}<br>Baseline accepted: ${esc(dateLabel(state.news.baseline_at, true))}</p>${records.length ? records.map(x => `<article class="development" id="development-${x.event_key}"><h3>${esc(x.headline)}</h3><p>${esc(x.what_happened)}</p><h4>Expert interpretation · why it matters</h4><p>${esc(x.why_it_matters)}</p><h4>Uncertainty</h4><p>${esc(x.uncertainties)}</p><p class="metadata">First published in reviewed news: ${esc(dateLabel(x.first_published_at, true))}<br>Last changed: ${esc(dateLabel(x.last_changed_at, true))}</p>${citationList(x.source_ids)}</article>`).join('') : '<p class="empty">No reviewed developments in this selection.</p>'}${context.length ? `<section class="context"><h2>Reviewed topic context</h2>${context.map(x => `<article><h3>${esc(x.kind[0].toUpperCase() + x.kind.slice(1))}</h3><p>${esc(x.text)}</p><p class="metadata">Supporting developments: ${x.development_keys.map(k => esc(state.news.developments.find(d => d.event_key === k).headline)).join(' · ')}</p>${x.source_ids.length ? citationList(x.source_ids) : ''}</article>`).join('')}</section>` : ''}</section>`;
    }
    function topicTile(topic, index) {
      const count = state.news?.developments.filter(item => item.subtopics.includes(topic[0])).length;
      const status = count === undefined ? 'News unavailable' : `${count} reviewed development${count === 1 ? '' : 's'}`;
      return `<button type="button" class="topic-tile" id="topic-${topic[0]}" data-action="tile" data-value="${topic[0]}"><span class="tile-art" aria-hidden="true"><svg viewBox="0 0 96 84" focusable="false">${motifs[index]}</svg></span><span class="tile-number">PHYSICAL AI / 0${index + 1}</span><strong>${esc(topic[1])}</strong><span class="tile-description">${esc(topic[2])}</span><span class="tile-footer"><span>${status}</span><span class="tile-arrow" aria-hidden="true">↗</span></span></button>`;
    }
    function render(focus) {
      // Replacing the content removes its active node. Restore the current
      // control, not the control that started an earlier asynchronous load.
      const active = root.activeElement;
      const link = active?.tagName === 'A' ? active.getAttribute('href') : null;
      focus ||= active?.id ? '#' + active.id : active?.dataset.action ? `[data-action="${active.dataset.action}"][data-value="${active.dataset.value}"]` : null;
      const f = state.foundations;
      content.innerHTML = `<header class="intro"><span class="eyebrow">Learning / Physical AI &amp; robotics</span><h1>Physical AI &amp; robotics.</h1><p>Pick a subtopic. Catch up on its developments, then go deeper.</p><p class="snapshot-note">A curated saved snapshot. Retry reloads this saved publication; it does not scan sources or produce a new review.</p></header><div class="toolbar"><nav aria-label="Learning views">${button('view','feed','Feed',`aria-pressed="${state.view === 'feed'}"`)}${button('view','news','News',`aria-pressed="${state.view === 'news'}"`)}</nav>${button('retry','','Retry saved snapshot')}</div><div class="notices" role="status" aria-live="polite">${state.loading ? '<p>Loading saved snapshot…</p>' : ''}${Object.values(state.notices).map(n => `<p>${esc(n)}</p>`).join('')}</div>${state.topic || state.view === 'news' ? `<div class="filters" aria-label="Subtopic filter">${button('topic','','All topics',`id="all-topics" aria-pressed="${!state.topic}"`)}${TOPICS.map(t => button('topic',t[0],t[1],`aria-pressed="${state.topic === t[0]}"`)).join('')}</div>` : ''}${state.topic ? `<div class="journey-heading">${button('back','','← Back to topics')}<h2 id="topic-heading" tabindex="-1">${esc(topicTitle(state.topic))}</h2></div>` : ''}${state.view === 'feed' ? (state.topic ? `${news()}${f ? `<section aria-label="Foundations"><div class="section-heading"><h2>Foundations</h2><span>${matching(f.explainers).length} readings</span></div>${matching(f.explainers).map(foundation).join('') || '<p class="empty">No foundations in this selection.</p>'}</section>` : ''}` : `<section aria-label="Physical AI topics"><div class="section-heading"><h2>Your subtopics</h2><span>Open a tile for the related news</span></div><div class="topic-grid">${TOPICS.map(topicTile).join('')}</div></section>${f ? `<details class="start"><summary><span>Start reading</span><span class="start-hint">Background guides · optional reading path</span></summary><ol>${f.reading_order.map(key => {const x = f.explainers.find(r => r.id === key); return `<li>${button('start',key,x.title,`id="start-${key}"`)}<span>${esc(x.preview)}</span></li>`;}).join('')}</ol>${f.explainers.length ? '' : '<p class="empty">No foundations in this saved snapshot.</p>'}</details>` : ''}`) : news()}`;
      const target = focus ? root.querySelector(focus) : link ? [...root.querySelectorAll('a')].find(a => a.getAttribute('href') === link) : null;
      if (target) target.closest('details')?.setAttribute('open', '');
      if (target) target.focus({preventScroll: true});
      else if (active) root.querySelector(`[data-action="view"][data-value="${state.view}"]`)?.focus({preventScroll: true});
    }
    async function reload() {
      const serial = ++request;
      state.loading = true; render();
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(assetBase + 'learning-snapshot.json', {signal: controller.signal, cache: 'no-store', credentials: 'omit'});
        if (!response.ok) throw new Error('Snapshot request failed');
        const value = await response.json();
        if (!object(value) || value.schema_version !== 1) throw new Error('Unsupported snapshot');
        if (serial !== request) return;
        for (const [key, validate] of [['foundations', foundationSection], ['news', newsSection]]) {
          const section = validate(value[key]);
          const label = key === 'news' ? 'News' : 'Foundations';
          if (section) {
            state[key] = section.data;
            state.notices[key] = section.partial ? `${label} is partial: invalid records or references were omitted; available content remains usable.` : '';
          } else state.notices[key] = `${label} unavailable: section missing or malformed.${state[key] ? ' Previously loaded content is retained and may be stale.' : ''} Retry the saved snapshot to recover.`;
        }
      } catch (_) {
        if (serial !== request) return;
        for (const key of ['foundations','news']) state.notices[key] = `${key === 'news' ? 'News' : 'Foundations'} unavailable: the saved snapshot could not be loaded.${state[key] ? ' Previously loaded content is retained and may be stale.' : ''} Retry to recover.`;
      } finally {
        clearTimeout(timeout);
        if (serial === request) { state.loading = false; render(); }
      }
    }
    root.addEventListener('click', event => {
      const control = event.target.closest('[data-action]');
      if (!control) return;
      const {action, value} = control.dataset;
      if (action === 'retry') { reload(); return; }
      if (action === 'view') { state.view = value; render(`[data-action="view"][data-value="${value}"]`); return; }
      if (action === 'back') { state.topic = null; state.view = 'feed'; state.expanded = null; render('#' + state.origin); return; }
      if (action === 'tile' || action === 'topic') {
        state.topic = value || null; state.expanded = null;
        if (value) state.origin = 'topic-' + value;
        render(value ? '#topic-heading' : state.view === 'feed' ? '#' + state.origin : '#all-topics'); return;
      }
      if (action === 'start' || action === 'related') {
        const item = state.foundations?.explainers.find(x => x.id === value);
        if (!item) return;
        if (action === 'start') state.origin = 'start-' + value;
        if (!item.subtopics.includes(state.topic)) state.topic = item.subtopics[0];
        state.view = 'feed'; state.expanded = value;
        render('#topic-heading');
        root.querySelector('#foundation-' + value)?.scrollIntoView({block: 'start'});
      }
    });
    const api = {reload, ready: null};
    mounted.set(host, api);
    api.ready = reload();
    return api;
  }
  const Learning = {mount};
  if (typeof module !== 'undefined' && module.exports) module.exports = Learning;
  scope.Learning = Learning;
})(typeof window !== 'undefined' ? window : globalThis);
