/* Recipe requests use the same private GitHub data connection as the library. */
'use strict';
const RecipeWorkflow = (() => {
  const DIR='orgs/health/data/recipe-requests';
  // Render the supported card syntax with DOM nodes; source HTML is never executed.
  function format(host,text) {
    const lines=String(text || '').replace(/(^|\n)---\r?\n(?=type: recipe)[\s\S]*?\r?\n---(?:\r?\n|$)/g,'$1').split(/\r?\n/);
    function inline(parent,value) {
      const pattern=/(\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;let cursor=0,m;
      while((m=pattern.exec(value))) {
        parent.append(document.createTextNode(value.slice(cursor,m.index)));
        const el=document.createElement(m[2]?'strong':'a');el.textContent=m[2] || m[3];
        if(m[4]) {el.href=m[4];el.target='_blank';el.rel='noopener noreferrer';}
        parent.append(el);cursor=pattern.lastIndex;
      }
      parent.append(document.createTextNode(value.slice(cursor)));
    }
    for(let i=0;i<lines.length;i++) {
      const line=lines[i];if(!line.trim() || /^---+$/.test(line.trim()))continue;
      if(line==='## Original card reference (not the current instructions)') {
        const details=document.createElement('details'),summary=document.createElement('summary');
        summary.textContent='Original source and cooking notes';details.append(summary);host.append(details);
        format(details,lines.slice(i+1).join('\n'));break;
      }
      if(line.startsWith('|') && /^\|[\s:|-]+\|$/.test(lines[i+1] || '')) {
        const wrap=document.createElement('div');wrap.className='recipe-table';const table=document.createElement('table');wrap.append(table);host.append(wrap);
        const row=(value,tag)=>{const tr=document.createElement('tr');for(const cell of value.replace(/^\||\|$/g,'').split(/(?<!\\)\|/)){const td=document.createElement(tag);inline(td,cell.trim().replace(/\\\|/g,'|'));tr.append(td);}table.append(tr);};
        row(line,'th');i+=2;while(i<lines.length && lines[i].startsWith('|'))row(lines[i++],'td');i--;continue;
      }
      const heading=line.match(/^(#{1,6})\s+(.*)/),bullet=line.match(/^(?:[-*]|\d+\.)\s+(.*)/);
      const el=document.createElement(heading?'h'+Math.min(heading[1].length+2,6):'p');
      inline(el,heading?heading[2]:bullet?line:line.replace(/^>\s?/,''));host.append(el);
    }
  }
  function mount(parent) {
    const box=document.createElement('details');box.className='recipe-workflow';
    const title=document.createElement('summary');title.textContent='Recipe requests and drafts';box.append(title);parent.append(box);
    const note=document.createElement('p');note.textContent='Find recipes, paste a source, or request an adaptation. Results appear here after the next desktop run. Your computer and Codex must be running.';box.append(note);
    const form=document.createElement('form');box.append(form);
    const mode=document.createElement('select');mode.setAttribute('aria-label','Recipe task');
    for(const [value,label] of [['lookup','Find in my library'],['research','Find recipes online'],['ingest','Import or translate a source'],['adapt','Adapt or review a recipe']]) {
      const option=document.createElement('option');option.value=value;option.textContent=label;mode.append(option);
    }
    const text=document.createElement('textarea');text.required=true;text.maxLength=20000;text.rows=3;text.placeholder='Recipe name, link, pasted recipe, or changes you want…';text.setAttribute('aria-label','Recipe request');
    const planning=document.createElement('label'),check=document.createElement('input');check.type='checkbox';planning.append(check,' Include day planning');
    const submit=document.createElement('button');submit.type='submit';submit.textContent='Queue request';
    const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh results';
    const status=document.createElement('p');status.setAttribute('role','status');
    const results=document.createElement('div');results.className='recipe-results';
    form.append(mode,text,planning,submit,refresh);box.append(status,results);
    let loaded=false;
    async function load() {
      refresh.disabled=true;
      try {
        const files=(await listDir(DIR)).filter(f=>f.name.endsWith('.json') && f.name!=='schema.json');
        const jobs=await Promise.all(files.map(f=>readFile(f.path)));
        results.replaceChildren();
        for(const {data:j} of jobs.filter(Boolean).sort((a,b)=>b.data.created_at.localeCompare(a.data.created_at)).slice(0,20)) render(j);
        status.textContent=jobs.length?'Latest requests and results.':'No requests yet.';loaded=true;
      } catch(e) {status.textContent=e.message;} finally {refresh.disabled=false;}
    }
    function render(j) {
      const card=document.createElement('article');results.append(card);
      const heading=document.createElement('h3');heading.textContent=j.request.text;card.append(heading);
      const meta=document.createElement('p');meta.textContent=`${j.status.replaceAll('_',' ')}${j.elapsed_seconds!=null?' · '+j.elapsed_seconds+' seconds processing':''}`;card.append(meta);
      if(j.error || j.notice) {const p=document.createElement('p');p.textContent=j.error || j.notice;card.append(p);}
      if(j.output) {
        const answer=document.createElement('div');answer.className='recipe-answer';format(answer,j.output.answer);card.append(answer);
        if(j.output.preview) {
          const comparison=document.createElement('div');comparison.className='recipe-comparison';card.append(comparison);
          for(const [label,content] of [['Original',j.output.preview.before?.markdown || 'New recipe'],['Proposed',j.output.preview.markdown]]) {
            const section=document.createElement('details');section.open=true;
            const summary=document.createElement('summary');summary.textContent=label;
            const body=document.createElement('div');body.className='recipe-answer';format(body,content);section.append(summary,body);comparison.append(section);
          }
          for(const warning of j.output.preview.warnings || []) {const p=document.createElement('p');p.textContent=warning;card.append(p);}
          const caveat=document.createElement('p');caveat.textContent=j.output.preview.verification;card.append(caveat);
        }
        if(j.status==='draft' && j.output.preview) action('Approve this draft and save','approved',{approved_hash:j.output_hash});
      }
      if(['queued','draft','needs_attention','approved'].includes(j.status)) action('Cancel request','cancelled');
      if(j.status==='needs_attention') action('Retry request','queued',{error:null});
      function action(label,next,extra={}) {
        const button=document.createElement('button');button.type='button';button.textContent=label;card.append(button);
        button.onclick=async()=>{
          button.disabled=true;
          try {
            await saveJSON(`${DIR}/${j.id}.json`,current=>{
              if(current.status!==j.status || current.output_hash!==j.output_hash) throw Error('This request changed. Refresh before proceeding.');
              return {...current,...extra,status:next,updated_at:new Date().toISOString()};
            },`recipes: ${next} ${j.id} [site]`);
            await load();
          } catch(e) {status.textContent=e.message;button.disabled=false;}
        };
      }
    }
    form.onsubmit=async event=>{
      event.preventDefault();if(!text.value.trim()) return;
      submit.disabled=true;
      const id=crypto.randomUUID(),request={mode:mode.value,text:text.value.trim(),planning_mode:check.checked?'daily':'recipe_only'};
      try {
        await saveJSON(`${DIR}/${id}.json`,current=>{
          if(current.id) throw Error('Request already exists');
          return {schema_version:1,id,status:'queued',created_at:new Date().toISOString(),request};
        },`recipes: queue ${id} [site]`);
        text.value='';await load();status.textContent='Queued for the next desktop run.';
      } catch(e) {status.textContent=e.message;} finally {submit.disabled=false;}
    };
    refresh.onclick=load;box.ontoggle=()=>{if(box.open&&!loaded)load();};
  }
  return {mount,format};
})();
