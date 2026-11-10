import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';

const statuses = new Set(['NOT_REQUESTED', 'QUEUED', 'PENDING', 'DECISION_PENDING', 'COMPLETED',
  'SUBMISSION_UNCERTAIN', 'DECISION_UNCERTAIN', 'WORKLIST_UNAVAILABLE', 'WORKLIST_AMBIGUOUS',
  'INDEX_UNAVAILABLE', 'LIVE_RUN_UNAVAILABLE', 'MISMATCH_REQUIRED', 'CORRELATION_MISMATCH', 'BUSY', 'DENIED']);

async function exchange(path, body) {
  const response = await fetch('/api/operator/' + path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: {'Content-Type': 'application/json', 'X-KotR-Request': '1'}, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(response.status === 401 ? 'Operator access is required.' : `Workflow service HTTP ${response.status}.`);
  return response.json();
}

// The access key unlocks a separate local operator session. Reads and case
// changes never enqueue or decide a task; only the explicit buttons do so.
export function useWorkflow(run, enabled) {
  const [unlocked, setUnlocked] = useState(false);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unlocking = useRef(false);
  const requestId = run?.requestId ?? '';
  const current = useRef({id: requestId});
  // A request ID can be selected again after a case switch. Give each
  // committed selection its own identity so older replies cannot mutate it.
  useLayoutEffect(() => { current.current = {id: requestId}; }, [requestId]);
  const isCurrent = (selection, id) => current.current === selection && selection.id === id;
  useEffect(() => {
    let active = true;
    const selection = current.current;
    setState(null); setError('');
    if (unlocked && requestId) {
      setBusy(true);
      read(requestId, selection).catch(failure => { if (active && isCurrent(selection, requestId)) setError(failure.message); })
        .finally(() => { if (active && isCurrent(selection, requestId)) setBusy(false); });
    } else if (!requestId && !unlocking.current) setBusy(false);
    return () => { active = false; };
  }, [requestId, unlocked]);

  async function read(id = requestId, selection = current.current) {
    const next = await exchange('status', {requestId: id});
    if (!statuses.has(next.status)) throw new Error('The Workflow service returned an unsupported state.');
    if (['PENDING', 'DECISION_PENDING', 'COMPLETED'].includes(next.status)
        && (Number(next.auditId) !== run?.response?.auditId || typeof next.summary !== 'string' || next.summary.length > 700)) {
      throw new Error('The Workflow task did not match this live audit.');
    }
    if (next.status === 'COMPLETED') {
      const notice = next.notice;
      if (!['PENDING', 'RECORDED', 'UNAVAILABLE', 'INVALID'].includes(notice?.status)
          || (notice.status === 'RECORDED' && (Number(notice.auditId) !== Number(next.auditId)
            || String(notice.taskId) !== String(next.taskId) || notice.action !== next.action
            || notice.reviewer !== next.reviewer || notice.effect !== 'NOTICE_ONLY'
            || !/^[a-f0-9]{64}$/.test(notice.evidenceHash)))) {
        throw new Error('The notice did not match this Workflow review.');
      }
    }
    if (isCurrent(selection, id)) setState(next);
    return next;
  }
  async function unlock(token) {
    if (unlocking.current) return false;
    unlocking.current = true;
    setBusy(true); setError('');
    try {
      await exchange('unlock', {token});
      setUnlocked(true);
      return true;
    } catch (failure) { setError(failure.message); return false; }
    finally { unlocking.current = false; setBusy(false); }
  }
  async function refresh() {
    const id = requestId, selection = current.current;
    if (!id || !isCurrent(selection, id)) return;
    setBusy(true); setError('');
    try { await read(id, selection); }
    catch (failure) { if (isCurrent(selection, id)) { setState(null); setError(failure.message); } }
    finally { if (isCurrent(selection, id)) setBusy(false); }
  }
  async function act(path, action) {
    const id = requestId, selection = current.current;
    if (!id || !isCurrent(selection, id)) return;
    setBusy(true); setError('');
    try {
      const next = await exchange(path, action ? {requestId: id, action} : {requestId: id});
      if (!statuses.has(next.status)) throw new Error('The Workflow service returned an unsupported state.');
      if (!isCurrent(selection, id)) return;
      if (next.status === 'COMPLETED') await read(id, selection);
      else setState(next);
      if (['QUEUED', 'DECISION_PENDING', 'COMPLETED'].includes(next.status)) {
        for (let attempt = 0; attempt < 20 && isCurrent(selection, id); attempt++) {
          await new Promise(resolve => window.setTimeout(resolve, 250));
          if (!isCurrent(selection, id)) break;
          const observed = await read(id, selection);
          if (!['QUEUED', 'DECISION_PENDING'].includes(observed.status) && !(observed.status === 'COMPLETED' && observed.notice?.status === 'PENDING')) break;
        }
      }
    } catch (failure) { if (isCurrent(selection, id)) { setState(null); setError(failure.message); } }
    finally { if (isCurrent(selection, id)) setBusy(false); }
  }
  return {enabled, unlocked, state, busy, error, unlock, refresh,
    queue: () => act('queue'), decide: action => act('decision', action)};
}

export function WorkflowPanel({session}) {
  const workflow = session.workflow;
  const [token, setToken] = useState('');
  if (!workflow?.enabled) return null;
  const eligible = session.run?.caseId === 'synthetic-b' && session.result?.status === 'REVIEW_REQUESTED';
  const status = workflow.state?.status;
  return <section className="operator-workflow" data-testid="operator-workflow" aria-labelledby="workflow-title">
    <h4 id="workflow-title">Synthetic Workflow review</h4>
    <p>Related cases are advisory. A review choice does not approve or execute the separate operator task.</p>
    {!eligible ? <p>Select a completed live source mismatch. Reviewing the matching case first provides related context.</p>
      : !workflow.unlocked ? <form onSubmit={async event => { event.preventDefault(); if (await workflow.unlock(token)) setToken(''); }}>
        <label htmlFor="operator-key">Operator access key</label>
        <input id="operator-key" data-testid="operator-key" type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" required />
        <button data-testid="operator-unlock" type="submit" disabled={workflow.busy}>Unlock review controls</button>
      </form> : <>
        {!status && !workflow.error && <p role="status">Retrieving Workflow state.</p>}
        {status === 'NOT_REQUESTED' && <><p data-testid="workflow-not-created">No Workflow review task has been created for this audit.</p>
          <button data-testid="workflow-queue" disabled={workflow.busy} onClick={workflow.queue}>Create review task</button></>}
        {status === 'PENDING' && <p data-testid="workflow-pending">Workflow task awaiting review.</p>}
        {['QUEUED', 'DECISION_PENDING'].includes(status) && <p role="status">{status === 'QUEUED' ? 'Preparing related context and the worklist item.' : 'Recording the review choice.'}</p>}
        {['PENDING', 'DECISION_PENDING', 'COMPLETED'].includes(status) && <>
          <p data-testid="workflow-context">{workflow.state.summary}</p>
          <p>Workflow task {workflow.state.taskId} · audit {workflow.state.auditId}</p>
        </>}
        {status === 'PENDING' && <div className="workflow-actions">
          <button data-testid="workflow-reviewed" disabled={workflow.busy} onClick={() => workflow.decide('KnAIghtsReviewed')}>Record reviewed</button>
          <button data-testid="workflow-declined" disabled={workflow.busy} onClick={() => workflow.decide('KnAIghtsDeclined')}>Record declined</button>
        </div>}
        {status === 'COMPLETED' && <>
          <p data-testid="workflow-completed">Review completed: {workflow.state.action === 'KnAIghtsReviewed' ? 'Reviewed' : 'Declined'} · {workflow.state.reviewer}</p>
          {workflow.state.notice?.status === 'RECORDED' ? <div data-testid="workflow-notice">
            <p>Notice recorded · notice only · audit {workflow.state.notice.auditId} · task {workflow.state.notice.taskId}</p>
            <details><summary>Evidence checksum</summary><code>{workflow.state.notice.evidenceHash}</code><p>This checksum is an integrity aid, not a signature or task approval.</p></details>
          </div> : <p data-testid="workflow-notice-state" role="status">{workflow.state.notice?.status === 'PENDING' ? 'Review completed; notice not yet confirmed. Refresh to check.' : 'Review completed; the notice could not be verified. Reconcile before retrying.'}</p>}
        </>}
        {status && !['NOT_REQUESTED', 'QUEUED', 'PENDING', 'DECISION_PENDING', 'COMPLETED'].includes(status) && <p role="alert">Workflow state: {status.replaceAll('_', ' ').toLowerCase()}. Reconcile before retrying.</p>}
        {((status && status !== 'NOT_REQUESTED') || workflow.error) && <button data-testid="workflow-refresh" disabled={workflow.busy} onClick={workflow.refresh}>Refresh review state</button>}
      </>}
    {workflow.error && <p role="alert">{workflow.unlocked ? 'Workflow state could not be retrieved. ' : ''}{workflow.error}</p>}
  </section>;
}
