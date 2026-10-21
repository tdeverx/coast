import * as THREE from 'three';

/** The reader deforms indexed, packed position buffers without changing topology. */
export function updatePageGeometry(geometry: THREE.BufferGeometry, box = false) {
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const normals = geometry.attributes.normal as THREE.BufferAttribute;
  const p = positions.array, n = normals.array, indices = geometry.index!.array;
  n.fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const cx = p[c] - p[b], cy = p[c + 1] - p[b + 1], cz = p[c + 2] - p[b + 2];
    const ax = p[a] - p[b], ay = p[a + 1] - p[b + 1], az = p[a + 2] - p[b + 2];
    const x = cy * az - cz * ay, y = cz * ax - cx * az, z = cx * ay - cy * ax;
    n[a] += x;
    n[a + 1] += y;
    n[a + 2] += z;
    n[b] += x;
    n[b + 1] += y;
    n[b + 2] += z;
    n[c] += x;
    n[c + 1] += y;
    n[c + 2] += z;
  }
  for (let i = 0; i < n.length; i += 3) {
    const length = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]) || 1;
    const inverse = 1 / length;
    n[i] *= inverse;
    n[i + 1] *= inverse;
    n[i + 2] *= inverse;
  }
  positions.needsUpdate = normals.needsUpdate = true;
  geometry.computeBoundingSphere();
  if (box) geometry.computeBoundingBox();
}

export function dynamicPageGeometry(geometry: THREE.BufferGeometry) {
  (geometry.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
  (geometry.attributes.normal as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
}
