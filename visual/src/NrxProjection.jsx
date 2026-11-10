import React, {useEffect, useRef, useState} from 'react';
import {BufferAttribute, BufferGeometry} from 'three';

// The retained HRA right-ovary fixture uses eight little-endian floats per
// vertex: position vec4 followed by normal vec4. Check its size and digest
// before converting it into a display projection; retain its source attribution.
const fixture = Object.freeze({
  url: `${import.meta.env.BASE_URL}assets/nrx-reference/VH_F_right_ovary-N32.bin`,
  sha256: '4359bae3d1b35404f478a5b5a4c91798e29aebbf0f2799e0f969d4f5be1654d5',
  triangles: 4636,
  bytes: 445056,
});

async function loadGeometry(signal) {
  const response = await fetch(fixture.url, {signal});
  if (!response.ok) throw new Error(`NRX reference HTTP ${response.status}`);
  const declaredBytes = response.headers.get('content-length');
  if (declaredBytes !== null && Number(declaredBytes) !== fixture.bytes) {
    throw new Error('NRX reference length mismatch');
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== fixture.bytes) throw new Error('NRX reference length mismatch');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  if (Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('') !== fixture.sha256) {
    throw new Error('NRX reference hash mismatch');
  }
  signal.throwIfAborted();

  const vertexCount = fixture.triangles * 3;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const data = new DataView(bytes);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    for (let axis = 0; axis < 3; axis++) {
      const offset = vertex * 32 + axis * 4;
      const position = data.getFloat32(offset, true);
      const normal = data.getFloat32(offset + 16, true);
      if (!Number.isFinite(position) || !Number.isFinite(normal)) {
        throw new Error('Invalid NRX reference vertex');
      }
      positions[vertex * 3 + axis] = position;
      normals[vertex * 3 + axis] = normal;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  const {min, max} = geometry.boundingBox;
  const height = max.y - min.y;
  if (!(height > 0)) {
    geometry.dispose();
    throw new Error('NRX reference has no display height');
  }
  geometry.translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
  geometry.scale(0.79 / height, 0.79 / height, 0.79 / height);
  return geometry;
}

export default function NrxProjection({onStatus} = {}) {
  const [geometry, setGeometry] = useState(null);
  const report = useRef(onStatus);
  useEffect(() => { report.current = onStatus; }, [onStatus]);

  useEffect(() => {
    const controller = new AbortController();
    let ownedGeometry;
    report.current?.('loading');
    loadGeometry(controller.signal).then(result => {
      if (controller.signal.aborted) {
        result.dispose();
        return;
      }
      ownedGeometry = result;
      setGeometry(result);
      report.current?.('ready');
    }, () => {
      if (!controller.signal.aborted) report.current?.('unavailable');
    });
    return () => {
      controller.abort();
      ownedGeometry?.dispose();
    };
  }, []);

  if (!geometry) return null;
  return <mesh name="NRX retained HRA right ovary display derivative" renderOrder={4}>
    <primitive object={geometry} attach="geometry" />
    <meshStandardMaterial color="#7cf6ff" emissive="#0d9fbc" emissiveIntensity={1.1}
      roughness={0.6} transparent opacity={0.86} depthWrite={false} />
  </mesh>;
}
