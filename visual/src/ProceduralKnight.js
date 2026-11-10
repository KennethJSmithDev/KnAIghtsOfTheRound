import {
  BufferGeometry, CylinderGeometry, Euler, Float32BufferAttribute, Group, Matrix4,
  DataTexture, DoubleSide, LinearFilter, Mesh, MeshStandardMaterial, Quaternion,
  RedFormat, RepeatWrapping, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

function surfaceTexture(woven) {
  const size = 128, data = new Uint8Array(size * size);
  for (let v = 0; v < size; v++) for (let u = 0; u < size; u++) {
    const thread = Math.sin(u * Math.PI / 2) * Math.sin(v * Math.PI / 2);
    const grain = ((u * 73 + v * 151 + u * v * 7) % 31) - 15;
    data[v * size + u] = Math.round(128 + (woven ? thread * 55 : 0) + grain);
  }
  const texture = new DataTexture(data, size, size, RedFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function clothSurface(standing, mantle) {
  const columns = 32, rows = 28, positions = [], uv = [], indices = [];
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const t = row / rows, u = column / columns;
    let x, y, z;
    if (mantle) {
      const theta = Math.PI * (0.45 + u * 1.1);
      const fold = Math.sin(u * Math.PI * 14) * (0.005 + t * 0.016);
      x = Math.sin(theta) * (0.205 + t * 0.11 + fold);
      z = Math.cos(theta) * (0.15 + t * 0.075 + fold) - 0.035;
      y = 1.21 - t * (standing ? 1.29 : 0.77);
    } else {
      x = (u - 0.5) * (0.31 + t * 0.06);
      y = standing ? 0.84 - t * 0.86 : t < 0.36 ? 0.84 - t * 0.58 : 0.631 - (t - 0.36) * 0.67;
      z = standing ? 0.15 + t * 0.025 : 0.12 + Math.min(t / 0.36, 1) * 0.225;
      z += Math.sin(u * Math.PI * 10) * (0.006 + t * 0.012);
      // The central split leaves the legs readable below the tabard.
      y += Math.pow(Math.max(0, 1 - Math.abs(u - 0.5) * 12), 2) * t * t * 0.14;
    }
    y += Math.sin(u * Math.PI * 6) * Math.pow(t, 5) * 0.018;
    positions.push(x, y + (standing ? 0.16 : 0), z);
    uv.push(u * 3, t * 5);
    if (row < rows && column < columns) {
      const a = row * (columns + 1) + column, b = a + columns + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Flat, raised facets make the armor read as crafted plate at a small scale.
// Give every face its own vertices so its highlight stays sharp after merging.
function facetedPlate(outline, ridge, depth = 0.018) {
  const area = outline.reduce((sum, p, i) => {
    const q = outline[(i + 1) % outline.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  const points = area < 0 ? [...outline].reverse() : outline;
  const center = ridge ?? points.reduce((a, p) => a.map((v, i) => v + p[i] / points.length), [0, 0, 0]);
  const positions = [], uv = [], indices = [];
  const triangle = (a, b, c) => {
    for (const vertex of [a, b, c]) {
      positions.push(...vertex);
      uv.push(vertex[0], vertex[1]);
      indices.push(indices.length);
    }
  };
  const back = point => [point[0], point[1], point[2] - depth];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    triangle(center, a, b);
    triangle(back(center), back(b), back(a));
    triangle(a, back(a), b);
    triangle(b, back(a), back(b));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildKnight(materials, standing = false) {
  const parts = new Map();
  const offset = standing ? 0.16 : 0;
  const y = value => value + offset;
  const keep = (material, geometry) => {
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material).push(geometry);
  };
  const add = (material, geometry, position, rotation = [0, 0, 0], scale = [1, 1, 1]) => {
    geometry.applyMatrix4(new Matrix4().compose(new Vector3(...position),
      new Quaternion().setFromEuler(new Euler(...rotation)), new Vector3(...scale)));
    keep(material, geometry);
  };
  const plate = (material, outline, ridge, depth) => keep(material, facetedPlate(
    outline.map(([x, height, z]) => [x, y(height), z]),
    ridge && [ridge[0], y(ridge[1]), ridge[2]], depth));
  const tube = (material, top, bottom, height, position, radial = 10, rotation) =>
    add(material, new CylinderGeometry(top, bottom, height, radial), position, rotation);
  const limb = (material, startRadius, endRadius, from, to) => {
    const a = new Vector3(...from), b = new Vector3(...to);
    const direction = b.clone().sub(a);
    const geometry = new CylinderGeometry(endRadius, startRadius, direction.length(), 10);
    geometry.applyMatrix4(new Matrix4().compose(a.add(b).multiplyScalar(0.5),
      new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()),
      new Vector3(1, 1, 1)));
    keep(material, geometry);
  };
  const oval = (material, position, scale, width = 8, height = 6) =>
    add(material, new SphereGeometry(1, width, height), position, [0, 0, 0], scale);

  keep('cloth', clothSurface(standing, true));
  keep('cloth', clothSurface(standing, false));
  tube('cloth', 0.17, 0.14, 0.34, [0, y(1.00), 0], 10);
  tube('dark', 0.135, 0.13, 0.18, [0, y(0.82), 0], 10);
  tube('dark', 0.105, 0.17, 0.12, [0, y(1.23), 0], 10);
  plate('cloth', [[-0.14, 1.29, 0.075], [-0.17, 1.22, 0.09], [0, 1.15, 0.16],
    [0.17, 1.22, 0.09], [0.14, 1.29, 0.075], [0, 1.25, 0.14]], [0, 1.23, 0.16], 0.01);
  plate('steel', [
    [-0.17, 1.18, 0.08], [-0.16, 1.04, 0.13], [-0.11, 0.90, 0.15],
    [0, 0.84, 0.15], [0.11, 0.90, 0.15], [0.16, 1.04, 0.13], [0.17, 1.18, 0.08],
  ], [0, 1.06, 0.195], 0.025);
  plate('light', [
    [-0.145, 1.17, 0.105], [-0.13, 1.07, 0.151], [0, 1.00, 0.198],
    [0.13, 1.07, 0.151], [0.145, 1.17, 0.105], [0, 1.12, 0.19],
  ], [0, 1.12, 0.205], 0.008);
  tube('gold', 0.14, 0.14, 0.022, [0, y(0.865), 0], 10);
  plate('gold', [[-0.045, 1.10, 0.192], [0, 1.055, 0.215],
    [0.045, 1.10, 0.192], [0, 1.145, 0.207]], [0, 1.10, 0.221], 0.006);
  plate('cyan', [[-0.022, 1.10, 0.22], [0, 1.078, 0.226],
    [0.022, 1.10, 0.22], [0, 1.122, 0.224]], [0, 1.10, 0.231], 0.004);
  for (let row = 0; row < 4; row++) {
    const height = 1.035 - row * 0.047, width = 0.13 - row * 0.012;
    const center = 0.211 - row * 0.014;
    plate(row % 2 ? 'steel' : 'light', [[-width, height + 0.022, center - 0.027],
      [-width, height - 0.01, center - 0.027], [0, height - 0.047, center],
      [width, height - 0.01, center - 0.027], [width, height + 0.022, center - 0.027],
      [0, height - 0.012, center + 0.006]], [0, height - 0.015, center + 0.009], 0.008);
  }

  // A tapered, faceted helm and hood remove the wide horizontal visor.
  oval('steel', [0, y(1.425), -0.02], [0.135, 0.173, 0.12], 20, 12);
  plate('steel', [
    [-0.095, 1.52, 0.085], [-0.115, 1.45, 0.11], [-0.092, 1.36, 0.13],
    [0, 1.29, 0.14], [0.092, 1.36, 0.13], [0.115, 1.45, 0.11],
    [0.095, 1.52, 0.085], [0, 1.58, 0.075],
  ], [0, 1.435, 0.165], 0.023);
  plate('light', [[-0.095, 1.52, 0.096], [-0.11, 1.45, 0.117],
    [0, 1.435, 0.173], [0, 1.58, 0.083]], [0, 1.49, 0.145], 0.006);
  plate('dark', [[-0.008, 1.56, 0.092], [-0.008, 1.34, 0.162],
    [0, 1.31, 0.157], [0.008, 1.34, 0.162], [0.008, 1.56, 0.092]],
  [0, 1.435, 0.175], 0.004);
  for (const side of [-1, 1]) {
    limb('dark', 0.002, 0.002, [0, y(1.53), 0.12], [side * 0.071, y(1.46), 0.147]);
    limb('dark', 0.002, 0.002, [side * 0.071, y(1.46), 0.147], [0, y(1.39), 0.174]);
  }

  for (const side of [-1, 1]) {
    const p = points => points.map(([x, height, z]) => [side * x, height, z]);
    for (let layer = 0; layer < 4; layer++) {
      const base = 1.245 - layer * 0.028, tip = 1.35 - layer * 0.062;
      const reach = 0.49 - layer * 0.026, front = 0.115 + layer * 0.01;
      plate(layer % 2 ? 'steel' : 'light', p([[0.17, base, front], [0.245, base - 0.042, front + 0.025],
        [reach, tip, 0.095], [0.28, base + 0.025, front]]), [side * 0.275, base, front + 0.03], 0.008);
      limb('gold', 0.0018, 0.0012, [side * 0.17, y(base), front + 0.006], [side * reach, y(tip), 0.101]);
    }
    // Overlapping tapered plates make a winged pauldron without boxy ends.
    plate('dark', p([[0.13, 1.24, 0.02], [0.22, 1.12, 0.02], [0.38, 1.12, 0.04],
      [0.43, 1.23, 0.01], [0.30, 1.30, -0.04]]), [side * 0.27, 1.22, 0.08]);
    plate('steel', p([[0.14, 1.26, 0.065], [0.27, 1.17, 0.14], [0.40, 1.19, 0.10],
      [0.52, 1.34, 0.00], [0.31, 1.29, -0.01]]), [side * 0.30, 1.25, 0.13]);
    plate('light', p([[0.15, 1.27, 0.085], [0.27, 1.22, 0.15], [0.41, 1.25, 0.09],
      [0.49, 1.35, 0.015], [0.30, 1.31, 0.01]]), [side * 0.30, 1.28, 0.13], 0.01);
    plate('steel', p([[0.19, 1.18, 0.11], [0.28, 1.12, 0.15], [0.41, 1.14, 0.09],
      [0.46, 1.23, 0.04], [0.30, 1.20, 0.10]]), [side * 0.31, 1.17, 0.145], 0.01);

    const shoulder = [side * 0.23, y(1.15), 0.02];
    const elbow = [side * 0.27, y(0.96), 0.10];
    const wrist = [side * 0.245, y(0.88), 0.29];
    limb('dark', 0.068, 0.055, shoulder, elbow);
    limb('steel', 0.054, 0.046, shoulder, elbow);
    oval('dark', elbow, [0.058, 0.055, 0.055]);
    limb('steel', 0.053, 0.043, elbow, wrist);
    limb('light', 0.035, 0.025,
      [side * 0.27, y(0.975), 0.115], [side * 0.245, y(0.89), 0.29]);
    oval('steel', [side * 0.245, y(0.875), 0.315], [0.048, 0.028, 0.05]);
    for (let finger = 0; finger < 4; finger++) {
      const x = side * 0.245 + (finger - 1.5) * 0.021;
      oval('steel', [x, y(0.873), 0.36], [0.009, 0.017, 0.031 - Math.abs(finger - 1.5) * 0.003], 6, 4);
    }

    if (standing) {
      limb('dark', 0.070, 0.055, [side * 0.10, 0.94, 0], [side * 0.11, 0.52, 0]);
      limb('steel', 0.064, 0.05, [side * 0.10, 0.91, 0.01], [side * 0.11, 0.54, 0.01]);
      oval('steel', [side * 0.11, 0.52, 0.015], [0.057, 0.035, 0.058]);
      limb('steel', 0.06, 0.043, [side * 0.11, 0.49, 0], [side * 0.11, 0.13, 0]);
      oval('dark', [side * 0.11, 0.07, 0.055], [0.065, 0.07, 0.13]);
    } else {
      limb('dark', 0.074, 0.062, [side * 0.10, 0.73, -0.02], [side * 0.11, 0.62, 0.28]);
      limb('steel', 0.065, 0.055, [side * 0.10, 0.73, -0.02], [side * 0.11, 0.62, 0.28]);
      oval('steel', [side * 0.11, 0.62, 0.30], [0.066, 0.045, 0.055]);
      limb('steel', 0.06, 0.043, [side * 0.11, 0.59, 0.28], [side * 0.11, 0.13, 0.32]);
      oval('dark', [side * 0.11, 0.07, 0.365], [0.065, 0.07, 0.13]);
      plate('light', p([[0.055, 0.55, 0.33], [0.06, 0.18, 0.38], [0.11, 0.12, 0.39],
        [0.16, 0.18, 0.38], [0.165, 0.55, 0.33], [0.11, 0.58, 0.34]]),
      [side * 0.11, 0.35, 0.41], 0.008);
    }
  }

  // The small ring-topped staff is an original geometric heraldic detail.
  tube('gold', 0.011, 0.011, 0.70, [0.245, y(1.205), 0.335], 8);
  add('gold', new TorusGeometry(0.063, 0.009, 6, 16), [0.245, y(1.60), 0.335]);

  const group = new Group();
  const geometries = [];
  for (const [material, pieces] of parts) {
    const geometry = mergeGeometries(pieces);
    pieces.forEach(piece => piece.dispose());
    if (!geometry) throw new Error('Could not combine procedural knight geometry');
    geometries.push(geometry);
    group.add(new Mesh(geometry, materials[material]));
  }
  return {group, geometries};
}

export function createKnightAssets() {
  const metalTexture = surfaceTexture(false), clothTexture = surfaceTexture(true);
  const materials = {
    steel: new MeshStandardMaterial({color: '#aebbc2', metalness: 0.45, roughness: 0.46, bumpMap: metalTexture, bumpScale: 0.0015}),
    light: new MeshStandardMaterial({color: '#e4e8e6', metalness: 0.4, roughness: 0.42, bumpMap: metalTexture, bumpScale: 0.0015}),
    gold: new MeshStandardMaterial({color: '#c99b4c', metalness: 0.74, roughness: 0.34}),
    dark: new MeshStandardMaterial({color: '#1b2530', metalness: 0.32, roughness: 0.56}),
    cloth: new MeshStandardMaterial({color: '#352633', roughness: 0.88, side: DoubleSide, bumpMap: clothTexture, bumpScale: 0.003}),
    cyan: new MeshStandardMaterial({color: '#63ecf3', emissive: '#168c9b', emissiveIntensity: 0.65, roughness: 0.4}),
  };
  const seated = buildKnight(materials);
  const standing = buildKnight(materials, true);
  const projectionMaterial = new MeshStandardMaterial({
    color: '#5ce0e7', emissive: '#1c8c9d', emissiveIntensity: 0.72, roughness: 0.52,
    transparent: true, opacity: 0.72,
  });
  const projectionCloth = projectionMaterial.clone();
  projectionCloth.side = DoubleSide;
  const projected = standing.group.clone(true);
  projected.traverse(node => {
    if (node.isMesh) node.material = node.material === materials.cloth ? projectionCloth : projectionMaterial;
  });
  return {
    figures: [seated.group.clone(true), seated.group.clone(true), seated.group.clone(true)],
    projected,
    dispose() {
      [...seated.geometries, ...standing.geometries].forEach(geometry => geometry.dispose());
      Object.values(materials).forEach(material => material.dispose());
      projectionMaterial.dispose();
      projectionCloth.dispose();
      metalTexture.dispose();
      clothTexture.dispose();
    },
  };
}
