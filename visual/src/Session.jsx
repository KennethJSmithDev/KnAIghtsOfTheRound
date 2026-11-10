import {useEffect, useRef, useState} from 'react';
import {useRehearsal} from './Rehearsal.jsx';
import {useWorkflow} from './Workflow.jsx';

const cases = ['synthetic-a', 'synthetic-b'];
const references = ['ImagingStudy/example-ct', 'ImagingSelection/example-segment'];
const exactReferences = value => Array.isArray(value) && JSON.stringify(value) === JSON.stringify(references);
const recordId = value => /^[1-9][0-9]*$/.test(String(value));

// A single admitted snapshot feeds the book, dashboard and projector. COMPLETE
// comes from the broker's persisted response/audit/message reconciliation.
export function validateSnapshot(snapshot) {
  if (snapshot?.apiVersion !== 1 || snapshot.status !== 'OK' || !snapshot.runtime
      || typeof snapshot.runtime.running !== 'boolean' || typeof snapshot.runtime.liveEnabled !== 'boolean'
      || !/Build\s*154/.test(snapshot.runtime.version ?? '')
      || typeof snapshot.caller?.principal !== 'string' || !snapshot.caller.principal
      || snapshot.caller.operatorUse !== false || !Array.isArray(snapshot.runs)) {
    throw new Error('The live service returned an unsupported session envelope.');
  }
  for (const run of snapshot.runs) {
    if (!cases.includes(run.caseId) || !/^[A-Za-z0-9_-]{1,64}$/.test(run.requestId ?? '')
        || !['COMPLETE', 'RUNNING', 'ERROR'].includes(run.status)) {
      throw new Error('The live service returned an invalid request identity.');
    }
    if (run.status !== 'COMPLETE') continue;
    const {facts, response, interop, agent} = run;
    const sourceMatches = facts?.ctStudy === facts?.segStudy;
    const accepted = response?.status === 'ACCEPTED' && response.action === 'SHOW_VERIFIED'
      && response.semanticId === 'synthetic.structure.001' && sourceMatches;
    const review = response?.status === 'REVIEW_REQUESTED' && response.action === 'REQUEST_REVIEW'
      && response.semanticId === '';
    // A completed transport can carry a failed provider disposition. Admit only
    // this exact empty, source-bound failure shape; never treat it as a ruling.
    // The retained failed-then-valid native history exercises this boundary.
    const providerFailure = response?.status === 'PROVIDER_ERROR'
      && response.action === '' && response.semanticId === ''
      && response.explanation === '' && Array.isArray(response.citations)
      && response.citations.length === 0;
    const dispositionValid = providerFailure || ((accepted || review)
      && exactReferences(response.citations)
      && typeof response.explanation === 'string' && response.explanation.trim());
    if (agent?.kind !== 'native-ai-hub' || agent.model !== 'gpt-oss:20b'
        || facts?.kind !== 'synthetic' || facts.ctStudy !== 'urn:example:study-a'
        || facts.segStudy !== (run.caseId === 'synthetic-a' ? 'urn:example:study-a' : 'urn:example:study-b')
        || !exactReferences(facts.evidenceRefs) || response?.caseId !== run.caseId
        || !Number.isInteger(response.auditId) || response.auditId < 1
        || response.limitation !== 'Synthetic example for workflow education.'
        || interop?.status !== 'VERIFIED'
        || ![interop?.sessionId, interop?.requestHeaderId, interop?.responseHeaderId, interop?.responseBodyId].every(recordId)
        || run.actor !== snapshot.caller.principal || !dispositionValid) {
      throw new Error('The live response failed source, citation or persisted-record validation.');
    }
  }
  return snapshot;
}

async function exchange(method, payload, signal) {
  const response = await fetch(method === 'GET' ? '/api/session' : '/api/session/run', {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: method === 'POST' ? {'Content-Type': 'application/json', 'X-KotR-Request': '1'} : {},
    body: payload ? JSON.stringify(payload) : undefined,
    signal,
  });
  if (!response.ok) throw new Error(`Live service HTTP ${response.status}. Refresh to reconcile the request.`);
  return validateSnapshot(await response.json());
}

function useLiveSession() {
  const [snapshot, setSnapshot] = useState(null);
  const [caseId, setCaseId] = useState('synthetic-a');
  const [activeRequest, setActiveRequest] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const activeController = useRef(null);

  async function refresh() {
    const current = ++epoch.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setPhase('loading');
    setError('');
    try {
      const next = await exchange('GET', null, controller.signal);
      if (current !== epoch.current) return;
      setSnapshot(next);
      const unresolved = activeRequest && !next.runs.some(run => run.requestId === activeRequest);
      setPhase(unresolved ? 'uncertain' : 'ready');
      if (unresolved) setError('This request has no reconciled record yet. Refresh before submitting another.');
    } catch (failure) {
      if (current !== epoch.current || controller.signal.aborted) return;
      setSnapshot(null);
      setPhase(activeRequest ? 'uncertain' : 'error');
      setError(failure.message);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    activeController.current = controller;
    const fragment = window.location.hash.slice(1);
    if (fragment) history.replaceState(null, '', window.location.pathname + window.location.search);
    async function connect() {
      try {
        if (fragment) {
          if (!/^[A-Za-z0-9_-]{20,128}$/.test(fragment)) throw new Error('The local session access link is invalid.');
          const response = await fetch('/api/bootstrap', {
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: {'Content-Type': 'application/json', 'X-KotR-Request': '1'},
            body: JSON.stringify({token: fragment}), signal: controller.signal,
          });
          if (!response.ok) throw new Error('Local session authorization failed.');
        }
        if (!controller.signal.aborted) await refresh();
      } catch (failure) {
        if (!controller.signal.aborted) {
          setPhase('error');
          setError(failure.message);
        }
      }
    }
    connect();
    return () => { ++epoch.current; activeController.current?.abort(); };
  }, []);

  const serverBusy = snapshot?.runs.some(run => run.status === 'RUNNING') ?? false;
  const running = phase === 'submitting' || phase === 'uncertain' || serverBusy;

  async function start() {
    if (running || phase === 'loading' || !snapshot?.runtime.running || !snapshot.runtime.liveEnabled) return;
    const current = ++epoch.current;
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    activeController.current?.abort();
    activeController.current = controller;
    setActiveRequest(requestId);
    setSnapshot(null);
    setPhase('submitting');
    setError('');
    try {
      const next = await exchange('POST', {caseId, requestId}, controller.signal);
      if (current !== epoch.current) return;
      if (!next.runs.some(run => run.requestId === requestId && run.caseId === caseId)) {
        throw new Error('The service did not reconcile this exact request. Refresh its state.');
      }
      setSnapshot(next);
      setPhase('ready');
    } catch (failure) {
      if (current !== epoch.current || controller.signal.aborted) return;
      setPhase('uncertain');
      setError(failure.message);
    }
  }

  const matching = snapshot?.runs.filter(run => run.caseId === caseId) ?? [];
  const run = activeRequest ? matching.find(value => value.requestId === activeRequest) : matching.at(-1);
  const completed = phase === 'ready' && run?.status === 'COMPLETE';
  const providerFailed = completed && run.response.status === 'PROVIDER_ERROR';
  const result = completed && !providerFailed ? run.response : null;
  const facts = completed ? run.facts : null;
  const sourceVerified = Boolean(result?.status === 'ACCEPTED' && result.action === 'SHOW_VERIFIED');
  const timeline = result ? [
    {kind: 'native', seat: 'native', tool: 'Native AI Hub review completed'},
    {kind: 'ruling', seat: 'iris', tool: `IRIS audit ${result.auditId} · session ${run.interop.sessionId}`},
  ] : [];
  const runError = providerFailed || (phase === 'ready' && run?.status === 'ERROR');
  const displayedError = error || (providerFailed
    ? 'The provider failed for this request. No selection is displayed; the failed attempt is retained.'
    : runError ? 'IRIS could not validate this request. No selection is displayed.' : '');

  return {
    caseId, snapshot, run, result, facts, timeline, sourceVerified, approved: sourceVerified,
    failedRuns: snapshot?.runs.filter(value => value.status === 'COMPLETE' && value.response.status === 'PROVIDER_ERROR') ?? [],
    running, started: Boolean(activeRequest || run), phase, error: displayedError,
    actor: run?.actor ?? snapshot?.caller.principal ?? '',
    task: snapshot?.task ?? {available: false},
    canStart: !running && phase === 'ready' && snapshot?.runtime.running && snapshot.runtime.liveEnabled
      && snapshot.nativeSubmissions < 2,
    bubble: result ? {seat: 'iris', label: 'IRIS · validated response', text: result.explanation}
      : running ? {seat: 'native', label: 'Native AI Hub · request status', text: 'Waiting for the authorized IRIS response.'} : null,
    start, refresh,
    select(id) {
      if (running || !cases.includes(id)) return;
      setCaseId(id);
      setActiveRequest(null);
      setError('');
    },
    available: () => !running,
  };
}

export function useSession() {
  const [mode, setMode] = useState('live');
  const replay = useRehearsal();
  const live = useLiveSession();
  const workflow = useWorkflow(live.run, Boolean(live.snapshot?.runtime?.contextLive));
  const selected = mode === 'live' ? live : replay;
  return {
    ...selected,
    mode,
    workflow: mode === 'live' ? workflow : null,
    sourceVerified: mode === 'live' ? live.sourceVerified : replay.approved,
    setMode(next) { if (!selected.running) setMode(next); },
  };
}
