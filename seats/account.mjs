// Adapted from ISAIAH (Apache-2.0); see NOTICE. Each instance owns one saved registration.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const issuer='https://auth.openai.com';
const resource='https://api.openai.com/v1';
const tokenEndpoint=issuer+'/api/accounts/oauth/token';
const jwks=createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json'));
const random=()=>randomBytes(32).toString('base64url');

export async function verifyIdentity(token,client,nonce,subject,resolver=jwks) {
  const {payload}=await jwtVerify(token,resolver,{issuer,audience:client,requiredClaims:['sub','exp','iat'],clockTolerance:5});
  if(payload.nonce!==nonce || typeof payload.sub!=='string' || !payload.sub || (subject&&subject!==payload.sub))throw new Error('Account identity validation failed.');
  return payload;
}

// DPAPI protects the credential record for the current Windows user; no token is put in argv.
async function protect(value, decrypt=false) {
  if (process.platform !== 'win32') throw new Error('The isolated account store currently requires Windows DPAPI.');
  const command=`Add-Type -AssemblyName System.Security; $d=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[System.Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($d,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve,reject)=>{
    const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let out='',err='';p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>err+=c);p.on('error',reject);
    p.on('close',code=>code?reject(new Error('Windows credential protection failed.')):resolve(Buffer.from(out,'base64')));
    p.stdin.end(value.toString('base64'));
  });
}

async function postToken(body, request=fetch, signal) {
  const res=await request(tokenEndpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  if (!res.ok) throw new Error('ChatGPT authorization or renewal failed; reconnect the account.');
  const result=await res.json();
  if (body.grant_type==='refresh_token' && (typeof result.access_token!=='string' || typeof result.refresh_token!=='string' || !Number.isFinite(result.expires_in))) throw new Error('Incomplete renewed credentials.');
  if (body.grant_type==='authorization_code' && typeof result.id_token!=='string') throw new Error('Missing verified sign-in identity.');
  return result;
}

export class ChatGPTAccount {
  constructor(directory, host) { this.sharedHost=host; this.directory=directory; this.path=join(directory,'account.dpapi'); this.hostPath=join(directory,'host-id'); this.lockPath=join(directory,'account.lock'); this.current=null; this.refreshing=null; }
  async init() {
    await mkdir(this.directory,{recursive:true,mode:0o700});
    try {const f=await open(this.lockPath,'wx',0o600);await f.writeFile(String(process.pid));await f.close();this.locked=true}
    catch(e) {
      if(e.code!=='EEXIST')throw e;
      throw new Error('Another KnAIghts of the Round ChatGPT account process is active, or its lock needs operator review.');
    }
    try {
    try {this.host=(await readFile(this.hostPath,'utf8')).trim()} catch(e) {if(e.code!=='ENOENT')throw e;this.host=this.sharedHost??('urn:uuid:'+randomUUID());await writeFile(this.hostPath,this.host,{mode:0o600,flag:'wx'})}
    if(!/^urn:uuid:[a-f0-9-]{36}$/.test(this.host))throw new Error('Invalid account host identity.');
    if(this.sharedHost && this.host!==this.sharedHost)throw new Error('Saved registration belongs to a different host.');
    try {this.current=JSON.parse((await protect(await readFile(this.path),true)).toString('utf8'))} catch(e) {if(e.code!=='ENOENT')throw e}
    return this.status();
    } catch(e) {await this.close();throw e}
  }
  async close() {
    this.cancelPending?.();this.loginAbort?.abort();
    const until=Date.now()+20000;
    while((this.pending||this.refreshing)&&Date.now()<until)await new Promise(r=>setTimeout(r,20));
    if(this.pending||this.refreshing)throw new Error('Account operation has not stopped; retain its lock.');
    if(this.locked){this.locked=false;await unlink(this.lockPath)}
  }
  status() {return {connected:!!this.current?.subject && !!(this.current?.accessToken||this.current?.idToken),planEnabled:!!this.current?.accessToken && !!this.current?.scopes?.includes('chatgpt.tokens.use.direct'),email:this.current?.email ?? null};}
  async save() {
    const encrypted=await protect(Buffer.from(JSON.stringify(this.current)));
    const temporary=this.path+'.'+random()+'.tmp';await writeFile(temporary,encrypted,{mode:0o600,flag:'wx'});await rename(temporary,this.path);
  }
  async login(openBrowser = url => { const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore',windowsHide:true});child.unref(); }) {
    if(this.pending || this.refreshing)throw new Error('An account operation is already in progress.');
    const state=random(),nonce=random(),verifier=random(),challenge=createHash('sha256').update(verifier).digest('base64url');
    const server=createServer();
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
    const redirect=`http://127.0.0.1:${server.address().port}/auth/callback`;
    const url=new URL(issuer+'/api/accounts/authorize');
    const existing=this.current;
    const args={client_id:existing?.clientId??'dynamic_agent_client',ext_agent_host_id:this.host,response_type:'code',redirect_uri:redirect,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',resource,state,nonce,code_challenge_method:'S256',code_challenge:challenge};
    if(!existing?.clientId)args.agent_name_hint='KnAIghts of the Round';
    if(existing?.idToken)args.id_token_hint=existing.idToken;
    for(const [k,v] of Object.entries(args))url.searchParams.set(k,v);
    this.pending=true;
    this.loginAbort=new AbortController();
    try {
      const callback=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Sign-in timed out.')),180000);timer.unref();
        this.cancelPending=()=>{clearTimeout(timer);reject(new Error('Sign-in cancelled.'))};
        server.on('request',(req,res)=>{
          const u=new URL(req.url,'http://127.0.0.1');
          if(req.method!=='GET'||u.pathname!=='/auth/callback'){res.writeHead(404).end();return}
          if(u.searchParams.get('state')!==state){res.writeHead(400).end('Invalid sign-in response.');return}
          clearTimeout(timer);res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).end('You may close this tab and return to KnAIghts of the Round.');
          const error=u.searchParams.get('error'),code=u.searchParams.get('code'),client=u.searchParams.get('client_id')??existing?.clientId;
          if(error||!code||!client||(existing&&client!==existing.clientId))return reject(new Error('ChatGPT sign-in was declined or incomplete.'));
          resolve({code,client});
        });
      });
      openBrowser(url.toString());
      const {code,client}=await callback;
      if(client==='dynamic_agent_client')throw new Error('An issued registration ID is required.');
      if(!existing?.clientId){this.current={clientId:client,scopes:[]};await this.save()}
      const tokens=await postToken({grant_type:'authorization_code',client_id:client,code,code_verifier:verifier,redirect_uri:redirect,resource},fetch,this.loginAbort.signal);
      if(typeof tokens.id_token!=='string')throw new Error('Missing identity token.');
      const payload=await verifyIdentity(tokens.id_token,client,nonce,existing?.subject);
      if(this.loginAbort.signal.aborted)throw new Error('Sign-in cancelled.');
      const scopes=(tokens.scope??'').split(/\s+/).filter(Boolean);
      this.current={clientId:client,subject:payload.sub,email:typeof payload.email==='string'?payload.email:null,idToken:tokens.id_token,accessToken:tokens.access_token??null,refreshToken:tokens.refresh_token??null,scopes,expiresAt:Number.isFinite(tokens.expires_in)?Date.now()+tokens.expires_in*1000:payload.exp*1000};
      await this.save();return this.status();
    } finally {this.pending=false;this.cancelPending=null;this.loginAbort=null;server.close()}
  }
  async accessToken() {
    if(this.pending)throw new Error('Wait for the account operation to finish.');
    if(!this.current?.scopes?.includes('chatgpt.tokens.use.direct'))throw new Error('ChatGPT plan usage is not enabled.');
    if(this.current.expiresAt>Date.now()+60000)return this.current.accessToken;
    this.refreshing ??= (async()=>{
      const t=await postToken({grant_type:'refresh_token',client_id:this.current.clientId,refresh_token:this.current.refreshToken,resource});
      const scopes=t.scope ? t.scope.split(/\s+/).filter(Boolean) : this.current.scopes;
      if(!scopes.includes('chatgpt.tokens.use.direct'))throw new Error('ChatGPT plan permission is no longer available.');
      this.current={...this.current,accessToken:t.access_token,refreshToken:t.refresh_token,scopes,expiresAt:Date.now()+t.expires_in*1000};await this.save();return t.access_token;
    })().finally(()=>{this.refreshing=null});
    return this.refreshing;
  }
  async disconnect() {
    if(this.pending || this.refreshing)throw new Error('An account operation is already in progress.');
    this.pending=true;
    try {return await this.disconnectSaved()} finally {this.pending=false}
  }
  async disconnectSaved() {
    if(!this.current)return {revoked:true};
    let revoked=false;
    try {
      const d=await fetch(issuer+'/.well-known/openid-configuration',{redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!d.ok)throw new Error('Discovery unavailable.');
      const metadata=await d.json(),url=new URL(metadata.revocation_endpoint);
      if(url.protocol!=='https:'||url.hostname!=='auth.openai.com'||url.username||url.password)throw new Error('Invalid revocation endpoint.');
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:this.current.refreshToken,token_type_hint:'refresh_token',client_id:this.current.clientId}),redirect:'error',signal:AbortSignal.timeout(10000)});
      revoked=r.status===200;
    } catch {}
    this.current={clientId:this.current.clientId,subject:this.current.subject,email:this.current.email,scopes:[]};await this.save();
    return {revoked};
  }
}
