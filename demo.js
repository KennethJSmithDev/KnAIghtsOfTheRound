// This static presentation uses the two retained synthetic rehearsal outcomes.
// It never calls the live session API, creates an audit, or approves a task.
const cases = Object.freeze({
  'synthetic-a': Object.freeze({
    title: 'Matching sources', study: 'study-a', status: 'ACCEPTED', action: 'SHOW_VERIFIED',
    semanticId: 'synthetic.structure.001', recordedAudit: 2,
    explanation: 'The synthetic selection and the source image refer to the same study.',
    speech: 'The two scrolls bear the same study seal. The selection may be shown.',
  }),
  'synthetic-b': Object.freeze({
    title: 'Source mismatch', study: 'study-b', status: 'REVIEW_REQUESTED', action: 'REQUEST_REVIEW',
    semanticId: '', recordedAudit: 3,
    explanation: 'The evidence needs review before a source selection can be shown.',
    speech: 'These sources differ. The selection is withheld for review.',
  }),
});
const citations = ['ImagingStudy/example-ct', 'ImagingSelection/example-segment'];
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let selected = 'synthetic-a';
let result = null;
let returnFocus = null;

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);
}
function heading(status) { return status === 'ACCEPTED' ? 'Source selection verified' : 'Review required'; }
function selectCase(id) {
  if (!Object.hasOwn(cases, id)) return;
  selected = id;
  result = null;
  $('#chamber').dataset.projection = 'waiting';
  const item = cases[id];
  $$('.case-choice').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.case === id)));
  $('#study-value').textContent = item.study;
  $('#case-hint').textContent = id === 'synthetic-a' ? 'The two synthetic references agree.' : 'The synthetic references point to different studies.';
  $('#speaker').textContent = 'THE COUNCIL';
  $('#scene-message').textContent = 'Choose a case below to begin.';
  $('#outcome').hidden = true;
  $('#run-review span:first-child').textContent = 'Run the simulation';
  renderLedger();
}
function runScenario() {
  result = cases[selected];
  const review = result.status !== 'ACCEPTED';
  $('#chamber').dataset.projection = review ? 'withheld' : 'verified';
  $('#speaker').textContent = 'IRIS · RECORDED RULING';
  $('#scene-message').textContent = result.speech;
  $('#outcome').dataset.state = review ? 'review' : 'accepted';
  $('#outcome-title').textContent = heading(result.status);
  $('#outcome-text').textContent = result.explanation;
  $('#outcome').hidden = false;
  $('#run-review span:first-child').textContent = 'Replay this scenario';
  renderLedger();
}
function renderLedger() {
  const item = cases[selected];
  if (!result) {
    $('#book-content').innerHTML = '<div class="receipt"><section class="receipt-page"><h3>The case awaits</h3><p>Choose a synthetic case and run the simulation to see its recorded evidence and disposition.</p></section><section class="receipt-page"><h3>About this book</h3><p>This static demonstration does not create a new audit or perform a live AI request.</p></section></div>';
    $('#dashboard-content').innerHTML = '<p class="dashboard-notice">No scenario has been replayed yet. Return to the chamber, choose a case, and run the simulation.</p>';
    return;
  }
  const review = result.status !== 'ACCEPTED';
  const status = escapeText(result.status);
  const action = escapeText(result.action);
  const semantic = result.semanticId ? escapeText(result.semanticId) : 'None — selection withheld';
  const title = escapeText(item.title);
  const explanation = escapeText(result.explanation);
  const source = escapeText(item.study);
  $('#book-content').innerHTML = `<div class="receipt">
    <section class="receipt-page"><h3>Case and proceedings</h3><p><strong>${title}</strong><br>${escapeText(selected)}</p>
      <p>Recorded Codex rehearsal · synthetic data</p><dl><dt>Image study</dt><dd>urn:example:study-a</dd><dt>Selection study</dt><dd>urn:example:${source}</dd><dt>Recorded audit</dt><dd>${result.recordedAudit} · original fixture</dd></dl>
      <p>This identifier belongs to the retained recording; no new audit is created here.</p></section>
    <section class="receipt-page"><h3>The IRIS disposition</h3><p><span class="receipt-tag ${review ? 'review' : ''}">${escapeText(heading(result.status))}</span></p><p>${explanation}</p>
      <dl><dt>Status</dt><dd>${status}</dd><dt>Action</dt><dd>${action}</dd><dt>Selection</dt><dd>${semantic}</dd></dl>
      <strong>Recorded citations</strong><ul>${citations.map(c => `<li>${escapeText(c)}</li>`).join('')}</ul>
      <p>Synthetic example for workflow education. A source ruling does not approve or execute a task.</p></section></div>`;
  $('#dashboard-content').innerHTML = `<div class="dashboard-grid">
    <div class="dashboard-tile"><span>CASE</span><strong>${title}</strong></div>
    <div class="dashboard-tile"><span>RECORDED DISPOSITION</span><strong>${escapeText(heading(result.status))}</strong></div>
    <div class="dashboard-tile"><span>SELECTION</span><strong>${review ? 'Withheld' : 'Verified synthetic selection'}</strong></div>
    </div><p class="dashboard-copy">${explanation} The Book and dashboard in this simulation use the same selected scenario.</p>
    <p class="dashboard-copy">No model call, production message, new audit, approval or task effect occurs on this page.</p>`;
}
function setView(view) {
  const dashboard = view === 'dashboard';
  $('#chamber').hidden = dashboard;
  $('.case-panel').hidden = dashboard;
  $('#dashboard').hidden = !dashboard;
  $$('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
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
$$('.case-choice').forEach(button => button.addEventListener('click', () => selectCase(button.dataset.case)));
$$('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('#run-review').addEventListener('click', runScenario);
$('#book-open').addEventListener('click', () => openDialog('book-dialog'));
$('#outcome-book').addEventListener('click', () => openDialog('book-dialog'));
$('#dashboard-book').addEventListener('click', () => openDialog('book-dialog'));
$('#about-open').addEventListener('click', () => openDialog('about-dialog'));
$$('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.close)));
$$('dialog').forEach(dialog => dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus(); }));
renderLedger();