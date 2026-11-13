// Display only receipts returned by the running IRIS production. Case labels are presentation.
const cases = Object.freeze({
  'synthetic-a': Object.freeze({title: 'Matching sources', study: 'study-a'}),
  'synthetic-b': Object.freeze({title: 'Source mismatch', study: 'study-b'}),
});
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const storageKey = 'kotr.native.requests.v1';
const providerModes = Object.freeze({'native-agent-model-replay': 'recorded-model-responses', 'native-agent-live': 'live-provider'});
let pointers = {};
let selected = 'synthetic-a';
try {
  const stored = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
  for (const id of Object.keys(cases)) {
    if (typeof stored[id] === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(stored[id])) pointers[id] = stored[id];
  }
  if (Object.hasOwn(cases, stored.selected)) selected = stored.selected;
} catch { /* Storage can be unavailable; an in-memory request still remains idempotent. */ }
let result = null;
let requestState = 'NONE';
let generation = 0;
let busy = false;
let returnFocus = null;

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);
}
function savePointer() {
  try { sessionStorage.setItem(storageKey, JSON.stringify({...pointers, selected})); } catch { /* No receipt or credential is stored here. */ }
}
function heading(status) { return status === 'ACCEPTED' ? 'Source selection verified' : 'Review required'; }
function notice(message) { $('#review-state').textContent = message; }
function button() {
  $('#run-review').disabled = busy;
  $('#run-review').setAttribute('aria-busy', String(busy));
  $('#run-review span:first-child').textContent = busy ? 'Waiting for IRIS…'
    : requestState === 'COMPLETE' ? 'Run another native review'
    : requestState === 'NONE' ? 'Run native review' : 'Check stored review';
}
function current(context) { return generation === context.generation && selected === context.caseId && pointers[selected] === context.requestId; }
async function api(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch(path, {method: body ? 'POST' : 'GET',
      headers: body ? {'Content-Type': 'application/json'} : {},
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: controller.signal});
    const value = await response.json();
    if (!response.ok) { const error = new Error(value.error || 'IRIS_UNAVAILABLE'); error.status = response.status; throw error; }
    return value;
  } finally { clearTimeout(timer); }
}
function apply(value, context) {
  const run = value.run;
  if (value.status !== 'OK' || !run || run.requestId !== context.requestId || run.caseId !== context.caseId
      || typeof run.proposalKind !== 'string' || !Object.hasOwn(providerModes, run.proposalKind)
      || !['COMPLETE', 'RUNNING', 'ERROR'].includes(run.state)) {
    throw new Error('INVALID_IRIS_RECEIPT');
  }
  if (run.state === 'COMPLETE' && (!run.response || run.response.caseId !== context.caseId
      || !Number.isInteger(run.response.auditId) || run.response.auditId < 1 || run.interop?.status !== 'VERIFIED'
      || !['ACCEPTED', 'REVIEW_REQUESTED'].includes(run.response.status) || !Array.isArray(run.response.citations) || !run.facts
      || run.agent?.kind !== 'native-ai-hub' || run.agent?.providerMode !== providerModes[run.proposalKind])) {
    throw new Error('INVALID_IRIS_RECEIPT');
  }
  if (!current(context)) return;
  requestState = run.state;
  result = run.state === 'COMPLETE' ? run : null;
  if (result) {
    const review = result.response.status !== 'ACCEPTED';
    const replay = result.agent.providerMode === 'recorded-model-responses';
    $('#mode-note').textContent = replay ? 'Live IRIS workflow and fresh receipts. Recorded model responses; no fresh inference.'
      : 'Live IRIS workflow and model provider. The provider was explicitly configured by the operator.';
    $('#book-source').textContent = replay ? 'Fresh IRIS receipt · recorded model responses' : 'Fresh IRIS receipt · live model provider';
    $('.scene-foot span:last-child').textContent = replay ? 'LIVE IRIS · MODEL RESPONSE REPLAY' : 'LIVE IRIS · LIVE MODEL PROVIDER';
    $('#chamber').dataset.projection = review ? 'withheld' : 'verified';
    $('#speaker').textContent = 'IRIS · NATIVE RULING';
    $('#scene-message').textContent = result.response.explanation;
    $('#outcome').dataset.state = review ? 'review' : 'accepted';
    $('#outcome-title').textContent = heading(result.response.status);
    $('#outcome-text').textContent = result.response.explanation;
    $('#outcome').hidden = false;
    notice(`IRIS audit ${result.response.auditId} · Interoperability session ${result.interop.sessionId}.`);
  } else {
    notice(run.state === 'RUNNING' ? 'IRIS has reserved this request. Check again to retrieve its receipt.'
      : 'This request requires operator inspection. Its identity is preserved; it will not run again automatically.');
  }
  renderLedger();
}
async function recover(context) {
  busy = true; button(); notice('Reading the existing IRIS receipt…');
  try { apply(await api(`/api/reviews/${encodeURIComponent(context.requestId)}`), context); }
  catch (error) {
    if (!current(context)) return;
    if (error.status === 404) {
      requestState = 'NONE';
      notice('No stored review was found. Run native review to submit this request.');
    } else {
      requestState = 'UNKNOWN';
      notice('The stored review could not be retrieved. Check again; refreshing does not submit another review.');
    }
  } finally { if (current(context)) { busy = false; button(); } }
}
function selectCase(id) {
  if (!Object.hasOwn(cases, id)) return;
  generation += 1;
  selected = id; result = null; busy = false;
  requestState = pointers[id] ? 'UNKNOWN' : 'NONE';
  savePointer();
  $('#chamber').dataset.projection = 'waiting';
  $$('.case-choice').forEach(element => element.setAttribute('aria-pressed', String(element.dataset.case === id)));
  $('#study-value').textContent = cases[id].study;
  $('#case-hint').textContent = id === 'synthetic-a' ? 'The two synthetic references agree.' : 'The synthetic references point to different studies.';
  $('#speaker').textContent = 'THE COUNCIL';
  $('#scene-message').textContent = 'Send the selected synthetic case to IRIS.';
  $('#outcome').hidden = true;
  notice('IRIS will run the AI Hub agent, validate the result and record a fresh receipt. Model responses are replayed.');
  button(); renderLedger();
  if (pointers[id]) void recover({caseId: id, requestId: pointers[id], generation});
}
async function runScenario() {
  if (busy) return;
  if (!['NONE', 'COMPLETE'].includes(requestState)) {
    return recover({caseId: selected, requestId: pointers[selected], generation});
  }
  if (requestState === 'COMPLETE' || !pointers[selected]) {
    pointers[selected] = crypto.randomUUID();
    savePointer();
  }
  const context = {caseId: selected, requestId: pointers[selected], generation};
  result = null; requestState = 'UNKNOWN'; busy = true;
  $('#outcome').hidden = true;
  $('#chamber').dataset.projection = 'waiting';
  renderLedger(); button(); notice('IRIS is running the AI Hub agent and validating its proposal…');
  try { apply(await api('/api/reviews', {caseId: context.caseId, requestId: context.requestId}), context); }
  catch {
    if (!current(context)) return;
    requestState = 'UNKNOWN';
    notice('The response was not confirmed. The request identity is preserved; check its stored receipt before starting another review.');
  } finally { if (current(context)) { busy = false; button(); } }
}
function renderLedger() {
  if (!result) {
    $('#book-content').innerHTML = '<div class="receipt"><section class="receipt-page"><h3>No completed receipt loaded</h3><p>Run a synthetic review or retrieve its existing IRIS receipt.</p></section><section class="receipt-page"><h3>Authority stays in IRIS</h3><p>This page runs the native AI Hub agent through the real Interoperability production. Model responses are replayed; this is not fresh inference. It cannot approve or execute a task.</p></section></div>';
    $('#dashboard-content').innerHTML = '<p class="dashboard-notice">No completed IRIS receipt is loaded for this case. Return to the chamber to run or retrieve it.</p>';
    return;
  }
  const response = result.response;
  const review = response.status !== 'ACCEPTED';
  const replay = result.agent.providerMode === 'recorded-model-responses';
  const title = escapeText(cases[selected].title);
  const rows = values => values.map(([label, value]) => `<dt>${escapeText(label)}</dt><dd>${escapeText(value)}</dd>`).join('');
  $('#book-content').innerHTML = `<div class="receipt">
    <section class="receipt-page"><h3>Case and proceedings</h3><p><strong>${title}</strong><br>${escapeText(selected)}</p>
      <p>${replay ? 'Fresh IRIS execution · recorded model responses' : 'Fresh IRIS execution · live model provider'}</p><dl>${rows([
        ['Image study', result.facts.ctStudy], ['Selection study', result.facts.segStudy], ['Request identity', result.requestId],
        ['Agent', result.agent.kind], ['Model', result.agent.model],
        ['Model response source', replay ? 'Recorded completions · no fresh inference' : 'Live provider · operator configured'],
        ['IRIS audit', response.auditId], ['Interoperability session', result.interop.sessionId],
        ['Request message header', result.interop.requestHeaderId], ['Response message header', result.interop.responseHeaderId],
        ['Response body', result.interop.responseBodyId],
      ])}</dl><p>Refreshing reads this receipt. It does not repeat the review.</p></section>
    <section class="receipt-page"><h3>The IRIS disposition</h3><p><span class="receipt-tag ${review ? 'review' : ''}">${escapeText(heading(response.status))}</span></p><p>${escapeText(response.explanation)}</p>
      <dl>${rows([['Status', response.status], ['Action', response.action], ['Selection', response.semanticId || 'None — selection withheld']])}</dl>
      <strong>Validated citations</strong><ul>${response.citations.map(citation => `<li>${escapeText(citation)}</li>`).join('')}</ul>
      <p>${escapeText(response.limitation)} A source ruling does not approve or execute a task.</p></section></div>`;
  $('#dashboard-content').innerHTML = `<div class="dashboard-grid">
    <div class="dashboard-tile"><span>CASE</span><strong>${title}</strong></div>
    <div class="dashboard-tile"><span>IRIS DISPOSITION</span><strong>${escapeText(heading(response.status))}</strong></div>
    <div class="dashboard-tile"><span>SELECTION</span><strong>${response.semanticId ? escapeText(response.semanticId) : 'Withheld'}</strong></div>
    </div><p class="dashboard-copy">${escapeText(response.explanation)}</p>
    <p class="dashboard-copy">IRIS audit ${escapeText(response.auditId)} · Interoperability session ${escapeText(result.interop.sessionId)}. The Book and dashboard display the same server receipt.</p>
    <p class="dashboard-copy">The AI Hub agent, IRIS validation, production messages and audit persistence run now. ${replay ? 'Model responses are replayed; this is not fresh inference.' : 'The model provider was explicitly configured by the operator.'} This page authorizes no task execution.</p>`;
}
function setView(view) {
  const dashboard = view === 'dashboard';
  $('#chamber').hidden = dashboard;
  $('.case-panel').hidden = dashboard;
  $('#dashboard').hidden = !dashboard;
  $$('[data-view]').forEach(element => element.setAttribute('aria-pressed', String(element.dataset.view === view)));
}
function openDialog(id) {
  const dialog = document.getElementById(id);
  returnFocus = document.activeElement;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  dialog.querySelector('button')?.focus();
}
function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
  if (returnFocus?.isConnected) returnFocus.focus();
}
$$('.case-choice').forEach(element => element.addEventListener('click', () => selectCase(element.dataset.case)));
$$('[data-view]').forEach(element => element.addEventListener('click', () => setView(element.dataset.view)));
$('#run-review').addEventListener('click', runScenario);
$('#book-open').addEventListener('click', () => openDialog('book-dialog'));
$('#outcome-book').addEventListener('click', () => openDialog('book-dialog'));
$('#dashboard-book').addEventListener('click', () => openDialog('book-dialog'));
$('#about-open').addEventListener('click', () => openDialog('about-dialog'));
$$('[data-close]').forEach(element => element.addEventListener('click', () => closeDialog(element.dataset.close)));
$$('dialog').forEach(dialog => dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus(); }));
selectCase(selected);
