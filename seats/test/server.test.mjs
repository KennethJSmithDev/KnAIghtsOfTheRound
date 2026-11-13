import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

const parent=process.env.KOTR_TEST_STATE;
if(!parent)throw new Error('Set KOTR_TEST_STATE to a private test directory outside source.');

test('session expiry, authentication failures and request errors preserve the local workspace', {timeout:25000}, async()=>{
  await mkdir(parent,{recursive:true});
  const directory=await mkdtemp(join(parent,'server-'));
  let upstreamStatus=200,denyState=false,denyOperation=false,stateDenials=0;
  const native=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const op=body?JSON.parse(body).op:'identity';
    const denied=op==='state'?denyState:denyOperation;
    if(op==='state'&&denied)stateDenials++;
    res.writeHead(upstreamStatus,{'Content-Type':'application/json'});
    res.end(JSON.stringify(req.url.endsWith('/identity')?
      {status:'OK',principal:'synthetic-user',canPropose:true}:
      denied?{status:'DENIED'}:{status:'OK',connections:[],seats:[],jobs:[]}));
  });
  await new Promise(resolve=>native.listen(0,'127.0.0.1',resolve));
  const clock=join(directory,'clock.txt'),preload=join(directory,'clock.mjs');
  await writeFile(clock,'0');
  await writeFile(preload,"import {readFileSync} from 'node:fs'; const now=Date.now; Date.now=()=>now()+Number(readFileSync(process.env.KOTR_CLOCK_FILE,'utf8'));");
  const credentials=join(directory,'worker.json'),config=join(directory,'config.json');
  await writeFile(credentials,JSON.stringify({username:'synthetic-worker',password:'synthetic-only'}));
  await writeFile(config,JSON.stringify({irisUrl:`http://127.0.0.1:${native.address().port}/kotr-seats`,
    deadlineUtc:new Date(Date.now()+7200000).toISOString(),state:join(directory,'state'),
    workerCredentials:credentials,shutdownToken:'synthetic-stop'}));
  const child=spawn(process.execPath,['--import',pathToFileURL(preload).href,fileURLToPath(new URL('../server.mjs',import.meta.url)),'--config',config],
    {env:{...process.env,KOTR_CLOCK_FILE:clock},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='';
  const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Seat workspace did not start.')),8000);
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Seat workspace exited ${code}.`))});
    child.stdout.on('data',data=>{output+=data;const match=output.match(/listening on 127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]))}});
    child.stderr.on('data',()=>{});
  }).catch(async error=>{child.kill();await new Promise(resolve=>native.close(resolve));throw error});
  const origin=`http://127.0.0.1:${port}`;
  const send=(method,path,cookie,body)=>fetch(origin+path,{method,headers:{Origin:origin,'X-KotR-Seats':'1',
    'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const login=()=>send('POST','/api/login',null,{username:'synthetic-user',password:'synthetic-only'});
  const cookie=response=>response.headers.get('set-cookie').split(';')[0];
  try {
    for(let i=0;i<16;i++)assert.equal((await login()).status,200);
    assert.equal((await login()).status,400);
    await writeFile(clock,'3600001');
    const renewed=await login();assert.equal(renewed.status,200);
    const first=cookie(renewed);
    assert.equal((await send('GET','/api/state',first)).status,200);
    upstreamStatus=503;
    assert.equal((await send('GET','/api/state',first)).status,400);
    upstreamStatus=200;
    assert.equal((await send('GET','/api/state',first)).status,200);
    for(const status of [401,403]){
      const session=cookie(await login());upstreamStatus=status;
      assert.equal((await send('GET','/api/state',session)).status,401);
      upstreamStatus=200;
      assert.equal((await send('GET','/api/state',session)).status,401);
    }
    const malformed=await new Promise((resolve,reject)=>{
      const req=request({host:'127.0.0.1',port,path:'//[',method:'GET'},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});
      req.on('error',reject);req.end();
    });
    assert.equal(malformed,400);
    assert.equal((await send('GET','/api/state',first)).status,200);
    denyOperation=true;
    assert.equal((await send('POST','/api/rpc',first,{op:'readAudit',args:{}})).status,200);
    denyOperation=false;
    assert.equal((await send('GET','/api/state',first)).status,200);
    const scheduled=cookie(await login());
    assert.equal((await send('POST','/api/scheduling',scheduled,{enabled:true})).status,200);
    denyState=true;
    for(let i=0;i<100&&!stateDenials;i++)await delay(25);
    assert(stateDenials>0);
    denyState=false;
    assert.equal((await send('GET','/api/state',scheduled)).status,401);
  } finally {
    await fetch(origin+'/shutdown',{method:'POST',headers:{'x-kotr-stop':'synthetic-stop'}}).catch(()=>{});
    if(child.exitCode===null){const done=once(child,'exit');const timer=setTimeout(()=>child.kill(),3000);await done;clearTimeout(timer)}
    await new Promise(resolve=>native.close(resolve));
  }
});
