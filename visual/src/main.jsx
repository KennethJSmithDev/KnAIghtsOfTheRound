import React, {Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas, useFrame, useLoader, useThree} from '@react-three/fiber';
import {AdditiveBlending, Box3, CanvasTexture, DoubleSide, Group, MeshStandardMaterial, SRGBColorSpace, Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import NrxProjection from './NrxProjection.jsx';
import {CaseSwitch, Ledger} from './Rehearsal.jsx';
import {useSession} from './Session.jsx';
import './style.css';
import './rehearsal.css';
import './live.css';

const seatRadius = 2.15;
const tableModelHeight = 0.98;
const tableHeight = 0.84;
const angles = [0, 0.47 * Math.PI, 0.73 * Math.PI, Math.PI, -0.73 * Math.PI, -0.47 * Math.PI];
const occupied = [1, 2, 5];
const shepherdHeight = 1.76;
const colors = {
  walnut: '#502819',
  edge: '#341a16',
  brass: '#ba8645',
  leather: '#482c35',
  arthur: '#742f38',
};

function Box({size, position, color, rotation, metalness = 0}) {
  return <mesh position={position} rotation={rotation}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} roughness={0.64} metalness={metalness} />
  </mesh>;
}

function Cylinder({top, bottom = top, height, y, color, metalness = 0}) {
  return <mesh position={[0, y, 0]}>
    <cylinderGeometry args={[top, bottom, height, 80]} />
    <meshStandardMaterial color={color} roughness={0.58} metalness={metalness} />
  </mesh>;
}

function RoundTable() {
  return <group name="Round table" scale={[0.82, tableHeight / tableModelHeight, 0.82]}>
    <Cylinder top={0.56} bottom={0.68} height={0.09} y={0.05} color={colors.edge} />
    <Cylinder top={0.28} bottom={0.38} height={0.15} y={0.17} color={colors.walnut} />
    <Cylinder top={0.29} bottom={0.23} height={0.52} y={0.46} color={colors.walnut} />
    <Cylinder top={0.55} bottom={0.30} height={0.13} y={0.73} color={colors.edge} />
    <Cylinder top={1.95} bottom={1.88} height={0.12} y={0.84} color={colors.edge} />
    <Cylinder top={1.99} height={0.024} y={0.907} color={colors.brass} metalness={0.55} />
    <Cylinder top={1.96} bottom={2} height={0.065} y={tableModelHeight - 0.033} color={colors.walnut} />
    <mesh position={[0, tableModelHeight + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[1.78, 1.793, 96]} />
      <meshStandardMaterial color={colors.brass} metalness={0.48} roughness={0.52} />
    </mesh>
  </group>;
}

function Chair({angle, arthur}) {
  const back = arthur ? 1.43 : 1.17;
  const width = arthur ? 0.82 : 0.72;
  const fabric = arthur ? colors.arthur : colors.leather;
  return <group name={arthur ? 'Arthur’s chair' : 'Council chair'}
    position={[Math.sin(angle) * seatRadius, 0, Math.cos(angle) * seatRadius]} rotation={[0, angle, 0]}>
    {[-1, 1].flatMap(x => [-1, 1].map(z =>
      <Box key={x + ':' + z} size={[0.09, 0.43, 0.09]}
        position={[x * (width / 2 - 0.05), 0.215, z * 0.25]} color={colors.edge} />
    ))}
    <Box size={[width, 0.13, 0.66]} position={[0, 0.46, 0]} color={colors.walnut} />
    <Box size={[width - 0.12, 0.073, 0.52]} position={[0, 0.544, -0.022]} color={fabric} />
    {[-1, 1].map(side => <Box key={side} size={[0.095, back - 0.43, 0.095]}
      position={[side * (width / 2 - 0.048), (back + 0.43) / 2, 0.26]} color={colors.walnut} />)}
    <Box size={[width, 0.115, 0.12]} position={[0, back - 0.055, 0.26]} color={colors.walnut} />
    <Box size={[width - 0.16, back - 0.66, 0.072]} position={[0, (back + 0.52) / 2, 0.26]} color={fabric} />
    <Box size={[width - 0.24, 0.026, 0.020]} position={[0, back - 0.145, 0.208]}
      color={colors.brass} metalness={0.52} />
    {arthur && [-1, 1].map(side => <Box key={side} size={[0.12, 0.095, 0.61]}
      position={[side * 0.38, 0.77, -0.025]} color={colors.walnut} />)}
  </group>;
}

function BookOfReceipts({onOpen}) {
  const cover = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 640;
    const ctx = canvas.getContext('2d');
    const leather = ctx.createLinearGradient(0, 0, 512, 640);
    leather.addColorStop(0, '#532629');
    leather.addColorStop(1, '#301719');
    ctx.fillStyle = leather;
    ctx.fillRect(0, 0, 512, 640);
    ctx.strokeStyle = '#bc9054';
    ctx.lineWidth = 4;
    ctx.strokeRect(23, 24, 466, 592);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(36, 37, 440, 566);
    ctx.fillStyle = '#dcb377';
    ctx.textAlign = 'center';
    ctx.font = '30px Georgia';
    ctx.fillText('BOOK OF', 256, 139);
    ctx.font = '48px Georgia';
    ctx.fillText('RECEIPTS', 256, 200);
    ctx.beginPath();
    ctx.moveTo(256, 233);
    ctx.lineTo(270, 248);
    ctx.lineTo(256, 263);
    ctx.lineTo(242, 248);
    ctx.closePath();
    ctx.stroke();
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }, []);
  useEffect(() => () => cover.dispose(), [cover]);

  return <group name="Book of Receipts" position={[-0.23, tableHeight, 1.20]} rotation={[0, -0.11, 0]}
    onClick={event => { event.stopPropagation(); onOpen(); }}>
    <Box size={[0.53, 0.017, 0.63]} position={[0, 0.009, 0]} color="#4b2427" />
    <Box size={[0.495, 0.041, 0.59]} position={[0, 0.032, 0]} color="#c1a77e" />
    <Box size={[0.038, 0.059, 0.63]} position={[-0.254, 0.034, 0]} color="#49272a" />
    <Box size={[0.53, 0.018, 0.63]} position={[0, 0.06, 0]} color="#4b2427" />
    <mesh position={[0, 0.070, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.525, 0.623]} />
      <meshStandardMaterial map={cover} roughness={0.85} />
    </mesh>
  </group>;
}

function uprightShepherd(source) {
  // The staged model is Z-up. The retained BJS-000 scene spec establishes its
  // orientation. Normalize bounds in the wrapper so seating and projection
  // reuse the same mesh. Recheck facing, height and floor contact on changes.
  const model = source.clone(true);
  const upright = new Group();
  model.rotation.x -= Math.PI / 2;
  upright.add(model);
  upright.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(upright, true);
  const center = bounds.getCenter(new Vector3());
  const scale = shepherdHeight / bounds.getSize(new Vector3()).y;
  upright.scale.setScalar(scale);
  upright.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  return upright;
}

function figurePosition(index) {
  const angle = angles[index];
  const tangent = index === 5 ? -0.47 : 0.47;
  return [Math.sin(angle) * 2.11 + Math.cos(angle) * tangent, 0,
    Math.cos(angle) * 2.11 - Math.sin(angle) * tangent];
}

function SpeakerAnchor({bubble, bubbleRef}) {
  const {camera, size, invalidate} = useThree();
  const point = useMemo(() => new Vector3(), []);
  useEffect(() => invalidate(), [bubble, invalidate]);
  useFrame(() => {
    const element = bubbleRef.current;
    if (!bubble || !element) return;
    const [x, , z] = figurePosition(bubble.seat === 'iris' ? 5 : 1);
    point.set(x, shepherdHeight + 0.1, z).project(camera);
    const inset = element.offsetWidth / 2 + 8;
    const left = Math.max(inset, Math.min(size.width - inset, (point.x + 1) * size.width / 2));
    const top = Math.max(element.offsetHeight + 22,
      Math.min(size.height - 16, (1 - point.y) * size.height / 2));
    element.style.left = left + 'px';
    element.style.top = top + 'px';
    element.style.visibility = 'visible';
  });
  return null;
}

function CouncilFigures({onReady, projection, onNrxStatus}) {
  const source = useLoader(GLTFLoader, './assets/void-shepherd/scene.gltf');
  const {figures, projected, projectionMaterial} = useMemo(() => {
    const template = uprightShepherd(source.scene);
    const projected = template.clone(true);
    const projectionMaterial = new MeshStandardMaterial({
      color: '#5ce0e7', emissive: '#1c8c9d', emissiveIntensity: 0.82, roughness: 0.52,
    });
    projected.traverse(node => { if (node.isMesh) node.material = projectionMaterial; });
    return {figures: occupied.map(() => template.clone(true)), projected, projectionMaterial};
  }, [source]);
  useEffect(() => onReady(true), [onReady]);
  useEffect(() => () => projectionMaterial.dispose(), [projectionMaterial]);

  const projectionLift = 0.2;
  const coneRadius = 0.30;
  return <>
    {figures.map((figure, offset) => {
      const index = occupied[offset];
      return <group key={index} name={'Void Shepherd seat ' + index}
        position={figurePosition(index)} rotation={[0, angles[index] + Math.PI, 0]}>
        <primitive object={figure} dispose={null} />
      </group>;
    })}
    <group name="Table projector" position={[0, tableHeight + 0.018, 0]}>
      <mesh position={[0, projectionLift / 2, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[coneRadius, projectionLift, 72, 1, true]} />
        <meshBasicMaterial color="#3bd6ff" transparent opacity={projection === 'withheld' ? 0.035 : 0.13} side={DoubleSide}
          depthWrite={false} blending={AdditiveBlending} />
      </mesh>
      <mesh position={[0, projectionLift, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[coneRadius, 0.008, 8, 72]} />
        <meshBasicMaterial color="#59dafa" transparent opacity={projection === 'withheld' ? 0.12 : 0.54} depthWrite={false} />
      </mesh>
      {(projection === 'mockup' || projection === 'verified') &&
        <group position={[0, projectionLift, 0]} scale={0.79 / shepherdHeight} rotation={[0, -0.13, 0]}>
          <primitive object={projected} dispose={null} />
        </group>}
      {projection === 'nrx' && <group position={[0, projectionLift, 0]}>
        <NrxProjection onStatus={onNrxStatus} />
      </group>}
    </group>
  </>;
}

const views = {
  arthur: {position: [0, 1.29, 1.92], target: [0, 1.32, -0.55], fov: 62},
  overview: {position: [4.65, 5.00, 5.40], target: [0, 0.48, 0], fov: 40},
};

function CameraView({view}) {
  const {camera, invalidate} = useThree();
  useEffect(() => {
    const shot = views[view];
    camera.position.set(...shot.position);
    camera.fov = shot.fov;
    camera.lookAt(...shot.target);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, invalidate, view]);
  return null;
}

function Scene({view, onReady, onOpenBook, projection, onNrxStatus, bubble, bubbleRef}) {
  return <>
    <color attach="background" args={['#141012']} />
    <fog attach="fog" args={['#141012', view === 'arthur' ? 5.6 : 10, 18]} />
    <ambientLight intensity={0.9} color="#e7d3c0" />
    <directionalLight position={[3, 6, 4]} color="#ffe1b9" intensity={2.8} />
    <directionalLight position={[-3, 2, -5]} color="#8baccb" intensity={1.4} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.018, 0]}>
      <planeGeometry args={[200, 200]} />
      <meshStandardMaterial color="#242124" roughness={1} />
    </mesh>
    <Cylinder top={4.16} height={0.024} y={-0.007} color="#33282a" />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.007, 0]}>
      <ringGeometry args={[3.82, 3.845, 100]} />
      <meshStandardMaterial color="#855d43" roughness={0.8} />
    </mesh>
    <RoundTable />
    <BookOfReceipts onOpen={onOpenBook} />
    {angles.map((angle, index) => <Chair key={angle} angle={angle} arthur={index === 0} />)}
    <Suspense fallback={null}>
      <CouncilFigures onReady={onReady} projection={projection} onNrxStatus={onNrxStatus} />
    </Suspense>
    <CameraView view={view} />
    <SpeakerAnchor bubble={bubble} bubbleRef={bubbleRef} />
  </>;
}

function ReceiptDialog({session, onClose, returnFocus}) {
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
    </section>
  </>;
}

function App() {
  const session = useSession();
  const [view, setView] = useState('arthur');
  const [dashboard, setDashboard] = useState(false);
  const [book, setBook] = useState(false);
  const [ready, setReady] = useState(false);
  const [nrx, setNrx] = useState(false);
  const [nrxStatus, setNrxStatus] = useState('loading');
  const bubbleRef = useRef(null);
  // The opener is hidden while its Book is open; retain its identity before focus moves.
  const bookTrigger = useRef(null);

  // The shared admitted response controls every view. A pending or failed live
  // request has no verified projection. The NRX fixture remains separately labeled.
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
    data-session-mode={session.mode} data-request-id={session.run?.requestId ?? ''}>
    <header>
      <div className="identity">
        <div className="seal" aria-hidden="true"><img src="./assets/brand/kotr-logo.png" alt="" /></div>
        <div><p className="overline">KnAIghts of the Round</p>
          <h1>{dashboard ? 'Case dashboard' : 'The council chamber'}</h1></div>
      </div>
      <div className="council-toolbar">
        <nav className="session-nav" aria-label="Session source">
          <button data-testid="mode-live" disabled={session.running} aria-pressed={session.mode === 'live'} onClick={() => { setBook(false); setNrx(false); session.setMode('live'); }}>Live IRIS</button>
          <button data-testid="mode-replay" disabled={session.running} aria-pressed={session.mode === 'replay'} onClick={() => { setBook(false); setNrx(false); session.setMode('replay'); }}>Recorded replay</button>
        </nav>
        <nav className="mode-nav" aria-label="Workspace mode">
          <button data-testid="workspace-roundtable" aria-pressed={!dashboard} onClick={() => { setBook(false); setDashboard(false); }}>Round Table</button>
          <button data-testid="workspace-dashboard" aria-pressed={dashboard} onClick={() => { setBook(false); setDashboard(true); }}>Dashboard</button>
        </nav>
        {!dashboard && <nav aria-label="Camera view">
          <button aria-pressed={view === 'arthur'} onClick={() => setView('arthur')}>Arthur’s chair</button>
          <button aria-pressed={view === 'overview'} onClick={() => setView('overview')}>Table layout</button>
        </nav>}
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
    </div></div> : <div className="viewport" aria-label="3D round table and chairs">
      <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{near: 0.04, far: 80}}>
        <Scene view={view} onReady={setReady} onOpenBook={() => setBook(true)} projection={projection}
          onNrxStatus={setNrxStatus} bubble={session.bubble} bubbleRef={bubbleRef} />
      </Canvas>
      <div className="projection-tools">
        <span className="projection-mode" role="status">{projectionLabel}</span>
        <button disabled={session.running} aria-pressed={nrx} onClick={() => {
          if (!nrx) setNrxStatus('loading');
          setNrx(!nrx);
        }}>{nrx ? 'Return to council projection' : 'Show NRX reference'}</button>
        {nrx && <a className="source-note" href="./assets/nrx-reference/ATTRIBUTION.txt"
          target="_blank" rel="noreferrer">Source and attribution</a>}
      </div>
      {session.bubble && <div ref={bubbleRef} className={'speaker-bubble ' + session.bubble.seat}
        aria-live="polite">
        <strong>{session.bubble.label ?? (session.bubble.seat === 'codex' ? 'Sir Codex · recorded' : 'IRIS · recorded')}</strong>
        <p>{session.bubble.text}</p>
      </div>}
      <button ref={bookTrigger} className="book-trigger" hidden={book} data-testid="open-book" onClick={() => setBook(true)}>Open Book of Receipts</button>
      {book && <ReceiptDialog session={session} onClose={() => setBook(false)} returnFocus={bookTrigger} />}
    </div>}
    <footer>
      <span className={'session-state ' + (session.mode === 'live' ? session.phase : 'recorded')} role="status">
        {session.mode === 'live' ? session.error || `Live IRIS · ${session.phase} · explicit native requests only` : 'Recorded rehearsal · sealed synthetic cases'}
      </span>
      <CaseSwitch session={session} onSelect={() => setNrx(false)} />
    </footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
