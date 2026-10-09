const $=id=>document.getElementById(id);
const state={records:[],csrf:null,register:false,user:null,metric:'weight',limit:20,editing:null,busy:false,pending:null};
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
let chartMotionKey='',toastTimer;
function animateElement(el,frames,options={}){
 if(!el||motionPreference.matches||!el.animate)return;
 el.getAnimations().forEach(a=>a.cancel());
 return el.animate(frames,{duration:380,easing:'cubic-bezier(.2,.75,.25,1)',...options});
}
function setBusy(id,busy,label){const b=$(id);b.disabled=busy;b.setAttribute('aria-busy',String(busy));if(busy){b.dataset.idleLabel=b.textContent;b.textContent=label;}else if(b.dataset.idleLabel){b.textContent=b.dataset.idleLabel;delete b.dataset.idleLabel;}}
function savedFeedback(ids=[],message='已保存'){
 $('save-toast-label').textContent=message;
 $('save-toast').hidden=false;
 clearTimeout(toastTimer);
 animateElement($('save-toast'),[{opacity:0,transform:'translate(-50%,12px) scale(.96)'},{opacity:1,transform:'translate(-50%,0) scale(1)'}]);
 animateElement($('save-check'),[{strokeDashoffset:1},{strokeDashoffset:0}],{duration:420});
 toastTimer=setTimeout(()=>{$('save-toast').hidden=true;},2600);
 for(const row of $('records-body').rows){if(ids.includes(row.dataset.recordId))for(const cell of row.cells)animateElement(cell,[{backgroundColor:'#dce8ff'},{backgroundColor:getComputedStyle(cell).backgroundColor}],{duration:1500});}
}
motionPreference.addEventListener('change',()=>{if(motionPreference.matches)document.getAnimations().forEach(a=>a.cancel());});
document.addEventListener('click',e=>{const button=e.target.closest('button');if(button&&!button.disabled)animateElement(button,[{transform:'scale(.97)'},{transform:'scale(1)'}],{duration:220});});
const num=n=>n===null||n===undefined?'—':Number(n).toFixed(1);
const delta=n=>Math.abs(n)<.0001?'持平':`${n<0?'下降':'增加'} ${Math.abs(n).toFixed(1)}`;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function localNow(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;}
async function api(url,options={}){const res=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(state.csrf?{'X-CSRF-Token':state.csrf}:{}),...options.headers}});const data=await res.json();if(!res.ok){if(res.status===401&&url!=='/api/login'){showAuth(false);}throw new Error(data.error||'请求失败，请重试。');}return data;}
function showAuth(register=false){state.register=register;state.records=[];state.csrf=null;state.user=null;state.pending=null;state.editing=null;state.limit=20;chartMotionKey='';clearTimeout(toastTimer);$('save-toast').hidden=true;$('natural-input').value='';$('records-body').innerHTML='';if($('record-dialog').open)$('record-dialog').close();$('loading').hidden=true;$('app').hidden=true;$('auth-screen').hidden=false;$('auth-description').textContent=register?'注册账号，开启独立的记录空间':'登录你的私人记录空间';$('auth-submit').textContent=register?'注册并登录':'登录';$('auth-toggle').textContent=register?'已有账号？登录':'没有账号？注册';$('password').autocomplete=register?'new-password':'current-password';$('password').value='';$('auth-error').textContent='';}
async function boot(){try{const s=await api('/api/session');if(!s.authenticated)return showAuth();state.csrf=s.csrf;state.user=s.user;await load();}catch(e){$('loading').textContent=e.message;}}
async function load(){const entering=$('app').hidden;const data=await api('/api/records');state.records=data.records;$('account-label').textContent=state.user?.username||'私人记录空间';$('auth-screen').hidden=true;$('loading').hidden=true;$('app').hidden=false;render();if(entering)animateElement($('overview'),[{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:460});}
$('auth-toggle').addEventListener('click',()=>showAuth(!state.register));
$('auth-form').addEventListener('submit',async e=>{e.preventDefault();$('auth-error').textContent='';setBusy('auth-submit',true,state.register?'正在注册…':'正在登录…');$('auth-toggle').disabled=true;try{const r=await api(state.register?'/api/register':'/api/login',{method:'POST',body:JSON.stringify({username:$('username').value,password:$('password').value})});state.csrf=r.csrf;state.user=r.user;$('password').value='';await load();}catch(e){$('auth-error').textContent=e.message;}finally{setBusy('auth-submit',false);$('auth-toggle').disabled=false;}});
$('logout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});state.records=[];state.csrf=null;showAuth(false);}catch(e){alert(e.message);}});
function render(){
 $('today-label').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'long'}).format(new Date());
 for(const metric of ['weight','waist']){const list=state.records.filter(x=>x[metric]!==null),first=list[0],last=list.at(-1);const value=$(`latest-${metric}`),next=num(last?.[metric]),changed=value.textContent!==next;value.textContent=next;if(changed)animateElement(value,[{opacity:.4,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:440});$(`${metric}-time`).textContent=last?last.measuredAt.slice(5,10)+' '+last.measuredAt.slice(11,16):'尚未记录';$(`${metric}-change`).textContent=last?`${delta(last[metric]-first[metric])}${Math.abs(last[metric]-first[metric])<.0001?'':metric==='weight'?' kg':' cm'}`:metric==='weight'?'还没有体重记录':'记录你的第一次腰围';if(metric==='waist')$('waist-hint').textContent=last?'与第一次测量相比':'试试输入「腰围 84 厘米」';spark(metric,list);}
 renderChart();renderTable();
}
function spark(metric,list){if(list.length<2){$(`${metric}-spark`).innerHTML='';return;}const tail=list.slice(-15),values=tail.map(x=>x[metric]),min=Math.min(...values),span=Math.max(.2,Math.max(...values)-min);const pts=values.map((v,i)=>`${i/(values.length-1)*200},${32-(v-min)/span*27}`).join(' ');$(`${metric}-spark`).innerHTML=`<svg viewBox="0 0 200 38" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${metric==='weight'?'#7da1ee':'#b7a07d'}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;}
function renderChart(){
 const metric=state.metric,unit=metric==='weight'?'kg':'cm',range=$('range').value;
 const motionKey=JSON.stringify([metric,range,state.records.map(r=>[r.id,r.updatedAt])]);
 const draw=motionKey!==chartMotionKey;chartMotionKey=motionKey;
 const cutoff=range==='all'?-Infinity:Date.now()-Number(range)*86400000;
 const list=state.records.filter(r=>r[metric]!==null&&Date.parse(r.measuredAt)>=cutoff);
 $('chart-legend').textContent=metric==='weight'?'体重（kg）':'腰围（cm）';$('chart-total').textContent=`${list.length} 次测量`;
 $('chart-subtitle').textContent=metric==='weight'?'保留每次测量，也保留每天的小起伏。':'同样的测量位置，让变化更容易比较。';
 if(!list.length){$('chart').innerHTML=`<div class="chart-empty"><strong>${metric==='waist'?'从第一次腰围开始':'这里还没有测量记录'}</strong><span>${metric==='waist'?'输入「腰围 84 厘米」，你的趋势就会出现在这里。':'记录一次测量，或选择更大的时间范围。'}</span></div>`;return;}
 const width=Math.max(360,$('chart').clientWidth),height=266,left=43,right=18,top=18,bottom=40;
 const vals=list.map(x=>x[metric]),rawMin=Math.min(...vals),rawMax=Math.max(...vals),padding=Math.max(.2,(rawMax-rawMin)*.2);
 const min=Math.floor((rawMin-padding)*5)/5,max=Math.ceil((rawMax+padding)*5)/5;
 const first=Date.parse(list[0].measuredAt),last=Date.parse(list.at(-1).measuredAt),x=t=>left+(last===first?.5:(t-first)/(last-first))*(width-left-right),y=v=>top+(max-v)/(max-min)*(height-top-bottom);
 let grid='',labels='';for(let i=0;i<=4;i++){const v=min+(max-min)*i/4,py=y(v);grid+=`<line class="grid" x1="${left}" y1="${py}" x2="${width-right}" y2="${py}"/><text x="${left-10}" y="${py+4}" text-anchor="end">${v.toFixed(1)}</text>`;}
 const ticks=last===first?1:(width<500?3:5);for(let i=0;i<ticks;i++){const t=first+(last-first)*(ticks===1?0:i/(ticks-1)),local=new Date(t+8*3600000).toISOString(),label=(last-first)<86400000?local.slice(11,16):local.slice(5,10);labels+=`<text x="${x(t)}" y="${height-12}" text-anchor="middle">${label}</text>`;}
 const points=list.map(r=>`${x(Date.parse(r.measuredAt))},${y(r[metric])}`).join(' ');
 const area=`${x(first)},${height-bottom} ${points} ${x(last)},${height-bottom}`;
 $('chart').innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${metric==='weight'?'体重':'腰围'}趋势，${list.length}次测量，最新${num(vals.at(-1))}${unit}"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2458de" stop-opacity=".12"/><stop offset="100%" stop-color="#2458de" stop-opacity="0"/></linearGradient></defs>${grid}<polygon points="${area}" fill="url(#chart-fill)"/><polyline class="series" pathLength="1" points="${points}"/>${list.map(r=>`<circle class="point" cx="${x(Date.parse(r.measuredAt))}" cy="${y(r[metric])}" r="4"><title>${esc(r.measuredAt.slice(0,16).replace('T',' '))}：${num(r[metric])} ${unit}</title></circle>`).join('')}${labels}</svg>`;
 if(draw){animateElement($('chart').querySelector('.series'),[{strokeDasharray:'1',strokeDashoffset:'1'},{strokeDasharray:'1',strokeDashoffset:'0'}],{duration:720});animateElement($('chart').querySelector('polygon'),[{opacity:0},{opacity:1}],{duration:700});}
}
function renderTable(){let lastW=null,lastC=null;const rows=state.records.map(r=>{const dw=r.weight===null||lastW===null?null:r.weight-lastW,dc=r.waist===null||lastC===null?null:r.waist-lastC;if(r.weight!==null)lastW=r.weight;if(r.waist!==null)lastC=r.waist;return {...r,dw,dc};}).reverse();const cell=v=>v===null?'—':`${v>0?'+':''}${v.toFixed(1)}`;
 $('records-body').innerHTML=rows.slice(0,state.limit).map(r=>`<tr data-record-id="${r.id}"><td><span class="record-day">${r.measuredAt.slice(5,10).replace('-','月')}日</span><span class="record-clock">${r.measuredAt.slice(11,16)}</span></td><td>${num(r.weight)}</td><td class="${r.dw<0?'delta-down':r.dw>0?'delta-up':''}">${cell(r.dw)}</td><td>${num(r.waist)}</td><td class="${r.dc<0?'delta-down':r.dc>0?'delta-up':''}">${cell(r.dc)}</td><td class="record-source" title="${esc(r.source)}">${esc(r.source)}</td><td><button class="edit-button" data-edit="${r.id}" aria-label="编辑 ${r.measuredAt.slice(0,16)} 的记录">编辑</button></td></tr>`).join('');
 $('record-count').textContent=`${rows.length} 次`;$('empty-table').hidden=rows.length>0;$('show-more').hidden=rows.length<=state.limit;
 $('record-span').textContent=rows.length?`已记录 ${new Set(rows.map(r=>r.measuredAt.slice(0,10))).size} 天`:'';
}
document.querySelectorAll('[data-metric]').forEach(b=>b.addEventListener('click',()=>{state.metric=b.dataset.metric;document.querySelectorAll('[data-metric]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderChart();}));
$('range').addEventListener('change',renderChart);new ResizeObserver(()=>{if(!$('app').hidden)renderChart();}).observe($('chart'));
$('show-more').addEventListener('click',()=>{state.limit+=30;renderTable();});
document.querySelectorAll('[data-example]').forEach(b=>b.addEventListener('click',()=>{$('natural-input').value=b.dataset.example;$('natural-input').focus();}));
$('natural-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();$('record-form').requestSubmit();}});
$('record-form').addEventListener('submit',async e=>{e.preventDefault();if(state.busy)return;const text=$('natural-input').value.trim();if(!text)return;state.busy=true;setBusy('record-submit',true,'记录中…');const requestId=state.pending?.text===text?state.pending.id:crypto.randomUUID();state.pending={text,id:requestId};try{const result=await api('/api/records',{method:'POST',body:JSON.stringify({text,requestId})});const message=result.records.map(r=>`${r.measuredAt.slice(5,10)} ${r.measuredAt.slice(11,16)}${r.weight!==null?' · '+num(r.weight)+' kg':''}${r.waist!==null?' · 腰围 '+num(r.waist)+' cm':''}`).join('；');state.pending=null;$('natural-input').value='';$('record-feedback').className='feedback';$('record-feedback').textContent=`已记录：${message}`;await load();savedFeedback(result.records.map(r=>r.id),`已记录 ${result.records.length} 次测量`);}catch(e){$('record-feedback').className='feedback error';$('record-feedback').textContent=e.message;}finally{state.busy=false;setBusy('record-submit',false);}});
function openManual(r=null){state.editing=r;$('dialog-title').textContent=r?'编辑这次测量':'手动记录';$('manual-time').value=r?r.measuredAt.slice(0,16):localNow();$('manual-weight').value=r?.weight??'';$('manual-waist').value=r?.waist??'';$('manual-error').textContent='';$('manual-submit').textContent=r?'保存更正':'保存记录';$('record-dialog').showModal();}
$('manual-open').addEventListener('click',()=>openManual());$('dialog-close').addEventListener('click',()=>$('record-dialog').close());
$('records-body').addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(b)openManual(state.records.find(r=>r.id===b.dataset.edit));});
$('manual-form').addEventListener('submit',async e=>{e.preventDefault();setBusy('manual-submit',true,'保存中…');try{let savedIds=[];const wasEditing=!!state.editing;const payload={measuredAt:$('manual-time').value+':00+08:00',weight:$('manual-weight').value===''?null:Number($('manual-weight').value),waist:$('manual-waist').value===''?null:Number($('manual-waist').value)};if(state.editing){savedIds=[state.editing.id];payload.updatedAt=state.editing.updatedAt;await api('/api/records/'+state.editing.id,{method:'PATCH',body:JSON.stringify(payload)});}else{payload.requestId=crypto.randomUUID();const created=await api('/api/records',{method:'POST',body:JSON.stringify(payload)});savedIds=created.records.map(r=>r.id);}$('record-dialog').close();await load();savedFeedback(savedIds,wasEditing?'更正已保存':'测量已记录');}catch(e){$('manual-error').textContent=e.message;}finally{setBusy('manual-submit',false);}});
if(document.modelContext?.registerTool){
 const lifecycle=new AbortController();
 addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
 const tools=[
  {name:'list_measurements',title:'读取测量记录',description:'登录后读取全部体重和腰围测量。包含用户个人健康数据，仅在用户明确要求时使用。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},async execute(){const r=await api('/api/records');return {timezone:'Asia/Shanghai',weightUnit:'kg',waistUnit:'cm',records:r.records};}},
  {name:'record_measurements',title:'新增测量记录',description:'将用户明确报告的体重或腰围追加保存，绝不覆盖。同一请求重试时复用 requestId。',inputSchema:{type:'object',properties:{text:{type:'string',maxLength:3000},requestId:{type:'string',minLength:16,maxLength:80}},required:['text','requestId'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},async execute(input){if(typeof input?.text!=='string'||typeof input?.requestId!=='string')throw new Error('需要 text 和 requestId。');const r=await api('/api/records',{method:'POST',body:JSON.stringify(input)});await load();$('record-feedback').className='feedback';$('record-feedback').textContent=`已新增 ${r.records.length} 次测量。`;savedFeedback(r.records.map(x=>x.id),`已记录 ${r.records.length} 次测量`);return r;}}
 ];
 for(const tool of tools){try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
}
boot();
