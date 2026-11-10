import React, {Suspense, useEffect, useMemo} from 'react';
import {Canvas, useFrame, useThree} from '@react-three/fiber';
import {AdditiveBlending, CanvasTexture, DoubleSide, SRGBColorSpace, Vector3} from 'three';
import NrxProjection from './NrxProjection.jsx';
import {createKnightAssets} from './ProceduralKnight.js';

const seatRadius = 2.15;
const tableModelHeight = 0.98;
const tableHeight = 0.84;
const angles = [0, 0.47 * Math.PI, 0.73 * Math.PI, Math.PI, -0.73 * Math.PI, -0.47 * Math.PI];
const occupied = [1, 2, 5];
const seatedKnightHeight = 1.68;
const projectedKnightHeight = 1.84;
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

function figurePosition(index) {
  const angle = angles[index];
  return [Math.sin(angle) * seatRadius, 0, Math.cos(angle) * seatRadius];
}

function SpeakerAnchor({bubble, bubbleRef}) {
  const {camera, size, invalidate} = useThree();
  const point = useMemo(() => new Vector3(), []);
  useEffect(() => invalidate(), [bubble, invalidate]);
  useFrame(() => {
    const element = bubbleRef.current;
    if (!bubble || !element) return;
    const [x, , z] = figurePosition(bubble.seat === 'iris' ? 5 : 1);
    point.set(x, seatedKnightHeight + 0.1, z).project(camera);
    const inset = element.offsetWidth / 2 + 8;
    const left = Math.max(inset, Math.min(size.width - inset, (point.x + 1) * size.width / 2));
    const viewport = element.parentElement;
    const bookButton = viewport?.querySelector('[data-testid="open-book"]');
    const bookTop = bookButton && !bookButton.hidden
      ? bookButton.getBoundingClientRect().top - viewport.getBoundingClientRect().top : size.height;
    const top = Math.max(element.offsetHeight + 22,
      Math.min(bookTop - 8, (1 - point.y) * size.height / 2));
    element.style.left = left + 'px';
    element.style.top = top + 'px';
    element.style.visibility = 'visible';
  });
  return null;
}

function CouncilFigures({onReady, projection, onNrxStatus}) {
  const assets = useMemo(() => createKnightAssets(), []);
  const {figures, projected} = assets;
  useEffect(() => onReady(true), [onReady]);
  useEffect(() => () => assets.dispose(), [assets]);

  const projectionLift = 0.2;
  const coneRadius = 0.30;
  return <>
    {figures.map((figure, offset) => {
      const index = occupied[offset];
      return <group key={index} name={'Council knight seat ' + index}
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
        <group position={[0, projectionLift, 0]} scale={0.79 / projectedKnightHeight} rotation={[0, -0.13, 0]}>
          <primitive object={projected} dispose={null} />
        </group>}
      {projection === 'nrx' && <group position={[0, projectionLift, 0]}>
        <NrxProjection onStatus={onNrxStatus} />
      </group>}
    </group>
  </>;
}

const views = {
  arthur: {position: [0, 1.29, 1.92], target: [0, 1.32, -0.55], fov: 74},
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

export default function Chamber3D({view, onReady, onOpenBook, projection, onNrxStatus, bubble, bubbleRef}) {
  return <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{near: 0.04, far: 80}}>
    <Scene view={view} onReady={onReady} onOpenBook={onOpenBook} projection={projection}
      onNrxStatus={onNrxStatus} bubble={bubble} bubbleRef={bubbleRef} />
  </Canvas>;
}
