/* Academics is read-only and isolated from the other Secundus views. */
(function(global){
  'use strict';
  const PATH='orgs/academic/data/dashboard.json';
  const owners=new WeakMap();
  const assetBase=typeof document!=='undefined'?new URL('.',document.currentScript.src):null;
  function safeUrl(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch(_){return null;}}
  function normalize(value){
    if(!value||value.schemaVersion!==1||!Array.isArray(value.courses)||!Array.isArray(value.tasks)||!value.snapshot)throw new Error('The coursework export is invalid or unsupported.');
    const ids=new Set(),courseIds=new Set();
    const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]+$/.test(id);
    const str=v=>typeof v==='string'?v:'';
    const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v)&&Number.isFinite(Date.parse(v));
    const courses=value.courses.map(c=>{
      if(!validId(c.id)||courseIds.has(c.id))throw new Error('The coursework export contains invalid course identifiers.');
      courseIds.add(c.id);
      return {...c,code:str(c.code),name:str(c.name),files:(c.files||[]).map(f=>({name:str(f.name),url:safeUrl(f.url)})),resources:(c.resources||[]).map(r=>({name:str(r.name),url:safeUrl(r.url)})).filter(r=>r.url)};
    });
    const tasks=value.tasks.map(t=>{
      if(!validId(t.id)||ids.has(t.id)||!courseIds.has(t.courseId))throw new Error('The coursework export contains invalid assignment identifiers.');
      ids.add(t.id);const c=courses.find(c=>c.id===t.courseId);
      return {...t,title:str(t.title),course:c.code,courseName:c.name,source:str(t.source),sourceUrl:safeUrl(t.sourceUrl),
        sourceState:str(t.sourceState)||'Submission status not saved',workState:str(t.workState)||'Not recorded',
        dueAt:validDate(t.dueAt)?t.dueAt:null,dateOnly:validDate(t.dateOnly)?t.dateOnly:null,fetchedAt:validDate(t.fetchedAt)?t.fetchedAt:null,
        status:['record','submitted','todo'].includes(t.status)?t.status:'todo',summary:str(t.summary),requirements:(t.requirements||[]).map(str),
        materials:(t.materials||[]).map(m=>({name:str(m.name),note:str(m.note),url:safeUrl(m.url)})),issues:(t.issues||[]).map(str)};
    });
    return {courses,tasks,snapshot:{term:str(value.snapshot.term),dbUpdatedAt:validDate(value.snapshot.dbUpdatedAt)?value.snapshot.dbUpdatedAt:null,exportedAt:validDate(value.snapshot.exportedAt)?value.snapshot.exportedAt:null,warnings:(value.snapshot.warnings||[]).map(str)}};
  }
  async function mount(host,options){
    if(!host||typeof options?.readFile!=='function')throw new Error('Academics needs the authenticated repository reader.');
    if(owners.has(host))return owners.get(host).promise;
    const record={promise:null};owners.set(host,record);
    const shadow=host.shadowRoot||host.attachShadow({mode:'open'});
    let stylesReady=false, lastSha, loading=false;
    const editing=()=>shadow.activeElement?.matches("input,textarea,select,[contenteditable]") || shadow.querySelector("dialog[open]");
    async function load(background=false){
      if(loading || background && editing())return true;
      loading=true;
      const previous=shadow.querySelector('.academics-root');
      if(previous){const button=previous.querySelector('#refresh-coursework');if(button){button.disabled=true;button.textContent='Refreshing…';}}
      else {
        host.setAttribute('aria-busy','true');
        shadow.querySelectorAll('.load-state').forEach(el=>el.remove());
        const loading=host.ownerDocument.createElement('p');loading.className='load-state';loading.setAttribute('role','status');loading.textContent='Loading saved coursework…';shadow.append(loading);
      }
      try{
        const result=await options.readFile(PATH);
        if(!result)throw new Error('No saved coursework export is available in this repository.');
        const fixture=normalize(result.data);
        if(background && (editing() || result.sha===lastSha))return true;
        if(!stylesReady){
          const styles=await Promise.allSettled(['tokens.css','academics.css'].map(name=>new Promise((resolve,reject)=>{
            const link=host.ownerDocument.createElement('link');link.rel='stylesheet';link.href=new URL(name,assetBase).href;
            const timer=setTimeout(()=>{link.remove();reject(new Error('Academics styles could not load.'));},15000);
            link.onload=()=>{clearTimeout(timer);resolve();};link.onerror=()=>{clearTimeout(timer);link.remove();reject(new Error('Academics styles could not load.'));};shadow.append(link);
          })));
          if(styles.some(result=>result.status==='rejected')){
            shadow.querySelectorAll('link').forEach(link=>link.remove());
            throw new Error('Academics styles could not load.');
          }
          stylesReady=true;
        }
        const saved=previous?.syncView?.();
        shadow.querySelectorAll('.academics-root,.load-state').forEach(el=>el.remove());
        const root=host.ownerDocument.createElement('div');root.className='academics-root';shadow.append(root);
        install(root,fixture,()=>load(false),saved);lastSha=result.sha;
      }catch(error){
        if(previous){const warning=previous.querySelector('#snapshot-warning');warning.textContent='Could not refresh saved data. Showing the previous export. '+error.message;warning.className='academics-notice';}
        else {shadow.querySelectorAll('.load-state').forEach(el=>el.remove());const box=host.ownerDocument.createElement('div');box.className='load-state';box.setAttribute('role','alert');const text=host.ownerDocument.createElement('p');text.textContent='Coursework could not load. '+error.message;box.append(text);const retry=host.ownerDocument.createElement('button');retry.textContent='Try again';retry.onclick=()=>{retry.disabled=true;record.promise=load();};box.append(retry);shadow.append(box);}
        return false;
      }finally{loading=false;host.removeAttribute('aria-busy');const button=shadow.querySelector('#refresh-coursework');if(button){button.disabled=false;button.textContent='Refresh saved data';}}
    }
    record.promise=load();
    if(options.watch)record.watch=options.watch(()=>load(true));
    return record.promise;
  }
  function install(root,fixture,reload,saved){
    root.innerHTML="  <div class=\"app-shell\">\n    <aside class=\"app-sidebar\" aria-label=\"Academic navigation\">\n      <div class=\"sidebar-title\">Workspace</div>\n      <nav class=\"design-nav\" aria-label=\"Views\">\n        <a href=\"#academic-timeline\" data-view=\"timeline\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"3\"/><path d=\"M7 3v4m10-4v4M3 10h18m-13 4h1m6 0h1m-8 4h1\"/></svg><span>Calendar</span></a>\n        <a href=\"#academic-ledger\" data-view=\"ledger\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M9 6h12M9 12h12M9 18h12M3 6h1m-1 6h1m-1 6h1\"/></svg><span>Assignments</span></a>\n        <a href=\"#academic-map\" data-view=\"map\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M12 6c-3-3-7-3-10-2v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 2Zm0 0v15\"/></svg><span>Courses</span></a>\n        <a href=\"#academic-focus\" data-view=\"focus\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"4\"/><path d=\"m8 12 3 3 5-6\"/></svg><span>Focus</span></a>\n      </nav>\n      <div class=\"sidebar-title course-heading\">Courses <span>5</span></div>\n      <nav id=\"course-strip\" class=\"course-strip\" aria-label=\"Filter by course\"></nav>\n      <p class=\"sidebar-tip\">Select a course to filter.<br>Select it again to see all.</p>\n      <div class=\"sidebar-bottom\"><span class=\"saved-dot\" aria-hidden=\"true\"></span> Saved coursework <small><span id=\"sidebar-source-date\"></span></small></div>\n    </aside>\n    <main id=\"main\">\n      <div class=\"snapshot-bar\"><span id=\"snapshot-date\"></span><button type=\"button\" id=\"refresh-coursework\">Refresh saved data</button></div><div id=\"snapshot-warning\"></div><div class=\"controlbar\"><div class=\"workspace-label\">Academics</div><label class=\"search\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" aria-hidden=\"true\"><circle cx=\"10.5\" cy=\"10.5\" r=\"6.5\"/><path d=\"m16 16 4.5 4.5\"/></svg><span class=\"sr-only\">Find an assignment</span><input id=\"search\" type=\"search\" placeholder=\"Search homework\"></label><details class=\"filters\"><summary>Filter</summary><div class=\"filter-panel\"><label>Course<select id=\"course\"><option value=\"all\">All courses</option></select></label><label>Status<select id=\"status\"><option value=\"all\">All work</option><option value=\"todo\">To do</option><option value=\"record\">Course records</option><option value=\"submitted\">Submitted</option></select></label></div></details></div>\n      <div id=\"results-summary\" class=\"results\" aria-live=\"polite\"></div>\n      <div id=\"content\"></div>\n      <footer><span>Saved coursework · Pacific time</span><button id=\"about-footer\">Source &amp; scope</button></footer>\n    </main>\n  </div>\n  <dialog id=\"task-dialog\" aria-labelledby=\"task-dialog-title\"><div class=\"dialog-toolbar\"><button id=\"task-close\">Done</button><span class=\"eyebrow\">Assignment details</span></div><div id=\"dialog-content\"></div></dialog>\n  <dialog id=\"about-dialog\" aria-labelledby=\"about-title\"><div class=\"dialog-toolbar\"><span class=\"eyebrow\">Data &amp; sources</span><button id=\"about-close\">Done</button></div><div class=\"about-content\"><h2 id=\"about-title\">Your saved coursework.</h2><p id=\"about-snapshot\"></p><p>The calendar uses source due dates in Pacific time. Planning targets remain separate: deadlines before 2 PM are planned for 9 PM the previous evening.</p><p>Refresh saved data reloads the repository export. It does not refresh Canvas. Missing deadlines remain visible below the calendar. Source capture dates appear in each homework detail.</p><p>Drafts and assignment files stay in the course library. Source links open the original course service. This view cannot submit assignments or change coursework.</p></div></dialog>";
'use strict';
const courseCatalog=fixture.courses;
const dateParts=value=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
const dateLabel=d=>new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
const clockLabel=h=>`${Math.floor(h)%12||12}:${String(Math.round((h%1)*60)).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
const tasks=fixture.tasks.map(t=>{
 const p=t.dueAt?dateParts(t.dueAt):null;
 const date=p?`${p.year}-${p.month}-${p.day}`:t.dateOnly;
 const hour=p?Number(p.hour)+Number(p.minute)/60:null;
 const earlier=hour!==null&&hour<14;
 const planDate=earlier?new Date(new Date(date+'T12:00:00Z').getTime()-86400000).toISOString().slice(0,10):date;
 const planHour=earlier?21:hour;
 const due=date?`${dateLabel(date)}${hour===null?' · Time not listed':' · '+clockLabel(hour)}`:'Not listed';
 const plan=planDate?`${dateLabel(planDate)}${planHour===null?' · Time not listed':' · '+clockLabel(planHour)}`:'Not set';
 const materials=t.materials.map(m=>['LINK',m.name,m.note,m.url]);
 return {...t,date,hour,planDate,planHour,due,plan,short:due,planNote:earlier?'Before 2 PM → previous evening at 9 PM':'Based on the saved deadline',state:t.workState,warning:t.issues.join(' '),context:t.materials.length?`${t.materials.length} reference${t.materials.length===1?'':'s'}`:t.requirements.length?'Instructions saved':'External activity',contextTone:'',materials};
});

let workspaceCourse=courseCatalog[0]?.id;
const sourceLink=t=>t.sourceUrl?`<a class="button-link" target="_blank" rel="noopener noreferrer" href="${esc(t.sourceUrl)}">Open ${t.source==='Canvas'?'in Canvas':'course source'}</a>`:'';
function courseResources(c){return `<div class="course-links">${c.resources.map(r=>`<a target="_blank" rel="noopener noreferrer" href="${esc(r.url)}">${esc(r.name)} ↗</a>`).join('')}</div>`;}
function courseEmpty(c){return `<section class="empty"><span class="eyebrow">${esc(c.code)}</span><h2>${esc(c.name)}</h2><p>No work matches this selection.</p><p class="subtle">${tasks.filter(t=>t.courseId===c.id).length} saved records · ${c.files.length} library files</p>${courseResources(c)}<button id="clear-filters">Show all work</button></section>`;}
function courseWorkspace(items){
 const filter=$('#course').value;
 const c=courseCatalog.find(c=>filter!=='all'?c.code===filter:c.id===workspaceCourse)||courseCatalog[0];
 workspaceCourse=c.id;
 const rows=items.filter(t=>t.courseId===c.id).sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999'));
 return `<section class="course-workspace"><aside class="course-index"><div class="eyebrow">Course workspace</div><h1>Your courses.</h1>${courseCatalog.map(x=>`<button data-workspace="${x.id}" aria-pressed="${x.id===c.id}"><b>${esc(x.code)}</b><span>${esc(x.name)}</span><small>${tasks.filter(t=>t.courseId===x.id).length} records</small></button>`).join('')}</aside><article class="course-page"><div class="eyebrow">${esc(fixture.snapshot.term)} / ${esc(c.code)}</div><h2>${esc(c.name)}</h2>${courseResources(c)}<div class="course-columns"><section class="course-work"><h3>Coursework <span>${rows.length}</span></h3>${rows.map(t=>`<button class="course-row" data-task="${t.id}"><span><strong>${esc(t.title)}</strong><small>${esc(t.source)}${t.status==='submitted'?' · Submitted':t.status==='record'?' · Course record':''}</small></span><span class="course-row-date">${esc(t.short)}</span></button>`).join('')||'<p class="subtle">No work matches this selection.</p>'}</section><aside class="course-library"><h3>Saved library <span>${c.files.length}</span></h3><p>References from the existing course library.</p>${c.files.map(f=>`<div class="library-file">${f.url?`<a target="_blank" rel="noopener noreferrer" href="${esc(f.url)}">${esc(f.name)} ↗</a>`:`<span>${esc(f.name)}</span>`}</div>`).join('')||'<small>No files listed in this library index.</small>'}</aside></div></article></section>`;
}

function detail(t,inDialog=false){return `<div class="detail-content course-detail" data-course-id="${esc(t.courseId)}"><div class="course-code">${esc(t.course)} · ${esc(t.courseName)}</div><h2${inDialog?' id="task-dialog-title"':''}>${esc(t.title)}</h2><div class="task-meta">${pill(t.source)}${pill(t.sourceState,t.status==='submitted'?'ok':'')}${pill('Work: '+t.workState)}</div><dl class="date-grid"><div><dt>Source deadline</dt><dd>${esc(t.due)}</dd><small>Pacific time</small></div><div><dt>Planning target</dt><dd class="accent">${esc(t.plan)}</dd><small>${esc(t.planNote)}</small></div></dl>${t.warning?`<p class="item-note">${esc(t.warning)}</p>`:''}<section class="detail-section"><h3>The assignment</h3><small>Source captured: ${esc(t.fetchedAt?new Date(t.fetchedAt).toLocaleString('en-US',{timeZone:'America/Los_Angeles'}):'Not recorded')} · Pacific time</small><p>${esc(t.summary)}</p>${t.requirements.map(s=>`<p>${esc(s)}</p>`).join('')}</section><section class="detail-section"><h3>Assignment references</h3>${t.materials.map(m=>`<div class="material"><span class="file-icon">${esc(m[0])}</span><div><strong>${m[3]?`<a href="${esc(m[3])}" target="_blank" rel="noopener noreferrer">${esc(m[1])} ↗</a>`:esc(m[1])}</strong><small>${esc(m[2])}</small></div></div>`).join('')||'<p>See the course workspace for the saved library.</p>'}</section><section class="detail-section"><h3>Saved work</h3><p>Work stage: ${esc(t.workState)}.</p><small>Separate from the source’s submission status. Draft content stays in the existing workflow.</small></section>${sourceLink(t)}</div>`;}

'use strict';
const courseColors = {'229416':'var(--course-mge)','229417':'var(--course-ob)','229366':'var(--course-strategy)','231675':'var(--course-robot)','230723':'var(--course-ai)'};
const courseColor = id => courseColors[id] || 'var(--text-secondary)';
const pacificToday = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
let calendarMonth = pacificToday().slice(0,7);
let calendarDay = pacificToday();
const calendarDate = d => new Date(d+'T12:00:00Z');
const fullDay = d => calendarDate(d).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:'UTC'});
const calendarClock = t => t.hour===null ? 'Time not listed' : clockLabel(t.hour);
const byDeadline = (a,b) => (a.date||'9999').localeCompare(b.date||'9999') || (a.hour??25)-(b.hour??25) || a.title.localeCompare(b.title);
function calendarEvent(t, compact=false) {
  return `<button class="cal-event ${compact?'cal-event-compact':''}" data-task="${esc(t.id)}" data-course-id="${esc(t.courseId)}" aria-label="${esc(t.course+': '+t.title+', '+t.due+(t.status==='submitted'?', submitted':''))}"><span class="cal-event-course">${esc(t.course)}${t.status==='submitted'?'<span class="cal-submitted"> · Submitted</span>':''}</span><strong>${esc(t.title)}</strong><span class="cal-event-time">${esc(t.date?calendarClock(t):'Date not listed')}</span></button>`;
}
function calendarView(items) {
  const homework = items.filter(t=>t.status!=='record').sort(byDeadline);
  const monthly = homework.filter(t=>t.date?.startsWith(calendarMonth));
  const undated = homework.filter(t=>!t.date);
  const first = calendarDate(calendarMonth+'-01');
  const monthLabel = first.toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
  const offset = first.getUTCDay();
  const count = new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  const cells = Math.ceil((offset+count)/7)*7;
  if (!calendarDay.startsWith(calendarMonth)) calendarDay = monthly[0]?.date || calendarMonth+'-01';
  const selected = monthly.filter(t=>t.date===calendarDay);
  const next = monthly.find(t=>t.date>calendarDay);
  const today = pacificToday();
  const grid = Array.from({length:cells},(_,i)=>{
    const n=i-offset+1;
    if(n<1||n>count)return '<div class="cal-cell cal-outside" aria-hidden="true"></div>';
    const date=calendarMonth+'-'+String(n).padStart(2,'0');
    const tasksOnDay=monthly.filter(t=>t.date===date);
    const label=`${fullDay(date)}, ${tasksOnDay.length} homework ${tasksOnDay.length===1?'item':'items'}`;
    return `<div class="cal-cell ${date===calendarDay?'is-selected':''} ${date===today?'is-today':''}"><button class="cal-day" data-calendar-day="${date}" aria-label="${esc(label)}" aria-pressed="${date===calendarDay}" ${date===today?'aria-current="date"':''}><span>${n}</span><span class="cal-dots" aria-hidden="true">${[...new Set(tasksOnDay.map(t=>t.courseId))].map(id=>`<i style="background:${courseColor(id)}"></i>`).join('')}</span><span class="cal-mobile-count" aria-hidden="true">${tasksOnDay.length||''}</span></button><div class="cal-cell-events">${tasksOnDay.slice(0,3).map(t=>calendarEvent(t,true)).join('')}${tasksOnDay.length>3?`<button class="cal-more" data-calendar-day="${date}">+${tasksOnDay.length-3} more</button>`:''}</div></div>`;
  }).join('');
  return `<section class="homework-calendar" aria-label="Homework calendar"><div class="cal-toolbar"><div class="cal-month-heading"><span class="cal-eyebrow">Your coursework</span><h1 id="cal-month-title" aria-live="polite">${first.toLocaleDateString('en-US',{month:'long',timeZone:'UTC'})} <span>${first.getUTCFullYear()}</span></h1><p class="cal-month-count">${monthly.length} homework ${monthly.length===1?'item':'items'} this month</p></div><div class="cal-month-nav"><button data-calendar-today>Today</button><div class="cal-arrows"><button data-calendar-move="-1" aria-label="Previous month">‹</button><button data-calendar-move="1" aria-label="Next month">›</button></div></div></div><div class="cal-layout"><div class="cal-month" aria-labelledby="cal-month-title"><div class="cal-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<span>${d}</span>`).join('')}</div><div class="cal-grid">${grid}</div>${monthly.length?'':'<p class="cal-empty-month">No homework matches this month and these filters.</p>'}<p class="cal-hint">Colors identify courses. <span class="cal-mobile-hint">Choose a date to see its homework below.</span> Due dates come from the saved source.</p></div><aside class="cal-agenda" aria-label="Selected day’s homework"><span class="eyebrow">Day at a glance</span><h2>${esc(fullDay(calendarDay))}</h2><p class="cal-agenda-count">${selected.length} homework ${selected.length===1?'item':'items'}</p><div class="cal-day-items">${selected.map(t=>calendarEvent(t)).join('')||`<div class="cal-rest"><span class="rest-icon" aria-hidden="true">✓</span><p>No homework due.</p><small>For this date in the saved coursework.</small>${next?`<button data-calendar-day="${next.date}">Next due · ${dateLabel(next.date)}</button>`:''}</div>`}</div></aside></div>${undated.length?`<section class="cal-undated"><h2>Without a due date <span>${undated.length}</span></h2><p>These assignments stay visible until a source provides a date.</p><div>${undated.map(t=>calendarEvent(t)).join('')}</div></section>`:''}</section>`;
}
root.addEventListener('click',e=>{
  const move=e.target.closest('[data-calendar-move]');
  const day=e.target.closest('[data-calendar-day]');
  const today=e.target.closest('[data-calendar-today]');
  if(!move&&!day&&!today)return;
  if(move){const d=calendarDate(calendarMonth+'-01');d.setUTCMonth(d.getUTCMonth()+Number(move.dataset.calendarMove));calendarMonth=d.toISOString().slice(0,7);calendarDay=calendarMonth+'-01';}
  if(today){calendarDay=pacificToday();calendarMonth=calendarDay.slice(0,7);}
  if(day){calendarDay=day.dataset.calendarDay;calendarMonth=calendarDay.slice(0,7);}
  render();
  if(day){const target=root.querySelector(`.cal-day[data-calendar-day="${calendarDay}"]`);target?.focus({preventScroll:true});if(window.matchMedia('(max-width:760px)').matches)root.querySelector('.cal-agenda')?.scrollIntoView({block:'start',behavior:'smooth'});}
  if(move)root.querySelector(`[data-calendar-move="${move.dataset.calendarMove}"]`)?.focus({preventScroll:true});
  if(today)root.querySelector('[data-calendar-today]')?.focus({preventScroll:true});
});

'use strict';
const $=s=>root.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pill=(s,tone='')=>`<span class="pill ${tone}">${esc(s)}</span>`;
const views={focus:'Focus desk',timeline:'Homework calendar',ledger:'Work ledger',map:'Course workspace'};
let view='timeline',selected=tasks[0]?.id;
const courses=courseCatalog.map(c=>c.code);
$('.course-heading span').textContent=courseCatalog.length;
$('#course').insertAdjacentHTML('beforeend',courses.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join(''));
const canvasState=t=>t.sourceState;
function filtered(){const q=$('#search').value.trim().toLowerCase();return tasks.filter(t=>($('#course').value==='all'||t.course===$('#course').value)&&($('#status').value==='all'||t.status===$('#status').value)&&(!q||`${t.title} ${t.course} ${t.courseName}`.toLowerCase().includes(q)));}
function focusView(items){
  items=[...items].sort((a,b)=>({todo:0,submitted:1,record:2}[a.status]-{todo:0,submitted:1,record:2}[b.status])||(a.date||'9999').localeCompare(b.date||'9999'));
  if(!items.some(t=>t.id===selected))selected=items[0].id;
  const t=tasks.find(x=>x.id===selected);
  return `<div class="focus-layout"><article class="focus-stage"><div class="mobile-picker"><label for="focus-picker">Open assignment · ${items.length} in view</label><select id="focus-picker">${items.map(x=>`<option value="${x.id}" ${x.id===selected?'selected':''}>${esc(x.title)} · ${esc(x.course)}</option>`).join('')}</select></div><div class="focus-topline"><span class="eyebrow">${esc(t.course)} / ${esc(t.courseName)}</span><span>Focus desk</span></div><h1>${esc(t.title)}</h1><p class="focus-summary">${esc(t.summary)}</p><div class="focus-dates"><div><small>${esc(t.source)} deadline</small><b>${esc(t.due)}</b></div><div><small>Planning target</small><b class="plan">${esc(t.plan)}</b></div></div>${t.warning?`<p class="note">${esc(t.warning)}</p>`:''}<div class="focus-body"><section><h2>THE WORK</h2><ol class="brief-list">${t.requirements.map(r=>`<li><span>${esc(r)}</span></li>`).join('')}</ol></section><aside class="focus-facts"><h2>CONTEXT AT HAND</h2>${t.materials.map(m=>`<div class="source-line"><span class="type">${m[0]}</span><strong>${m[3]?`<a href="${esc(m[3])}" target="_blank" rel="noopener noreferrer">${esc(m[1])} ↗</a>`:esc(m[1])}</strong><small>${esc(m[2])}</small></div>`).join('')}<p class="saved-work">${pill(canvasState(t),t.status==='submitted'?'ok':'')}<br><br>Saved work stage: ${esc(t.workState)}</p></aside></div><div class="focus-actions"><button class="primary" data-task="${t.id}">Full assignment details</button>${sourceLink(t)}</div></article><aside class="focus-queue"><div class="queue-heading"><h2>All work</h2><span>${items.length} records</span></div>${items.map(x=>`<button class="queue-item" data-focus="${x.id}" aria-current="${x.id===selected}"><strong>${esc(x.title)}</strong><small>${esc(x.course)}</small><span class="qdate">${esc(x.short)}</span>${x.status==='check'?`<small class="tone-warn">${esc(x.context)}</small>`:x.status==='submitted'?'<small class="tone-ok">Submitted</small>':x.status==='record'?'<small>Course record</small>':''}</button>`).join('')}<p class="queue-foot">Select any assignment to bring its requirements into the desk. </p></aside></div>`;
}
let ledgerSort='deadline',ledgerField='due';
function workLedger(items){
 const rows=[...items].sort((a,b)=>ledgerSort==='title'?a.title.localeCompare(b.title):ledgerSort==='course'?a.course.localeCompare(b.course):(a.date||'9999').localeCompare(b.date||'9999'));
 return `<section class="ledger-view"><div class="ledger-heading"><div><div class="eyebrow">Assignments</div><h1 class="surface-title">The whole workload.</h1></div><label class="ledger-sort">Sort by<select id="ledger-sort"><option value="deadline" ${ledgerSort==='deadline'?'selected':''}>Source deadline</option><option value="title" ${ledgerSort==='title'?'selected':''}>Assignment</option><option value="course" ${ledgerSort==='course'?'selected':''}>Course</option></select></label></div><div class="ledger-stats"><span><b>${items.filter(t=>t.status==='todo').length}</b> To do</span><span><b>${new Set(items.map(t=>t.course)).size}</b> Courses</span><span><b>${items.filter(t=>t.status==='submitted').length}</b> Submitted</span></div><label class="ledger-mobile-field">Compare field<select id="ledger-field">${[['due','Source deadline'],['plan','Planning target'],['context','Saved context'],['canvas','Submission']].map(([k,label])=>`<option value="${k}" ${ledgerField===k?'selected':''}>${label}</option>`).join('')}</select></label><table class="work-table" data-field="${ledgerField}"><caption class="sr-only">Assignments with deadlines, planning targets, context and Submission</caption><thead><tr><th class="row-number" scope="col">#</th><th scope="col">Assignment / course</th><th class="metric" data-field="due" scope="col">Source deadline</th><th class="metric" data-field="plan" scope="col">Planning target</th><th class="metric" data-field="context" scope="col">Saved context</th><th class="metric" data-field="canvas" scope="col">Submission</th></tr></thead><tbody>${rows.map((t,i)=>`<tr><td class="row-number">${String(i+1).padStart(2,'0')}</td><th scope="row"><button data-task="${t.id}" class="ledger-task">${esc(t.title)}</button><small>${esc(t.course)}</small></th><td class="metric" data-field="due">${esc(t.date?t.short:t.due)}${t.dateOnly?'<small>Time not listed</small>':''}</td><td class="metric" data-field="plan">${esc(t.plan)}</td><td class="metric" data-field="context"><span class="ledger-context ${t.contextTone}">${esc(t.context)}</span></td><td class="metric" data-field="canvas">${esc(canvasState(t))}</td></tr>`).join('')}</tbody></table><div class="ledger-bottom"><span>Select an assignment name for the full brief.</span><span>Saved source status; open details for work stage.</span></div></section>`;
}
function render(){root.dataset.activeView=view;root.querySelectorAll('[data-view]').forEach(a=>{if(a.dataset.view===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});const items=filtered();$('#results-summary').textContent=`${items.length} of ${tasks.length} records · ${courseCatalog.length} courses`;$('#course-strip').innerHTML=courseCatalog.map(c=>`<button data-course="${esc(c.code)}" aria-pressed="${$('#course').value===c.code}"><b>${esc(c.code)}</b><span>${esc(c.name)}</span></button>`).join('');$('#content').innerHTML=(courseCatalog.length&&(items.length||view==='map'||view==='timeline'))?({focus:focusView,timeline:calendarView,ledger:workLedger,map:courseWorkspace}[view])(items):($('#course').value!=='all'&&courseCatalog.some(c=>c.code===$('#course').value)?courseEmpty(courseCatalog.find(c=>c.code===$('#course').value)):'<div class="empty"><h2>No matching assignments</h2><p>Try another search or clear your filters.</p><button id="clear-filters">Clear filters</button></div>');if(!courseCatalog.length)$('#content').innerHTML='<div class="empty"><h2>No saved coursework yet</h2><p>Your saved assignments will appear here when available.</p></div>';if(view==='map')$('#results-summary').textContent=`${root.querySelectorAll('.course-row').length} records in this course · ${courseCatalog.length} courses`;if(view==='timeline')$('#results-summary').textContent=`${items.filter(t=>t.status!=='record').length} homework items · ${courseCatalog.length} courses`;}
function openTask(id){$('#dialog-content').innerHTML=detail(tasks.find(t=>t.id===id),true);$('#task-dialog').showModal();$('#task-dialog').scrollTop=0;}
root.addEventListener('click',e=>{const course=e.target.closest('[data-course]');if(course){$('#course').value=$('#course').value===course.dataset.course?'all':course.dataset.course;render();return;}const workspace=e.target.closest('[data-workspace]');if(workspace){workspaceCourse=workspace.dataset.workspace;$('#course').value='all';render();return;}const task=e.target.closest('[data-task]');if(task){openTask(task.dataset.task);return;}const choose=e.target.closest('[data-focus]');if(choose){selected=choose.dataset.focus;render();$('#content').scrollIntoView({block:'start'});return;}const link=e.target.closest('[data-view]');if(link){e.preventDefault();view=link.dataset.view;render();}if(e.target.id==='clear-filters'){$('#search').value='';$('#course').value='all';$('#status').value='all';render();}});
root.addEventListener('change',e=>{if(e.target.id==='focus-picker'){selected=e.target.value;render();}if(e.target.id==='ledger-sort'){ledgerSort=e.target.value;render();}if(e.target.id==='ledger-field'){ledgerField=e.target.value;render();}});
$('#search').addEventListener('input',render);$('#course').addEventListener('change',render);$('#status').addEventListener('change',render);

$('#task-close').onclick=()=>$('#task-dialog').close();
for(const id of ['about-footer'])$('#'+id).onclick=()=>$('#about-dialog').showModal();$('#about-close').onclick=()=>$('#about-dialog').close();
if(saved){view=saved.view;selected=saved.selected;workspaceCourse=saved.workspaceCourse;ledgerSort=saved.ledgerSort;ledgerField=saved.ledgerField;for(const id of ['search','course','status'])$('#'+id).value=saved[id];}
root.syncView=()=>({view,selected,workspaceCourse,ledgerSort,ledgerField,search:$('#search').value,course:$('#course').value,status:$('#status').value});
render();

    const formatDate=value=>value?new Date(value).toLocaleString('en-US',{timeZone:'America/Los_Angeles'}):'Not recorded';
    const dates=fixture.tasks.map(t=>t.fetchedAt).filter(Boolean).sort((a,b)=>Date.parse(a)-Date.parse(b));
    const oldest=dates[0],newest=dates[dates.length-1];
    const sourceLine='Source captures: '+formatDate(oldest)+(oldest!==newest?' – '+formatDate(newest):'')+' · Pacific time';
    $('#snapshot-date').textContent=sourceLine;
    $('#sidebar-source-date').textContent=fixture.snapshot.term+' · Saved data';
    $('#about-snapshot').textContent=sourceLine+'. Work status saved: '+formatDate(fixture.snapshot.dbUpdatedAt)+'. Exported: '+formatDate(fixture.snapshot.exportedAt)+'.';
    const warnings=[...fixture.snapshot.warnings];
    if(oldest&&Date.now()-Date.parse(oldest)>7*86400000)warnings.push('Some source captures are over a week old. Check the original course source for changes.');
    if(warnings.length){$('#snapshot-warning').textContent=warnings.join(' ');$('#snapshot-warning').className='academics-notice';}
    $('#refresh-coursework').onclick=reload;
  }
  const api={mount,normalize};
  if(typeof module==='object'&&module.exports)module.exports=api;
  global.Academics=api;
})(typeof window!=='undefined'?window:globalThis);
