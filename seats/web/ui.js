let state=null,busy=false;
const $=id=>document.getElementById(id);
const notice=value=>$('message').textContent=value;
const option=(id,label)=>{const node=document.createElement('option');node.value=id;node.textContent=label;return node};
const button=(text,callback)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.addEventListener('click',()=>action(callback));return node};
async function request(path,data){const response=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:data===undefined?{}:{'Content-Type':'application/json','X-KotR-Seats':'1'},body:data===undefined?undefined:JSON.stringify(data)});const value=await response.json();if(!response.ok||value.error||(value.status&&value.status!=='OK'))throw new Error(value.error??value.status);return value}
const rpc=(op,args)=>request('rpc',{op,args});
async function action(fn){if(busy)return;busy=true;notice('Working…');try{await fn();await refresh();notice('Records updated.')}catch(e){notice(e.message)}finally{busy=false}}
function select(id,values){const element=$(id),chosen=element.value;element.replaceChildren(...values.map(v=>option(v.id,v.label)));if(values.some(v=>v.id===chosen))element.value=chosen}
function card(title,lines){const node=document.createElement('article');node.className='card';const heading=document.createElement('strong');heading.textContent=title;node.append(heading);for(const line of lines){const p=document.createElement('p');p.textContent=line;node.append(p)}return node}
const permissionName=value=>({ReadEvidence:'Read evidence',ProposeDecision:'Propose a disposition',ReadAudit:'Read seat receipts'}[value]??value);
const caseName=value=>({'synthetic-a':'Matching synthetic evidence','synthetic-b':'Conflicting synthetic evidence'}[value]??value);
const stateName=value=>({QUEUED:'Waiting in queue',RUNNING:'Review in progress',COMPLETED:'Review completed',CANCELLED:'Cancelled · result withheld',STALE_OR_REVOKED:'Settings or permissions changed · result withheld',FAILED_OR_UNCERTAIN:'Outcome unavailable · reconcile before another attempt'}[value]??value);
async function modelChoices(){const id=$('account-picker').value;$('model-picker').replaceChildren();if(!id)return;try{const value=await request('models?id='+encodeURIComponent(id));select('model-picker',value.models)}catch(e){notice(e.message)}}
async function refresh(){
  state=await request('state');$('identity').textContent='IRIS identity · '+state.principal;$('login-panel').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;
  $('propose').disabled=!state.canPropose;if(!state.canPropose)$('propose').checked=false;
  const accounts=$('accounts');accounts.replaceChildren();
  for(const account of state.accounts){const node=card(account.label,[account.connected?(account.email??'Verified ChatGPT account'):'Not signed in',account.planEnabled?'ChatGPT plan usage enabled':account.connected?'Signed in · plan usage not enabled':'Continue with ChatGPT to grant access.']);
    node.append(button(account.connected?'Reconnect ChatGPT':'Continue with ChatGPT',async()=>{notice('Complete sign-in and consent in your system browser.');await request('accounts/connect',{id:account.id});await modelChoices()}));
    if(account.connected)node.append(button('Disconnect',()=>request('accounts/disconnect',{id:account.id})));accounts.append(node)}
  const choices=state.accounts.filter(a=>a.planEnabled).map(a=>({id:a.id,label:a.label}));if(state.localProviderConfigured)choices.push({id:'local',label:'Operator-configured local model'});
  const prior=$('account-picker').value;select('account-picker',choices);if(prior!==$('account-picker').value)await modelChoices();
  select('seat-connection',state.connections.filter(c=>c.enabled).map(c=>({id:c.id,label:c.label+' · '+c.model})));
  select('run-seat',state.seats.filter(s=>s.enabled&&s.permissions.includes('ProposeDecision')).map(s=>({id:s.id,label:s.label})));
  $('connections').replaceChildren(...state.connections.map(c=>{const usage=state.now-c.window>=3600?'A new hourly request window is available':`${c.used}/${c.budget} requests reserved in this hourly window`;const node=card(c.label,[c.model,`${usage} · concurrency ${c.parallel}`,c.enabled?'Enabled':'Disabled']);node.append(button(c.enabled?'Disable connection':'Enable connection',()=>rpc('connection',{...c,enabled:!c.enabled})));return node}));
  $('seats').replaceChildren(...state.seats.map(s=>{const node=card(s.label,[s.role,s.permissions.map(permissionName).join(' · '),s.cases.map(caseName).join(' · '),s.enabled?'Enabled':'Disabled']);node.append(button('Edit',()=>{const form=$('seat');for(const key of ['id','label','role','connectionId'])form.elements[key].value=s[key];for(const input of form.querySelectorAll('[name=case]'))input.checked=s.cases.includes(input.value);for(const input of form.querySelectorAll('[name=permission]'))input.checked=s.permissions.includes(input.value)}));node.append(button(s.enabled?'Disable knight':'Enable knight',()=>rpc('seat',{...s,enabled:!s.enabled})));return node}));
  $('jobs').replaceChildren(...[...state.jobs].reverse().map(job=>{const node=card(`${job.seatLabel} · job ${job.id}`,[caseName(job.caseId),stateName(job.state),job.result?`${job.result.status} · ${job.result.action||'No accepted action'}`:job.failure??'']);if(['QUEUED','RUNNING'].includes(job.state))node.append(button('Cancel',()=>rpc('cancel',{jobId:job.id})));if(job.result)node.append(button('Open receipt',()=>{$('receipt').textContent=JSON.stringify(job.result,null,2)}));return node}));
}
$('login').addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.target);action(async()=>{await request('login',Object.fromEntries(form));event.target.reset()})});
$('logout').addEventListener('click',()=>action(async()=>{await request('logout',{});location.reload()}));
$('new-account').addEventListener('submit',event=>{event.preventDefault();action(async()=>{await request('accounts/new',{label:new FormData(event.target).get('label')});event.target.reset()})});
$('account-picker').addEventListener('change',()=>action(modelChoices));
$('connection').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const data=Object.fromEntries(new FormData(event.target)),local=data.id==='local';const id=local?'local-default':data.id;await rpc('connection',{id,label:local?'Local model':state.accounts.find(a=>a.id===id).label,model:data.model,provider:local?'local':'chatgpt',parallel:Number(data.parallel),budget:Number(data.budget),enabled:true})})});
$('seat').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const data=new FormData(event.target);await rpc('seat',{id:data.get('id')||crypto.randomUUID(),label:data.get('label'),connectionId:data.get('connectionId'),role:data.get('role'),permissions:data.getAll('permission'),cases:data.getAll('case'),enabled:true});event.target.reset()})});
$('reset-seat').addEventListener('click',()=>$('seat').reset());
$('run').addEventListener('submit',event=>{event.preventDefault();action(()=>rpc('enqueue',{...Object.fromEntries(new FormData(event.target)),requestId:crypto.randomUUID()}))});
$('refresh').addEventListener('click',()=>action(async()=>{}));
$('resume').addEventListener('click',()=>action(()=>request('scheduling',{enabled:true})));
$('pause').addEventListener('click',()=>action(()=>request('scheduling',{enabled:false})));
const fragment=location.hash.slice(1);if(fragment)history.replaceState(null,'',location.pathname);
try{if(fragment)await request('bootstrap',{token:fragment});await refresh();if($('account-picker').value)await modelChoices()}catch{notice('Sign in to your IRIS seat workspace to continue.')}
// Poll only active work while visible; reading state never resubmits a job.
setInterval(()=>{if(!busy&&!document.hidden&&state?.jobs.some(j=>['QUEUED','RUNNING'].includes(j.state)))refresh().catch(e=>notice(e.message))},2500);
