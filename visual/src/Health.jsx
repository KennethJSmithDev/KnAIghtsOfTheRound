import {useEffect, useRef, useState} from 'react';
import './health.css';

const sourceId = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value);

async function exchange(path, body, signal) {
  const response = await fetch(`/api/health/${path}`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
    headers: body ? {'Content-Type': 'application/json', 'X-KotR-Request': '1'} : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(response.status === 401 ? 'Unlock health inspection with the local operator grant.'
      : value.error === 'HEALTH_NOT_CONFIGURED' ? 'Health sources are not configured for this local viewer.'
        : response.status === 403 ? 'This account cannot inspect the selected source.'
          : 'Health state is unavailable. Refresh to reconcile before another capture.');
    error.unlock = response.status === 401;
    throw error;
  }
  return value;
}

export function validateHealthState(value, selected, actor) {
  if (value?.apiVersion !== 1 || value.scope !== 'synthetic' || value.sourceId !== selected
      || value.actor !== actor || !['NO_INSPECTION', 'PENDING', 'COMPLETE'].includes(value.status)) {
    throw new Error('The health service returned an unsupported source state.');
  }
  if (value.status === 'COMPLETE') {
    const receipt = value.receipt;
    if (!Number.isInteger(value.recordId) || value.recordId < 1 || receipt?.recordId !== value.recordId
        || receipt.sourceId !== selected || receipt.actor !== actor || receipt.dataClass !== 'synthetic'
        || typeof receipt.status !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.sourceProfileSha256 ?? '')
        || !Array.isArray(receipt.objects) || !receipt.projection || Array.isArray(receipt.projection)
        || receipt.objects.some(object => !/^[a-f0-9]{64}$/.test(object.sha256 ?? '')
          || !Number.isInteger(object.bytes) || object.bytes < 0)) {
      throw new Error('The health observation failed source, actor or archive identity validation.');
    }
  }
  return value;
}

export default function Health({onClose, onObservation}) {
  const dialog = useRef(null);
  const epoch = useRef(0);
  const controller = useRef(null);
  const busy = useRef(false);
  const [catalog, setCatalog] = useState(null);
  const [selected, setSelected] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [error, setError] = useState('');
  const [unlock, setUnlock] = useState(false);
  const [token, setToken] = useState('');

  useEffect(() => {
    dialog.current.showModal();
    return () => { ++epoch.current; controller.current?.abort(); };
  }, []);

  async function discover() {
    setPhase('loading'); setError('');
    try {
      const value = await exchange('sources');
      if (value.apiVersion !== 1 || value.status !== 'OK' || value.scope !== 'synthetic'
          || typeof value.actor !== 'string' || !Array.isArray(value.sources)
          || value.sources.some(item => !sourceId(item.sourceId) || item.dataClass !== 'synthetic')) {
        throw new Error('The health service returned an unsupported catalog.');
      }
      setCatalog(value); setUnlock(false);
      let saved;
      try { saved = sessionStorage.getItem('kotr-health-source'); } catch { /* Storage is optional. */ }
      setSelected(value.sources.some(item => item.sourceId === saved) ? saved : value.sources[0]?.sourceId ?? '');
      setPhase('ready');
    } catch (failure) { setError(failure.message); setUnlock(Boolean(failure.unlock)); setPhase('unavailable'); }
  }

  useEffect(() => { discover(); }, []);

  async function read(capture = false) {
    if (!catalog || !selected || busy.current) return;
    const current = ++epoch.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    busy.current = true; setPhase(capture ? 'capturing' : 'loading'); setError('');
    try {
      const value = validateHealthState(await exchange(capture ? 'inspect' : 'state', {
        sourceId: selected, ...(capture ? {requestId: crypto.randomUUID()} : {}),
      }, abort.signal), selected, catalog.actor);
      if (current !== epoch.current) return;
      setSnapshot(value); setPhase('ready'); onObservation(value.receipt ?? null);
    } catch (failure) {
      // A delayed failure from another source must not erase a newer observation.
      if (current !== epoch.current || abort.signal.aborted) return;
      setSnapshot(null); onObservation(null); setPhase('unavailable'); setError(failure.message);
    } finally {
      if (current === epoch.current) busy.current = false;
    }
  }

  useEffect(() => {
    ++epoch.current; controller.current?.abort(); busy.current = false;
    setSnapshot(null); onObservation(null);
    if (selected) {
      try { sessionStorage.setItem('kotr-health-source', selected); } catch { /* Storage is optional. */ }
      read();
    }
  }, [selected, catalog]);

  async function authorize(event) {
    event.preventDefault(); setError('');
    try { await exchange('unlock', {token}); setToken(''); await discover(); }
    catch (failure) { setToken(''); setError(failure.message); }
  }

  const waiting = ['loading', 'capturing'].includes(phase);
  const canCapture = !waiting && ['NO_INSPECTION', 'COMPLETE'].includes(snapshot?.status);
  const receipt = snapshot?.receipt;
  return <dialog ref={dialog} className="health-dialog" onCancel={event => { event.preventDefault(); onClose(); }}
    aria-labelledby="health-title" data-testid="health-panel">
    <div className="health-heading"><h2 id="health-title">Health sources</h2>
      <button data-testid="health-close" onClick={onClose}>Close</button></div>
    <p>Synthetic source inspection. This does not approve evidence, clinical use, Workflow review or task execution.</p>
    {unlock && <form onSubmit={authorize}>
      <label>Local health-inspection grant<input data-testid="health-token" type="password" autoComplete="off"
        value={token} onChange={event => setToken(event.target.value)} /></label>
      <button data-testid="health-unlock" disabled={!token}>Unlock health inspection</button>
    </form>}
    {!catalog && !unlock && phase === 'unavailable' && <button onClick={discover}>Reconnect health service</button>}
    {catalog && <>
      <label>Configured source<select data-testid="health-source" value={selected} disabled={phase === 'capturing'}
        onChange={event => setSelected(event.target.value)}>
        {catalog.sources.map(item => <option key={item.sourceId} value={item.sourceId}>{item.sourceId} · {item.kind}</option>)}
      </select></label>
      {!catalog.sources.length && <p>No sources are granted to this account.</p>}
      <div className="health-actions">
        <button data-testid="health-refresh" disabled={waiting || !selected} onClick={() => read()}>Refresh retained state</button>
        <button data-testid="health-inspect" disabled={!canCapture} onClick={() => read(true)}>Capture source observation</button>
      </div>
      <p data-testid="health-state" role="status">{phase === 'capturing' ? 'Inspection in progress. Its receipt will be reconciled from IRIS.'
        : waiting ? 'Loading source state…' : snapshot?.status === 'NO_INSPECTION' ? 'No inspection has been recorded.'
          : snapshot?.status === 'PENDING' ? 'An inspection is pending. Refresh without repeating it.'
            : receipt ? `Observation ${receipt.recordId} · ${receipt.status}` : 'Source state could not be retrieved.'}</p>
    </>}
    {error && <p className="health-error" role="alert">{error}</p>}
    {receipt && <div className="health-receipt">
      <p>Source: <strong>{receipt.sourceId}</strong> · Actor: {receipt.actor}</p>
      {receipt.projection.ackCode && <p>Native transport outcome: {receipt.projection.state} · ACK {receipt.projection.ackCode}</p>}
      <pre data-testid="health-projection">{JSON.stringify(receipt.projection, null, 2)}</pre>
      <p>{receipt.objects.length} archived objects · Profile SHA-256: <code>{receipt.sourceProfileSha256}</code></p>
      {receipt.objects.map((object, index) => <p key={index}><code>{object.sha256}</code> · {object.bytes} bytes
        {object.etag ? ` · ETag ${object.etag}` : ''}</p>)}
      <p>Recorded observation at {receipt.capturedAt}. A state refresh does not read the source again.</p>
    </div>}
  </dialog>;
}
