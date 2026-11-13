import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,appendFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Vault} from './vault.mjs';
import {boundedJson,models,catalogMeasurement,clearCatalog,localModels,localOrigin,inferChatGPT,inferLocal} from './provider.mjs';

const index=process.argv.indexOf('--config');
if(index<0)throw new Error('Supply --config with a protected local configuration file.');
const config=JSON.parse(await readFile(resolve(process.argv[index+1]),'utf8'));
const native=new URL(config.irisUrl);
if(native.protocol!=='http:'||native.hostname!=='127.0.0.1'||!native.port||native.pathname!=='/kotr-seats'||native.username||native.password||native.search||native.hash)throw new Error('Expected a fixed local native seat endpoint.');
const deadline=Date.parse(config.deadlineUtc);
if(!Number.isFinite(deadline)||deadline<=Date.now())throw new Error('An active local runtime deadline is required.');
if(config.localProvider)config.localProvider=localOrigin(config.localProvider);
const state=resolve(config.state);await mkdir(state,{recursive:true,mode:0o700});
const vault=new Vault(join(state,'accounts'));await vault.init();
const workerCredentials=JSON.parse(await readFile(config.workerCredentials,'utf8'));
const basic=c=>'Basic '+Buffer.from(c.username+':'+c.password).toString('base64');
const workerAuth=basic(workerCredentials);workerCredentials.password='';
const sessions=new Map(),active=new Map(),cooldowns=new Map();let ticking=false,closing=false;
let bootstrap=config.bootstrapCredentials?randomBytes(32).toString('base64url'):null;
const token=()=>randomBytes(32).toString('base64url');
const journal=data=>appendFile(join(state,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),...data})+'\n');
function discardSession(session) {
  session.active=false;
  session.auth='';
  session.allowedJobs.clear();
  session.resumeQueued=false;
  sessions.delete(session.id);
}
function expireSessions() {
  for(const session of sessions.values()){
    if(!session.active||session.expires<=Date.now())discardSession(session);
  }
}
async function nativeCall(auth,op,args={}) {
  const response=await fetch(config.irisUrl+'/v1/'+(op==='identity'?'identity':'rpc'),{
    method:op==='identity'?'GET':'POST',headers:{Authorization:auth,'Content-Type':'application/json'},
    body:op==='identity'?undefined:JSON.stringify({op,args}),redirect:'error',signal:AbortSignal.timeout(50000)});
  if(!response.ok){
    const error=new Error('IRIS authentication or service unavailable.');
    error.nativeStatus=response.status;
    throw error;
  }
  return boundedJson(response,1048576);
}
async function sessionCall(session,op,args={}) {
  if(!session.active||session.expires<=Date.now()){
    discardSession(session);
    const error=new Error('IRIS session expired.');
    error.nativeStatus=401;
    throw error;
  }
  try {
    const result=await nativeCall(session.auth,op,args);
    if((op==='identity'||op==='state')&&result.status==='DENIED'){
      discardSession(session);
      const error=new Error('IRIS seat access denied.');
      error.nativeStatus=401;
      throw error;
    }
    return result;
  }
  catch(error){
    if(error.nativeStatus===401||error.nativeStatus===403)discardSession(session);
    throw error;
  }
}
async function login(credentials,res) {
  if(typeof credentials.username!=='string'||typeof credentials.password!=='string'||credentials.username.length>128||credentials.password.length>256)throw new Error('Invalid credentials.');
  const auth=basic(credentials),identity=await nativeCall(auth,'identity');
  if(identity.status!=='OK'||typeof identity.principal!=='string')throw new Error('IRIS seat access denied.');
  expireSessions();
  if(sessions.size>=16)throw new Error('Local session limit reached.');
  const id=token(),session={id,owner:identity.principal,canPropose:!!identity.canPropose,auth,active:true,allowedJobs:new Set(),resumeQueued:false,expires:Date.now()+3600000};
  sessions.set(id,session);res.setHeader('Set-Cookie',`kotr_seats=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
  return {principal:session.owner,canPropose:session.canPropose};
}
const publicOps=new Set(['connection','seat','read','readAudit','enqueue','cancel']);
async function checkConnection(session,args) {
  const values=args.provider==='chatgpt'?await models(vault.get(session.owner,args.id),args.id):config.localProvider?await localModels(config.localProvider):[];
  if(!values.some(m=>m.id===args.model))throw new Error('Choose an available model for this account.');
}
async function runJob(session,job) {
  const key=session.owner+'/'+job.id,lease=token();let claimed=false;
  const controller=new AbortController();active.set(key,{controller,connectionId:job.connectionId,owner:session.owner});
  try {
    let account;
    if(job.provider==='chatgpt'){
      account=vault.get(session.owner,job.connectionId);
      if(!account.status().planEnabled)throw new Error('ChatGPT plan consent is required.');
      if(!(await models(account,job.connectionId)).some(m=>m.id===job.model))throw new Error('Model unavailable.');
      await account.accessToken();
    } else if(!config.localProvider)throw new Error('Local provider is not configured.');
    let nonce=token();const allowed=await sessionCall(session,'authorize',{jobId:job.id,nonce});
    if(allowed.status!=='OK')return;
    const claim=await nativeCall(workerAuth,'claim',{owner:session.owner,jobId:job.id,nonce,lease});
    if(claim.status!=='OK')return;
    claimed=true;job=claim.job;
    await journal({event:'claimed',owner:session.owner,jobId:job.id,seatId:job.seatId,connectionId:job.connectionId,model:job.model});
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]);
    const result=job.provider==='chatgpt'?await inferChatGPT(account,job,signal):await inferLocal(config.localProvider,job,signal);
    if(!session.active||session.expires<Date.now()||signal.aborted)throw new Error('Session ended before finalization.');
    nonce=token();const recheck=await sessionCall(session,'authorize',{jobId:job.id,nonce});
    if(recheck.status!=='OK')throw new Error('Seat permission is no longer available.');
    const ruling=await sessionCall(session,'finish',{jobId:job.id,nonce,lease,...result});
    await journal({event:'validation-returned',owner:session.owner,jobId:job.id,status:ruling.status,responseId:result.responseId,usage:result.usage});
  } catch {
    if(!controller.signal.aborted&&session.active)cooldowns.set(session.owner+'/'+job.connectionId,Date.now()+30000);
    if(claimed)await nativeCall(workerAuth,'fail',{owner:session.owner,jobId:job.id,lease}).catch(()=>{});
    await journal({event:claimed?'failed-or-uncertain':'connection-unavailable',owner:session.owner,jobId:job.id});
  } finally {active.delete(key)}
}
async function tick() {
  if(ticking||closing)return;ticking=true;
  try {
    await nativeCall(workerAuth,'reconcile');
    const owners=new Map();
    for(const session of sessions.values())if(session.active&&session.expires>Date.now()&&(session.resumeQueued||session.allowedJobs.size))owners.set(session.owner,session);
    for(const session of owners.values()){
      if(active.size>=4)break;
      const view=await sessionCall(session,'state');if(view.status!=='OK')continue;
      for(const job of view.jobs.filter(j=>j.state==='QUEUED'&&(session.resumeQueued||session.allowedJobs.has(j.id)))){
        if(active.size>=4)break;
        if(active.has(session.owner+'/'+job.id)||(cooldowns.get(session.owner+'/'+job.connectionId)??0)>Date.now())continue;
        const connection=view.connections.find(c=>c.id===job.connectionId);
        const reserved=Math.max([...active.values()].filter(v=>v.owner===session.owner&&v.connectionId===job.connectionId).length,view.jobs.filter(j=>j.state==='RUNNING'&&j.connectionId===job.connectionId).length);
        if(!connection||reserved>=connection.parallel)continue;
        void runJob(session,job);
      }
    }
  } catch {} finally {ticking=false}
}
const files=new Map([['/',['index.html','text/html']],['/ui.js',['ui.js','text/javascript']],['/style.css',['style.css','text/css']]]);
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
async function input(req) {
  if(req.headers['content-type']!=='application/json')throw new Error('JSON required.');
  const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>16000)throw new Error('Request too large.');chunks.push(part)}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const server=createServer(async(req,res)=>{
  const address=server.address(),origin=`http://127.0.0.1:${address.port}`;
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if(req.headers.host!==`127.0.0.1:${address.port}`)return send(res,403,{error:'Local host required.'});
  let url;
  try {
  if(!req.url?.startsWith('/')||req.url.startsWith('//'))return send(res,400,{error:'Invalid local request target.'});
  url=new URL(req.url,origin);
  if(req.method==='POST'&&url.pathname==='/shutdown'&&!req.headers.origin&&config.shutdownToken&&req.headers['x-kotr-stop']===config.shutdownToken){send(res,200,{stopping:true});void close();return}
  if(req.method==='GET'&&files.has(url.pathname)){
    const [name,type]=files.get(url.pathname);res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});return res.end(await readFile(new URL('./web/'+name,import.meta.url)));
  }
  if(req.method==='POST'&&(req.headers.origin!==origin||req.headers['x-kotr-seats']!=='1'))return send(res,403,{error:'Use the local seat workspace.'});
    if(req.method==='POST'&&url.pathname==='/api/login')return send(res,200,await login(await input(req),res));
    if(req.method==='POST'&&url.pathname==='/api/bootstrap'){
      const data=await input(req);if(!bootstrap||data.token!==bootstrap)return send(res,403,{error:'Invalid bootstrap link.'});
      bootstrap=null;const credentials=JSON.parse(await readFile(config.bootstrapCredentials,'utf8'));
      return send(res,200,await login(credentials,res));
    }
    expireSessions();
    const id=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('kotr_seats='))?.slice(11);
    const session=sessions.get(id);
    if(!session?.active||session.expires<Date.now())return send(res,401,{error:'Sign in to the IRIS seat workspace.'});
    const identity=await sessionCall(session,'identity');
    if(identity.status!=='OK'||identity.principal!==session.owner){discardSession(session);res.setHeader('Set-Cookie','kotr_seats=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,401,{error:'IRIS workspace access is no longer available.'})}
    session.canPropose=!!identity.canPropose;
    if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,{...await sessionCall(session,'state'),accounts:vault.list(session.owner),canPropose:session.canPropose,schedulingEnabled:session.resumeQueued||session.allowedJobs.size>0,localProviderConfigured:!!config.localProvider});
    if(req.method==='GET'&&url.pathname==='/api/models'){
      const id=url.searchParams.get('id'),choices=id==='local'?(config.localProvider?await localModels(config.localProvider):[]):await models(vault.get(session.owner,id),id);
      return send(res,200,{models:choices,catalogMeasurement:id==='local'?null:catalogMeasurement(id)});
    }
    if(req.method!=='POST')return send(res,404,{error:'Unavailable.'});
    const data=await input(req);
    if(url.pathname==='/api/scheduling'){
      if(!session.canPropose)return send(res,403,{error:'Proposal permission required.'});
      for(const value of sessions.values())if(value.owner===session.owner){value.allowedJobs.clear();value.resumeQueued=false}
      session.resumeQueued=data.enabled===true;return send(res,200,{enabled:session.resumeQueued});
    }
    if(url.pathname==='/api/logout'){
      discardSession(session);
      for(const value of active.values())if(value.owner===session.owner)value.controller.abort();
      res.setHeader('Set-Cookie','kotr_seats=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{signedOut:true});
    }
    if(url.pathname==='/api/accounts/new')return send(res,200,await vault.add(session.owner,data.label));
    if(['/api/accounts/connect','/api/accounts/disconnect'].includes(url.pathname)){
      const account=vault.get(session.owner,data.id);
      if([...active.values()].some(v=>v.owner===session.owner&&v.connectionId===data.id))return send(res,409,{error:'Cancel or finish this account’s active jobs first.'});
      const result=url.pathname.endsWith('/connect')?await account.login():await account.disconnect();
      clearCatalog(data.id);cooldowns.delete(session.owner+'/'+data.id);return send(res,200,result);
    }
    if(url.pathname==='/api/rpc'){
      if(!publicOps.has(data.op))return send(res,403,{error:'Operation is not exposed to the browser.'});
      if(data.op==='connection'&&data.args.enabled)await checkConnection(session,data.args);
      const result=await sessionCall(session,data.op,data.args);
      if(data.op==='cancel')active.get(session.owner+'/'+data.args.jobId)?.controller.abort();
      if(data.op==='enqueue'&&result.status==='OK'){session.allowedJobs.add(result.job.id);void tick()}
      return send(res,200,result);
    }
    return send(res,404,{error:'Unavailable.'});
  } catch(error) {
    if(error.nativeStatus===401||error.nativeStatus===403){res.setHeader('Set-Cookie','kotr_seats=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,401,{error:'Sign in to the IRIS seat workspace.'})}
    if(url?.pathname==='/api/models')await journal({event:'catalog-error',name:error.name,causeCode:error.cause?.code??null,frames:String(error.stack??'').split('\n').slice(1,5)});
    return send(res,400,{error:/^CHATGPT_CATALOG_(HTTP_\d{3}|SHAPE)$/.test(error.message)?error.message:'The operation did not complete. Check the connection, permissions and selected model.'});
  }
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port??0,'127.0.0.1',resolve)});
const port=server.address().port;
await readFile(new URL('./web/index.html',import.meta.url));
await appendFile(join(state,'server.jsonl'),JSON.stringify({pid:process.pid,port,started:new Date().toISOString()})+'\n');
if(bootstrap)await (await import('node:fs/promises')).writeFile(join(state,'bootstrap-link.txt'),`http://127.0.0.1:${port}/#${bootstrap}`,{mode:0o600});
console.log(`KotR seat workspace listening on 127.0.0.1:${port}.`);
const timer=setInterval(()=>{expireSessions();if(Date.now()>=deadline)void close();else void tick()},1000);
async function close(){
  if(closing)return;closing=true;clearInterval(timer);
  for(const s of sessions.values()){s.active=false;s.auth=''}
  for(const v of active.values())v.controller.abort();
  for(const account of vault.profiles.values()){account.cancelPending?.();account.loginAbort?.abort()}
  const closed=new Promise(resolve=>server.close(resolve));server.closeIdleConnections();
  while(active.size)await new Promise(r=>setTimeout(r,100));
  await closed;await vault.close();
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void close());
