// Display only receipts returned by the running IRIS production. Case labels are presentation.
const cases = Object.freeze({
  'synthetic-a': Object.freeze({title: 'Matching sources', study: 'study-a'}),
  'synthetic-b': Object.freeze({title: 'Source mismatch', study: 'study-b'}),
});
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const storageKey = 'kotr.native.requests.v2';
const legacyStorageKey = 'kotr.native.requests.v1';
const providerModes = Object.freeze({'native-agent-model-replay': 'recorded-model-responses', 'native-agent-live': 'live-provider'});
const validRequest = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
let pointers = {replay: {}, 'default-live': {}, 'temporary-live': {}};
let selected = 'synthetic-a';
let selectedRoute = 'default';
let defaultMode = null;
try {
  const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
  if (stored && typeof stored === 'object') {
    for (const mode of ['replay', 'default-live', 'temporary-live']) for (const id of Object.keys(cases)) {
      if (validRequest(stored.requests?.[mode]?.[id])) pointers[mode][id] = stored.requests[mode][id];
    }
    if (Object.hasOwn(cases, stored.selected)) selected = stored.selected;
    if (stored.mode === 'live') selectedRoute = 'live';
  } else {
    const legacy = JSON.parse(sessionStorage.getItem(legacyStorageKey) || '{}');
    for (const id of Object.keys(cases)) if (validRequest(legacy[id])) pointers.replay[id] = legacy[id];
    if (Object.hasOwn(cases, legacy.selected)) selected = legacy.selected;
  }
} catch { /* Storage is optional. Only case/profile request identities are retained. */ }
let result = null;
let resultRoute = null;
let requestState = 'NONE';
let generation = 0;
let busy = false;
let returnFocus = null;
let healthGeneration = 0;
let healthState = null;
let healthPending = false;

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);
}
function savePointer() {
  try { sessionStorage.setItem(storageKey, JSON.stringify({selected, mode: selectedRoute, requests: pointers})); } catch { /* No receipt or credential is stored here. */ }
}
function heading(status) { return status === 'ACCEPTED' ? 'Source selection verified' : 'Review required'; }
function notice(message) { $('#review-state').textContent = message; }
function requestMode() { return selectedRoute === 'live' ? 'live' : defaultMode || 'replay'; }
function requestProfile() { return selectedRoute === 'live' ? 'temporary-live' : defaultMode === 'live' ? 'default-live' : 'replay'; }
function currentPointer() { return pointers[requestProfile()][selected]; }
function requestContext() {
  return {caseId: selected, route: selectedRoute, mode: requestMode(), profile: requestProfile(), requestId: currentPointer(), generation};
}
function liveReady() { return healthState?.byok?.available === true && !healthState.newReviewsBlocked; }
function clearLiveKey() {
  $('#live-api-key').value = '';
  $('#live-consent').checked = false;
}
function validTemporaryKey(value) {
  return typeof value === 'string' && value.length >= 20 && value.length <= 512 && !/[\s\u0000-\u001f\u007f]/.test(value);
}
function renderProfile() {
  $$('input[name="review-profile"]').forEach(input => { input.checked = input.value === selectedRoute; });
  $('#default-profile-label').textContent = defaultMode === 'live' ? 'Default IRIS profile · live provider'
    : defaultMode === 'replay' ? 'Default IRIS profile · recorded model replies' : 'Default IRIS profile · checking mode';
  $('#live-review-settings').hidden = selectedRoute !== 'live';
  $('#live-review-settings').disabled = !liveReady();
  $('#live-capability-note').textContent = liveReady()
    ? 'Groq · openai/gpt-oss-20b · up to 3 calls per review · up to 1,024 output tokens per call. Input tokens are also billed.'
    : healthState?.newReviewsBlocked ? 'New reviews are unavailable while another review is active or requires reconciliation. Existing receipts can still be retrieved.'
    : 'This deployment has not enabled temporary-key reviews, or their availability cannot be verified. Existing receipts can still be retrieved.';
  $('#review-profile-note').textContent = selectedRoute === 'live'
    ? 'Selected: live Groq with your temporary key. No automatic fallback to recorded responses.'
    : defaultMode === 'live' ? 'Selected: the operator-configured live default profile. No temporary key is entered on this page.'
    : defaultMode === 'replay' ? 'Selected: recorded model replies. Native IRIS still executes and records each review now.'
    : 'Checking the default profile before a new review. Each receipt identifies its actual response source.';
}
function newReviewExhausted() {
  return ['NONE', 'COMPLETE'].includes(requestState) && healthState?.allowance?.remaining === 0;
}
function newReviewsBlocked() {
  return ['NONE', 'COMPLETE'].includes(requestState) && healthState?.newReviewsBlocked === true;
}
function button() {
  const exhausted = newReviewExhausted();
  const blocked = newReviewsBlocked();
  const newRequest = ['NONE', 'COMPLETE', 'AWAITING_PROFILE'].includes(requestState);
  const awaitingProfile = selectedRoute === 'default' && defaultMode === null;
  const awaitingStatus = newRequest && healthPending;
  const awaitingLive = newRequest && selectedRoute === 'live'
    && (!liveReady() || !$('#live-consent').checked || !validTemporaryKey($('#live-api-key').value));
  $('#run-review').disabled = busy || exhausted || blocked || awaitingProfile || awaitingStatus || awaitingLive;
  $('#run-review').setAttribute('aria-busy', String(busy));
  $('#run-review span:first-child').textContent = busy ? 'Waiting for IRIS…'
    : blocked ? 'New reviews unavailable'
    : exhausted ? 'Shared allowance exhausted'
    : awaitingProfile ? 'Checking default profile…'
    : awaitingStatus ? 'Checking IRIS status…'
    : requestState === 'COMPLETE' ? selectedRoute === 'live' ? 'Run another live review' : 'Run another native review'
    : requestState === 'NONE' ? selectedRoute === 'live' ? 'Run live Groq review' : 'Run native review' : 'Check stored review';
}
function current(context) { return generation === context.generation && selected === context.caseId && selectedRoute === context.route
  && requestMode() === context.mode && requestProfile() === context.profile && pointers[context.profile][selected] === context.requestId; }
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
function checkedHealth(value) {
  if (value?.status !== 'OK' || typeof value.running !== 'boolean'
      || !Object.hasOwn(providerModes, value.mode) || value.production !== 'KnAIghts.Review.Production'
      || (Object.hasOwn(value, 'newReviewsBlocked') && typeof value.newReviewsBlocked !== 'boolean')) {
    throw new Error('INVALID_IRIS_HEALTH');
  }
  const state = {running: value.running, mode: value.mode, production: value.production, agent: null, allowance: null, byok: null, newReviewsBlocked: value.newReviewsBlocked === true};
  const agent = value.agent;
  if (agent?.kind === 'native-ai-hub' && agent.providerMode === providerModes[value.mode]
      && typeof agent.model === 'string' && agent.model.length > 0 && agent.model.length <= 100
      && !/[\u0000-\u001f\u007f]/.test(agent.model)) {
    state.agent = {kind: agent.kind, model: agent.model, providerMode: agent.providerMode};
  }
  const quota = value.allowance;
  if (quota?.status === 'OK' && quota.scope === 'shared-retained-instance'
      && Number.isSafeInteger(quota.limit) && quota.limit > 0
      && Number.isSafeInteger(quota.used) && quota.used >= 0 && quota.used <= quota.limit
      && Number.isSafeInteger(quota.remaining) && quota.remaining === quota.limit - quota.used
      && Number.isSafeInteger(quota.maxConcurrent) && quota.maxConcurrent > 0
      && Number.isFinite(quota.minIntervalSeconds) && quota.minIntervalSeconds >= 0) {
    state.allowance = {limit: quota.limit, used: quota.used, remaining: quota.remaining,
      maxConcurrent: quota.maxConcurrent, minIntervalSeconds: quota.minIntervalSeconds};
  }
  const byok = value.byok;
  if (byok?.available === true && byok.provider === 'Groq' && byok.model === 'openai/gpt-oss-20b'
      && byok.maxCalls === 3 && byok.maxTokensPerCall === 1024) {
    state.byok = {available: true, provider: byok.provider, model: byok.model,
      maxCalls: byok.maxCalls, maxTokensPerCall: byok.maxTokensPerCall};
  }
  return state;
}
function renderHealth() {
  const state = healthState;
  const quota = state?.allowance;
  $('#native-overview').setAttribute('aria-busy', String(healthPending));
  $('#native-refresh').disabled = healthPending;
  $('#native-badge').dataset.state = state?.running ? 'ready' : 'unknown';
  $('#native-badge-text').textContent = state?.running ? 'LIVE IRIS' : healthPending ? 'CHECKING IRIS' : 'IRIS UNAVAILABLE';
  $('#native-readiness').textContent = state ? state.running ? 'Running' : 'Not running'
    : healthPending ? 'Checking readiness…' : 'Readiness unavailable';
  $('#native-production').textContent = state?.production || 'Production status unavailable';
  $('#native-profile').textContent = state?.agent ? `${state.agent.kind} · ${state.agent.model}` : 'Profile unavailable';
  $('#native-mode').textContent = state ? state.mode === 'native-agent-model-replay'
    ? 'Recorded model replies · no fresh inference' : 'Live model provider · operator configured'
    : 'Model response source unavailable';
  $('#native-allowance').textContent = quota ? `${quota.remaining} of ${quota.limit} attempts remaining${quota.remaining === 0 ? ' · exhausted' : ''}`
    : healthPending ? 'Checking allowance…' : 'Allowance unavailable';
  $('#native-allowance-detail').textContent = quota ? `${quota.used} used · shared across this retained instance`
    : 'No estimate. Existing receipts remain readable.';
  $('#native-limits').textContent = quota ? `${quota.maxConcurrent} review${quota.maxConcurrent === 1 ? '' : 's'} at a time · at least ${quota.minIntervalSeconds} seconds between new requests.`
    : 'Concurrency and request interval unavailable.';
  $('#native-health-note').textContent = healthPending ? 'Reading current IRIS status. Refreshing status does not run a review.'
    : !state ? 'Current status could not be verified. Refresh status to try again; stored receipt recovery is still available.'
    : state.newReviewsBlocked ? 'New reviews are unavailable while another review is active or requires reconciliation. Existing receipts can still be read.'
    : !quota ? 'Shared allowance could not be verified. IRIS still enforces its limits; stored receipt recovery is available.'
    : quota.remaining === 0 ? 'The shared allowance is exhausted. Existing receipts can still be opened or retrieved.'
    : 'Current server snapshot. Other visitors may use the shared allowance; IRIS enforces each request.';
  if (!healthPending && !liveReady()) clearLiveKey();
  renderProfile();
  button();
}
function invalidateHealth() {
  healthGeneration += 1;
  healthState = null;
  healthPending = true;
  renderHealth();
}
async function refreshHealth() {
  const ownGeneration = ++healthGeneration;
  healthState = null;
  healthPending = true;
  renderHealth();
  try {
    const value = checkedHealth(await api('/api/health'));
    if (ownGeneration === healthGeneration) {
      healthState = value;
      const previousMode = defaultMode;
      defaultMode = value.mode === 'native-agent-live' ? 'live' : 'replay';
      if (selectedRoute === 'default' && previousMode !== defaultMode) selectCase(selected);
    }
  } catch {
    if (ownGeneration !== healthGeneration) return;
    healthState = null;
  } finally {
    if (ownGeneration === healthGeneration) {
      healthPending = false;
      renderHealth();
    }
  }
}
function apply(value, context) {
  const run = value.run;
  if (value.status !== 'OK' || !run || run.requestId !== context.requestId || run.caseId !== context.caseId
      || run.proposalKind !== (context.mode === 'live' ? 'native-agent-live' : 'native-agent-model-replay')
      || (context.route === 'live' && run.agent?.model !== 'gpt-oss:20b')
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
  resultRoute = result ? context.route : null;
  if (result) {
    const review = result.response.status !== 'ACCEPTED';
    const replay = result.agent.providerMode === 'recorded-model-responses';
    const temporary = resultRoute === 'live';
    $('#mode-note').textContent = replay ? 'Live IRIS workflow and fresh receipts. Recorded model responses; no fresh inference.'
      : temporary ? 'Live IRIS workflow. Groq replies used a temporary key supplied for this review.'
      : 'Live IRIS workflow and model provider. The provider was explicitly configured by the operator.';
    $('#book-source').textContent = replay ? 'Fresh IRIS receipt · recorded model responses'
      : temporary ? 'Fresh IRIS receipt · live Groq · temporary key' : 'Fresh IRIS receipt · live model provider';
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
  } finally {
    if (current(context)) { busy = false; button(); }
    void refreshHealth();
  }
}
function selectCase(id) {
  if (!Object.hasOwn(cases, id)) return;
  generation += 1;
  clearLiveKey();
  selected = id; result = null; resultRoute = null; busy = false;
  requestState = selectedRoute === 'default' && defaultMode === null ? 'AWAITING_PROFILE' : currentPointer() ? 'UNKNOWN' : 'NONE';
  savePointer();
  $('#chamber').dataset.projection = 'waiting';
  $$('.case-choice').forEach(element => element.setAttribute('aria-pressed', String(element.dataset.case === id)));
  $('#study-value').textContent = cases[id].study;
  $('#case-hint').textContent = id === 'synthetic-a' ? 'The two synthetic references agree.' : 'The synthetic references point to different studies.';
  $('#speaker').textContent = 'THE COUNCIL';
  $('#scene-message').textContent = 'Send the selected synthetic case to IRIS.';
  $('#outcome').hidden = true;
  const live = requestMode() === 'live';
  $('#mode-note').textContent = requestState === 'AWAITING_PROFILE' ? 'Checking the default model response source before a new review.'
    : live ? 'Live model replies are requested only through the selected profile. Each receipt identifies its actual source.'
    : 'Live IRIS workflow. The selected default profile uses recorded model replies; no fresh inference.';
  $('.scene-foot span:last-child').textContent = requestState === 'AWAITING_PROFILE' ? 'MODEL PROFILE CHECK PENDING'
    : live ? 'LIVE IRIS · LIVE MODEL PROFILE' : 'LIVE IRIS · MODEL RESPONSE REPLAY';
  notice(requestState === 'AWAITING_PROFILE' ? 'Checking the default IRIS profile before submitting or recovering this case.'
    : live ? 'IRIS will validate the live proposal and record a fresh receipt. No automatic replay fallback.'
    : 'IRIS will run the AI Hub agent, validate the result and record a fresh receipt. Model responses are replayed.');
  renderProfile(); button(); renderLedger();
  if (currentPointer() && requestState !== 'AWAITING_PROFILE') void recover(requestContext());
}
function selectProfile(route) {
  if (!['default', 'live'].includes(route) || route === selectedRoute) return;
  selectedRoute = route;
  selectCase(selected);
}
async function runScenario() {
  if (busy || (selectedRoute === 'default' && defaultMode === null)) return;
  if (!['NONE', 'COMPLETE'].includes(requestState)) return recover(requestContext());
  if (healthPending) return;
  let apiKey = selectedRoute === 'live' ? $('#live-api-key').value : '';
  const consent = $('#live-consent').checked;
  clearLiveKey();
  if (newReviewExhausted() || newReviewsBlocked()) { button(); return; }
  if (selectedRoute === 'live' && (!liveReady() || !consent || !validTemporaryKey(apiKey))) {
    apiKey = '';
    notice('A live review requires verified availability, a temporary key and explicit consent. Nothing was submitted.');
    button(); return;
  }
  invalidateHealth();
  if (requestState === 'COMPLETE' || !currentPointer()) {
    pointers[requestProfile()][selected] = crypto.randomUUID();
    savePointer();
  }
  const context = requestContext();
  const body = {caseId: context.caseId, requestId: context.requestId};
  if (context.route === 'live') { body.apiKey = apiKey; body.consent = true; }
  apiKey = '';
  result = null; resultRoute = null; requestState = 'UNKNOWN'; busy = true;
  $('#outcome').hidden = true;
  $('#chamber').dataset.projection = 'waiting';
  renderLedger(); button(); notice('IRIS is running the AI Hub agent and validating its proposal…');
  try { apply(await api(context.route === 'live' ? '/api/live-reviews' : '/api/reviews', body), context); }
  catch {
    if (!current(context)) return;
    requestState = 'UNKNOWN';
    notice('The response was not confirmed. The request identity is preserved; check its stored receipt without a key or another model call.');
  } finally {
    delete body.apiKey;
    if (current(context)) { busy = false; button(); }
    void refreshHealth();
  }
}
function renderLedger() {
  if (!result) {
    $('#book-content').innerHTML = '<div class="receipt"><section class="receipt-page"><h3>No completed receipt loaded</h3><p>Run a synthetic review or retrieve its existing IRIS receipt.</p></section><section class="receipt-page"><h3>Authority stays in IRIS</h3><p>This page runs the native AI Hub agent through the real Interoperability production. Each completed receipt identifies whether model replies were recorded or live. This page cannot approve or execute a task.</p></section></div>';
    $('#dashboard-content').innerHTML = '<p class="dashboard-notice">No completed IRIS receipt is loaded for this case. Return to the chamber to run or retrieve it.</p>';
    return;
  }
  const response = result.response;
  const review = response.status !== 'ACCEPTED';
  const replay = result.agent.providerMode === 'recorded-model-responses';
  const temporary = resultRoute === 'live';
  const title = escapeText(cases[selected].title);
  const rows = values => values.map(([label, value]) => `<dt>${escapeText(label)}</dt><dd>${escapeText(value)}</dd>`).join('');
  $('#book-content').innerHTML = `<div class="receipt">
    <section class="receipt-page"><h3>Case and proceedings</h3><p><strong>${title}</strong><br>${escapeText(selected)}</p>
      <p>${replay ? 'Fresh IRIS execution · recorded model responses' : 'Fresh IRIS execution · live model provider'}</p><dl>${rows([
        ['Image study', result.facts.ctStudy], ['Selection study', result.facts.segStudy], ['Request identity', result.requestId],
        ['Agent', result.agent.kind], ['Model', result.agent.model],
        ['Model response source', replay ? 'Recorded completions · no fresh inference'
          : temporary ? 'Live Groq · temporary key for this review' : 'Live provider · operator configured'],
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
    <p class="dashboard-copy">The AI Hub agent, IRIS validation, production messages and audit persistence run now. ${replay ? 'Model responses are replayed; this is not fresh inference.'
      : temporary ? 'Groq replies used a temporary key supplied for this review.' : 'The model provider was explicitly configured by the operator.'} This page authorizes no task execution.</p>`;
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
$('#native-refresh').addEventListener('click', () => { void refreshHealth(); });
$$('input[name="review-profile"]').forEach(input => input.addEventListener('change', () => { if (input.checked) selectProfile(input.value); }));
$('#live-api-key').addEventListener('input', button);
$('#live-consent').addEventListener('change', button);
window.addEventListener('pagehide', clearLiveKey);
$('#book-open').addEventListener('click', () => openDialog('book-dialog'));
$('#outcome-book').addEventListener('click', () => openDialog('book-dialog'));
$('#dashboard-book').addEventListener('click', () => openDialog('book-dialog'));
$('#about-open').addEventListener('click', () => openDialog('about-dialog'));
$$('[data-close]').forEach(element => element.addEventListener('click', () => closeDialog(element.dataset.close)));
$$('dialog').forEach(dialog => dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus(); }));
selectCase(selected);
void refreshHealth();
