import React, {useEffect, useState} from 'react';
import fixture from './rehearsal.json';

const caseIds = ['synthetic-a', 'synthetic-b'];
const titles = {'synthetic-a': 'Matching sources', 'synthetic-b': 'Source mismatch'};
const lines = {
  read: {
    'synthetic-a': 'The two scrolls bear the same study seal.',
    'synthetic-b': 'Your Majesty, this scroll came from another study.',
  },
  submit: {
    'synthetic-a': 'I propose we show the verified selection.',
    'synthetic-b': 'I move that we call for review.',
  },
  ruling: {
    'synthetic-a': 'Motion carried. Show the verified selection.',
    'synthetic-b': 'Review required. The motion is tabled.',
  },
};

// Each tool step follows the sealed trace order. A ruling is a separate
// presentation beat for that submit's verified audit response, as checked by
// prepare-rehearsal.py. Recheck both cases if the projection changes.
const steps = fixture.events.flatMap(event => {
  if (!event.response) return [{...event, kind: 'read', seat: 'codex'}];
  return [
    {caseId: event.caseId, tool: event.tool, kind: 'submit', seat: 'codex'},
    {caseId: event.caseId, response: event.response, kind: 'ruling', seat: 'iris'},
  ];
});

export function useRehearsal() {
  const [cursor, setCursor] = useState(-1);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      if (cursor === steps.length - 1) setRunning(false);
      else setCursor(cursor + 1);
    }, 2250);
    return () => window.clearTimeout(timer);
  }, [cursor, running]);

  const seen = steps.slice(0, cursor + 1);
  const caseId = selected ?? seen.at(-1)?.caseId ?? caseIds[0];
  const timeline = seen.filter(event => event.caseId === caseId);
  const facts = timeline.find(event => event.kind === 'read');
  const result = timeline.findLast(event => event.kind === 'ruling')?.response;
  const spoken = timeline.at(-1);
  const bubble = spoken && {seat: spoken.seat, text: lines[spoken.kind][caseId]};
  const approved = result?.status === 'ACCEPTED' && result.action === 'SHOW_VERIFIED'
    && result.caseId === caseId && result.semanticId === 'synthetic.structure.001'
    && Boolean(facts) && facts.ctStudy === facts.segStudy;

  return {
    running, started: cursor >= 0, caseId, timeline, facts, result, bubble, approved,
    start() {
      setSelected(null);
      setCursor(0);
      setRunning(true);
    },
    select(id) { setSelected(id); },
    available(id) { return seen.some(event => event.caseId === id); },
  };
}

export function CaseSwitch({session, onSelect}) {
  return <div className="case-switch" role="group" aria-label="Synthetic case">
    {caseIds.map(id => <button type="button" key={id} data-testid={'case-' + id} aria-pressed={session.caseId === id}
      disabled={session.running || !session.available(id)}
      onClick={() => { session.select(id); onSelect(); }}>{titles[id]}</button>)}
  </div>;
}

export function Ledger({session}) {
  const {caseId, facts, result, timeline} = session;
  const live = session.mode === 'live';
  const verdict = session.sourceVerified ? 'Source selection verified' : 'Review required';
  const task = session.task;
  return <div className="ledger-pages" data-case={caseId} data-request-id={session.run?.requestId ?? ''}
    data-testid="session-ledger" data-source-verified={Boolean(session.sourceVerified)}
    data-audit-id={result?.auditId ?? ''} data-interop-session={session.run?.interop?.sessionId ?? ''}
    data-semantic-id={result?.semanticId ?? ''}>
    <section className="ledger-page" aria-labelledby="ledger-case">
      <p className="ledger-kicker">Case and proceedings</p>
      <h3 id="ledger-case">{titles[caseId]}</h3>
      <p className="ledger-case-id">{caseId}</p>
      <p className="ledger-origin">{live ? 'Live IRIS session · native AI Hub' : 'Recorded Codex rehearsal'}</p>
      {live && <dl className="ledger-facts">
        <dt>Agent</dt><dd>Native AI Hub · gpt-oss:20b</dd>
        <dt>Caller</dt><dd>{session.actor || 'Awaiting authenticated session'}</dd>
        {session.run && <><dt>Request</dt><dd>{session.run.requestId}</dd></>}
      </dl>}
      {facts && <dl className="ledger-facts">
        <dt>Source image</dt><dd>{facts.ctStudy}</dd>
        <dt>Segmentation</dt><dd>{facts.segStudy}</dd>
      </dl>}
      {timeline.length ? <ol className="ledger-timeline">
        {timeline.map(event => <li key={event.kind}>
          <strong>{event.seat === 'codex' ? 'Sir Codex' : event.seat === 'native' ? 'Native AI Hub' : 'IRIS'}</strong>
          <span>{event.tool ?? 'Ruling recorded'}</span>
        </li>)}
      </ol> : <p>{live ? 'Explicitly request a review to enter a verified response in the ledger.' : 'Run the rehearsal to enter the case in the ledger.'}</p>}
      {live && session.failedRuns?.length > 0 && <section aria-label="Failed requests" data-testid="failed-history">
        <h4>Failed requests · retained history</h4>
        <p>These attempts produced no verified selection or task approval.</p>
        <ul>{session.failedRuns.map(failed => <li key={failed.requestId}>
          {failed.caseId} · {failed.requestId} · {failed.response.status} · audit {failed.response.auditId} · IRIS session {failed.interop.sessionId}
        </li>)}</ul>
      </section>}
      {live && session.running && <p className="ledger-pending" role="status">A live request is pending. Source selection is withheld.</p>}
      {session.error && <p className="ledger-error" role="alert">{session.error}</p>}
    </section>
    <section className="ledger-page" aria-labelledby="ledger-ruling">
      <p className="ledger-kicker">Evidence and ruling</p>
      <h3 id="ledger-ruling">{result ? 'The IRIS disposition' : 'Awaiting IRIS'}</h3>
      {result ? <>
        <p className="ledger-verdict" data-status={session.sourceVerified ? 'accepted' : 'review_requested'}>{verdict}</p>
        <p>{result.explanation}</p>
        <ul className="ledger-citations" aria-label="Citations">
          {result.citations.map(ref => <li key={ref}>{ref}</li>)}
        </ul>
        <dl className="ledger-facts"><dt>Audit ID</dt><dd data-audit-id={result.auditId}>{result.auditId}</dd></dl>
        <p className="source-note">{result.limitation}</p>
        {live && <dl className="ledger-facts"><dt>IRIS session</dt><dd>{session.run.interop.sessionId}</dd>
          <dt>Message</dt><dd>{session.run.interop.requestHeaderId} → {session.run.interop.responseHeaderId}</dd></dl>}
      </> : <p>{live ? 'The validated response, citations and persisted audit identity appear here after service verification.' : 'The recorded decision, citations, and audit ID appear here when the council reaches its ruling.'}</p>}
      {live && <section className="operator-task" data-task-state={task?.available ? task.status : 'UNAVAILABLE'}>
        <h4>Operator task · separate authority</h4>
        {task?.available ? <dl className="ledger-facts">
          <dt>Task state</dt><dd>{task.status}</dd>
          <dt>Revisions</dt><dd>Task {task.revision} · evidence {task.evidenceRevision}</dd>
          <dt>Proposed by</dt><dd>{task.proposedBy || 'Not recorded'}</dd>
          <dt>Approval</dt><dd>{task.approval?.approvalId ? `${task.approval.approvedBy} · ${task.approval.approvalId}` : 'Awaiting explicit operator approval'}</dd>
          {task.execution?.operationId && <><dt>Execution</dt><dd>{task.execution.operationId} · {task.execution.executedBy}</dd></>}
        </dl> : <p>Operator task state is unavailable. Source acceptance alone grants no task approval.</p>}
        <p className="source-note">Task changes remain authenticated operator operations. This view reads their actual state.</p>
      </section>}
    </section>
  </div>;
}
