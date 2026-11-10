import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Vault} from '../vault.mjs';
import {verifyIdentity,ChatGPTAccount} from '../account.mjs';
import {completedEvent} from '../provider.mjs';

const parent=process.env.KOTR_TEST_STATE;
if(!parent)throw new Error('Set KOTR_TEST_STATE to a private test directory outside source.');
await mkdir(parent,{recursive:true});
test('real JOSE signature, issuer, audience, nonce, subject and expiry checks',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='fixture';
 const keys=createLocalJWKSet({keys:[jwk]});
 const make=(issuer='https://auth.openai.com',audience='fixture-client',nonce='nonce',exp='5m')=>new SignJWT({nonce}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer(issuer).setAudience(audience).setSubject('fixture-subject').setIssuedAt().setExpirationTime(exp).sign(privateKey);
 const token=await make();assert.equal((await verifyIdentity(token,'fixture-client','nonce','fixture-subject',keys)).sub,'fixture-subject');
 await assert.rejects(verifyIdentity(token,'other-client','nonce','fixture-subject',keys));
 await assert.rejects(verifyIdentity(token,'fixture-client','wrong-nonce','fixture-subject',keys));
 await assert.rejects(verifyIdentity(token,'fixture-client','nonce','another-subject',keys));
 await assert.rejects(verifyIdentity(await make('https://wrong.invalid'),'fixture-client','nonce',null,keys));
 await assert.rejects(verifyIdentity(await make(undefined,undefined,undefined,'-1h'),'fixture-client','nonce',null,keys));
});
test('separate same-label registrations, owner isolation and actual Windows protected persistence',async()=>{
 const dir=await mkdtemp(join(parent,'vault-'));const vault=new Vault(dir);await vault.init();
 const [one,two,other]=await Promise.all([vault.add('alice','Same account label'),vault.add('alice','Same account label'),vault.add('bob','Bob')]);
 assert.notEqual(one.id,two.id);assert.equal(vault.list('alice').length,2);assert.equal(vault.list('bob').length,1);
 assert.throws(()=>vault.get('bob',one.id));assert.throws(()=>vault.get('alice',other.id));
 const account=vault.get('alice',one.id);
 account.current={clientId:'fixture-client',subject:'fixture-subject',email:'synthetic@example.invalid',accessToken:'synthetic-access-only',refreshToken:'synthetic-refresh-only',scopes:['chatgpt.tokens.use.direct'],expiresAt:Date.now()+3600000};
 await account.save();assert.equal(account.status().planEnabled,true);
 const encrypted=await readFile(account.path);assert(!encrypted.includes(Buffer.from('synthetic-access-only')));
 const host=vault.host;await vault.close();
 const reopened=new Vault(dir);await reopened.init();assert.equal(reopened.host,host);assert.equal(reopened.list('alice').length,2);assert.equal(reopened.list('bob').length,1);assert.equal(reopened.get('alice',one.id).current.clientId,'fixture-client');assert.equal(reopened.get('alice',one.id).status().planEnabled,true);await reopened.close();
});
test('identity-only sign-in does not enable plan use; pending login cancels without a grant',async()=>{
 const dir=await mkdtemp(join(parent,'account-')),account=new ChatGPTAccount(dir);await account.init();
 account.current={clientId:'fixture-client',subject:'fixture-subject',idToken:'synthetic-id-token',scopes:['openid'],expiresAt:Date.now()+3600000};
 assert.equal(account.status().connected,true);assert.equal(account.status().planEnabled,false);await assert.rejects(account.accessToken());
 const pending=account.login(()=>{});await new Promise(r=>setTimeout(r,30));const rejected=assert.rejects(pending);await account.close();await rejected;assert.equal(account.current.subject,'fixture-subject');
});
test('concurrent renewal rotates one protected record; disconnect retains registration without access',async()=>{
 const dir=await mkdtemp(join(parent,'renew-')),account=new ChatGPTAccount(dir);await account.init();
 account.current={clientId:'fixture-client',subject:'fixture-subject',accessToken:'old-fixture',refreshToken:'old-fixture-refresh',scopes:['chatgpt.tokens.use.direct'],expiresAt:0};
 const original=globalThis.fetch;let calls=0;
 try {
  globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>({access_token:'new-fixture',refresh_token:'new-fixture-refresh',expires_in:3600})}};
  const values=await Promise.all([account.accessToken(),account.accessToken(),account.accessToken()]);assert.deepEqual(values,['new-fixture','new-fixture','new-fixture']);assert.equal(calls,1);
  let n=0;globalThis.fetch=async()=>++n===1?{ok:true,json:async()=>({revocation_endpoint:'https://auth.openai.com/revoke'})}:{status:200};
  assert.equal((await account.disconnect()).revoked,true);assert.equal(account.status().connected,false);assert.equal(account.current.clientId,'fixture-client');assert.equal(account.current.accessToken,undefined);
 } finally {globalThis.fetch=original;await account.close()}
});
test('provider completion requires its terminal event; partial and duplicate terminal events fail',async()=>{
 const stream=value=>new ReadableStream({start(c){c.enqueue(Buffer.from(value));c.close()}});
 const completed='data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[]}})+'\n\n';
 assert.equal((await completedEvent(stream(completed))).status,'completed');
 await assert.rejects(completedEvent(stream('data: {"type":"response.output_text.delta","delta":"partial"}\n\n')));
 await assert.rejects(completedEvent(stream('data: {"type":"response.incomplete"}\n\n')));
 await assert.rejects(completedEvent(stream(completed+completed)));
});
