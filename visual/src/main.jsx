import React, {Suspense, lazy, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CaseSwitch, Ledger} from './Rehearsal.jsx';
import {useSession} from './Session.jsx';
import './style.css';
import './rehearsal.css';
import './live.css';
import './mobile.css';

// The retained 3D scene is loaded only on request for compact/touch screens.
// Its original demand-driven rendering and asset ownership remain unchanged.
const Chamber3D = lazy(() => import('./Chamber3D.jsx'));
const Health = lazy(() => import('./Health.jsx'));
const seatsHref = (() => {
  try {
    const url = new URL(import.meta.env.VITE_KOTR_SEATS_URL);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port
      && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash ? url.href : '';
  } catch { return ''; }
})();

function HealthReceipt({receipt}) {
  if (!receipt) return null;
  return <section className="book-health-receipt" data-testid="book-health-receipt">
    <h3>Last health-source observation</h3>
    <p>{receipt.sourceId} · Receipt {receipt.recordId} · {receipt.status}</p>
    <p>Source inspection is separate from case acceptance, Workflow review and task execution.</p>
    <pre>{JSON.stringify(receipt.projection, null, 2)}</pre>
    <p>Actor: {receipt.actor} · Recorded {receipt.capturedAt}</p>
  </section>;
}

function ReceiptDialog({session, healthReceipt, onClose, returnFocus}) {
  const dialog = useRef(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = returnFocus.current ?? document.activeElement;
    dialog.current?.querySelector('button')?.focus();
    // Header refresh may own focus while the Book stays open. Capture its keys
    // only for this mounted dialog; closed-book controls keep normal behavior.
    function handleKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (!dialog.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <>
    <div className="book-backdrop" onClick={onClose} />
    <section ref={dialog} className="book-dialog" role="dialog" aria-modal="true"
      aria-labelledby="book-title">
      <div className="book-heading">
        <div><h2 id="book-title">Book of Receipts</h2>
          <p>{session.mode === 'live' ? 'Live service evidence · operator authority recorded separately' : 'Recorded synthetic rehearsal'}</p></div>
        <button className="book-close" data-testid="close-book" onClick={onClose}>Close book</button>
      </div>
      <Ledger session={session} />
      {session.mode === 'live' && <HealthReceipt receipt={healthReceipt} />}
    </section>
  </>;
}

function App() {
  const session = useSession();
  const [view, setView] = useState('arthur');
  const [lightweight, setLightweight] = useState(() => window.matchMedia('(max-width: 760px), (pointer: coarse)').matches);
  const [dashboard, setDashboard] = useState(false);
  const [book, setBook] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [healthReceipt, setHealthReceipt] = useState(null);
  const [ready, setReady] = useState(false);
  const [nrx, setNrx] = useState(false);
  const [nrxStatus, setNrxStatus] = useState('loading');
  const bubbleRef = useRef(null);
  // The opener is hidden while its Book is open; retain its identity before focus moves.
  const bookTrigger = useRef(null);
  useEffect(() => { setReady(lightweight); }, [lightweight]);

  // The admitted case response controls the case projection. Health observations
  // and the NRX reference retain their separate source and authority labels.
  let projection = session.mode === 'replay' && !session.started ? 'mockup' : 'waiting';
  if (session.sourceVerified) projection = 'verified';
  else if (session.result) projection = 'withheld';
  if (nrx) projection = 'nrx';

  const projectionLabel = {
    mockup: 'Viewer mockup',
    verified: 'Source selection verified · synthetic fixture',
    withheld: 'Selection withheld for review',
    waiting: session.error ? 'Result unavailable · selection withheld' : session.running ? 'Native review pending · selection withheld' : 'Awaiting verified service evidence',
    nrx: nrxStatus === 'ready' ? 'NRX retained reference · HRA right ovary'
      : nrxStatus === 'unavailable' ? 'NRX reference unavailable' : 'Loading the NRX reference',
  }[projection];

  return <main className="stage" data-figures-ready={ready} data-projection={projection}
    data-session-mode={session.mode} data-render-mode={lightweight ? 'lightweight' : 'detailed'} data-request-id={session.run?.requestId ?? ''}>
    <header>
      <div className="identity">
        <div className="seal" aria-hidden="true">{lightweight ? <svg viewBox="0 0 40 40"><path d="M20 2 35 9v12c0 9-6 14-15 17C11 35 5 30 5 21V9Z"/><path d="M20 8v21M11 16h18M14 25l6 6 6-6"/></svg> : <img src="./assets/brand/kotr-logo.png" alt="" />}</div>
        <div><p className="overline">KnAIghts of the Round</p>
          <h1>{dashboard ? 'Case dashboard' : 'The council chamber'}</h1></div>
      </div>
      <div className="council-toolbar">
        <button data-testid="open-health" disabled={session.mode !== 'live'} onClick={() => setHealthOpen(true)}>Health sources</button>
        {seatsHref && <a className="seat-workspace-link" href={seatsHref} target="_blank" rel="noopener noreferrer">Seats &amp; accounts</a>}
        <nav className="session-nav" aria-label="Session source">
          <button data-testid="mode-live" disabled={session.running} aria-pressed={session.mode === 'live'} onClick={() => { setBook(false); setNrx(false); session.setMode('live'); }}>Live IRIS</button>
          <button data-testid="mode-replay" disabled={session.running} aria-pressed={session.mode === 'replay'} onClick={() => { setBook(false); setNrx(false); session.setMode('replay'); }}>Recorded replay</button>
        </nav>
        <nav className="mode-nav" aria-label="Workspace mode">
          <button data-testid="workspace-roundtable" aria-pressed={!dashboard} onClick={() => { setBook(false); setDashboard(false); }}>Round Table</button>
          <button data-testid="workspace-dashboard" aria-pressed={dashboard} onClick={() => { setBook(false); setDashboard(true); }}>Dashboard</button>
        </nav>
        {!dashboard && !lightweight && <nav aria-label="Camera view">
          <button aria-pressed={view === 'arthur'} onClick={() => setView('arthur')}>Arthur’s chair</button>
          <button aria-pressed={view === 'overview'} onClick={() => setView('overview')}>Table layout</button>
        </nav>}
        {!dashboard && <button data-testid="render-mode" aria-pressed={lightweight} onClick={() => { setNrx(false); setLightweight(value => !value); }}>Lightweight view</button>}
        {session.mode === 'live' && <button className="refresh-session" data-testid="refresh-session"
          disabled={session.phase === 'loading' || session.phase === 'submitting'} onClick={session.refresh}>Refresh · read only</button>}
        <button className="run-rehearsal" data-testid="run-session" disabled={session.mode === 'live' ? !session.canStart : session.running}
          onClick={() => { setNrx(false); session.start(); }}>
          {session.mode === 'live' ? session.running ? 'Request in progress' : 'Request native review' : session.running ? 'Rehearsal running' : 'Run recorded rehearsal'}
        </button>
      </div>
    </header>
    {dashboard ? <div className="dashboard"><div className="dashboard-card">
      <Ledger session={session} />
      {session.mode === 'live' && <HealthReceipt receipt={healthReceipt} />}
    </div></div> : <div className={"viewport" + (book ? " book-open" : "")} aria-label="Round Table chamber">
      {lightweight ? <div className="lightweight-chamber" data-testid="lightweight-chamber">
        <img src={`${import.meta.env.BASE_URL}assets/brand/chamber-lite-${projection === 'verified' ? 'verified' : 'withheld'}.svg`}
          alt="Illustrated Round Table with council seats and the Book of Receipts" />
      </div> : <Suspense fallback={<div className="chamber-loading" role="status">Loading the detailed chamber…</div>}>
        <Chamber3D view={view} onReady={setReady} onOpenBook={() => setBook(true)} projection={projection}
          onNrxStatus={setNrxStatus} bubble={session.bubble} bubbleRef={bubbleRef} />
      </Suspense>}
      <div className="projection-tools">
        <span className="projection-mode" role="status">{projectionLabel}</span>
        <button disabled={session.running} aria-pressed={nrx} onClick={() => {
          if (!nrx) { setNrxStatus('loading'); if (lightweight) setLightweight(false); }
          setNrx(!nrx);
        }}>{nrx ? 'Return to council projection' : lightweight ? 'Show NRX reference in 3D' : 'Show NRX reference'}</button>
        {nrx && <a className="source-note" href="./assets/nrx-reference/ATTRIBUTION.txt"
          target="_blank" rel="noreferrer">Source and attribution</a>}
      </div>
      {session.bubble && <div ref={bubbleRef} className={'speaker-bubble ' + session.bubble.seat + (lightweight ? ' light-bubble' : '')}
        aria-live="polite">
        <strong>{session.bubble.label ?? (session.bubble.seat === 'codex' ? 'Sir Codex · recorded' : 'IRIS · recorded')}</strong>
        <p>{session.bubble.text}</p>
      </div>}
      <button ref={bookTrigger} className="book-trigger" hidden={book} data-testid="open-book" onClick={() => setBook(true)}>Open Book of Receipts</button>
      {book && <ReceiptDialog session={session} healthReceipt={healthReceipt} onClose={() => setBook(false)} returnFocus={bookTrigger} />}
    </div>}
    <footer>
      <span className={'session-state ' + (session.mode === 'live' ? session.phase : 'recorded')} role="status">
        {session.mode === 'live' ? session.error || `Live IRIS · ${session.phase} · explicit native requests only` : 'Recorded rehearsal · sealed synthetic cases'}
      </span>
      <CaseSwitch session={session} onSelect={() => setNrx(false)} />
    </footer>
    {healthOpen && <Suspense fallback={<p role="status">Loading health-source controls…</p>}>
      <Health onClose={() => setHealthOpen(false)} onObservation={setHealthReceipt} />
    </Suspense>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
