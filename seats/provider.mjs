const catalog=new Map();
export async function boundedJson(response,maximum=262144,observe=()=>{}) {
  const chunks=[];let size=0;
  for await(const part of response.body){size+=part.length;if(size>maximum)throw new Error('Response exceeded its size limit.');chunks.push(part)}
  observe(size);return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function clearCatalog(id){catalog.delete(id)}
export function catalogMeasurement(id){const value=catalog.get(id);return value?{sourceBytes:value.sourceBytes,choices:value.value.length,retainedChoiceBytes:Buffer.byteLength(JSON.stringify(value.value))}:null}
export async function models(account,id) {
  const cached=catalog.get(id);if(cached?.until>Date.now())return cached.value;
  const token=await account.accessToken();
  const response=await fetch('https://api.openai.com/v1/models',{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('CHATGPT_CATALOG_HTTP_'+response.status);
  let sourceBytes=0;
  // The provider includes rich capability metadata; retain only the picker identities after the bounded read.
  const data=await boundedJson(response,2097152,n=>{sourceBytes=n});
  if(!Array.isArray(data.models))throw new Error('CHATGPT_CATALOG_SHAPE');
  const value=data.models.filter(m=>m.visibility==='list'&&typeof m.slug==='string').map(m=>({id:m.slug,label:m.display_name??m.slug}));
  catalog.set(id,{until:Date.now()+60000,value,sourceBytes});return value;
}
// Completion is the terminal protocol event, not the arrival of an initial text fragment.
export async function completedEvent(body,maximum=2000000) {
  const chunks=[];let size=0;
  for await(const part of body){size+=part.length;if(size>maximum)throw new Error('Response exceeded its size limit.');chunks.push(part)}
  let completed;
  for(const block of Buffer.concat(chunks).toString('utf8').split(/\r?\n\r?\n/)){
    const data=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data||data==='[DONE]')continue;
    const event=JSON.parse(data);
    if(['response.failed','response.incomplete','error'].includes(event.type))throw new Error('Provider failed or did not complete.');
    if(event.type==='response.completed'){if(completed)throw new Error('Duplicate terminal event.');completed=event.response}
  }
  if(completed?.status!=='completed')throw new Error('No completed provider response.');
  return completed;
}
function prompt(job) {
  const role=job.role==='challenger'?'Independently challenge the proposed source relationship.':'Review the source relationship.';
  return [{role:'developer',content:role+' Use only the supplied synthetic facts. Compare ctStudy with segStudy. Return ONLY a JSON object containing action and citations. Choose SHOW_VERIFIED only when those study IDs match, otherwise REQUEST_REVIEW. Copy evidenceRefs exactly, preserving order. No other fields. Do not approve or execute tasks.'},
    {role:'user',content:JSON.stringify(job.packet.facts)}];
}
export async function inferChatGPT(account,job,signal) {
  if(!(await models(account,job.connectionId)).some(m=>m.id===job.model))throw new Error('Selected model is unavailable.');
  const token=await account.accessToken();
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({model:job.model,input:prompt(job),store:false,stream:true}),redirect:'error',signal});
  if(!response.ok)throw new Error('Provider request was not accepted.');
  const result=await completedEvent(response.body),text=[];
  for(const item of result.output??[]){
    if(item.type==='reasoning')continue;
    if(item.type!=='message')throw new Error('Unexpected provider output.');
    for(const part of item.content??[]){if(part.type!=='output_text')throw new Error('Unexpected provider output.');text.push(part.text)}
  }
  const proposal=text.join('');if(proposal.length>4096)throw new Error('Proposal exceeded its size limit.');
  JSON.parse(proposal);
  return {proposal,responseId:result.id??'',usage:{inputTokens:result.usage?.input_tokens??null,outputTokens:result.usage?.output_tokens??null,totalTokens:result.usage?.total_tokens??null}};
}
export function localOrigin(value) {
  const url=new URL(value);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/v1')throw new Error('Local provider must be an explicitly configured loopback /v1 endpoint.');
  return url.href.replace(/\/$/,'');
}
export async function localModels(base) {
  const response=await fetch(localOrigin(base)+'/models',{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('Local provider unavailable.');
  const data=await boundedJson(response);if(!Array.isArray(data.data))throw new Error('Invalid local catalog.');
  return data.data.filter(m=>typeof m.id==='string').map(m=>({id:m.id,label:m.id}));
}
export async function inferLocal(base,job,signal) {
  if(!(await localModels(base)).some(m=>m.id===job.model))throw new Error('Selected local model unavailable.');
  const response=await fetch(localOrigin(base)+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model:job.model,messages:prompt(job),stream:false,max_tokens:512}),redirect:'error',signal});
  if(!response.ok)throw new Error('Local provider failed.');
  const data=await boundedJson(response),choice=data.choices?.[0];
  if(choice?.finish_reason!=='stop'||typeof choice.message?.content!=='string')throw new Error('Local provider did not complete.');
  const proposal=choice.message.content;if(proposal.length>4096)throw new Error('Proposal exceeded its size limit.');JSON.parse(proposal);
  return {proposal,responseId:data.id??'',usage:{inputTokens:data.usage?.prompt_tokens??null,outputTokens:data.usage?.completion_tokens??null,totalTokens:data.usage?.total_tokens??null}};
}
