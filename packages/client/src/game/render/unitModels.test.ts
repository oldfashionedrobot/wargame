import { describe, expect, it } from 'vitest';

// The unit models, as text: each is a .gltf with its buffer embedded.
const MODELS = import.meta.glob<string>('../../../public/models/*.gltf', {
  query: '?raw',
  import: 'default',
  eager: true,
});

interface Gltf {
  buffers: { uri: string }[];
  bufferViews: { byteOffset?: number }[];
  accessors: { bufferView: number; count: number; componentType: number }[];
  meshes: {
    primitives: { attributes: { POSITION: number; NORMAL: number }; indices: number }[];
  }[];
}

type Vec3 = [number, number, number];

/**
 * How far a model's stored normals agree with its triangles, weighted by area:
 * 1 when every normal is its face's own.
 */
function normalAgreement(text: string): number {
  const gltf = JSON.parse(text) as Gltf;
  expect(gltf.buffers).toHaveLength(1);
  const base64 = gltf.buffers[0].uri.split(',')[1];
  const view = new DataView(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer);
  const start = (accessor: number) =>
    gltf.bufferViews[gltf.accessors[accessor].bufferView].byteOffset ?? 0;

  let agreement = 0;
  let area = 0;
  for (const mesh of gltf.meshes) {
    for (const { attributes, indices } of mesh.primitives) {
      const vec3 = (accessor: number, vertex: number): Vec3 => {
        const at = start(accessor) + 12 * vertex;
        return [0, 4, 8].map((k) => view.getFloat32(at + k, true)) as Vec3;
      };
      const wide = gltf.accessors[indices].componentType === 5125;
      const index = (i: number) =>
        wide
          ? view.getUint32(start(indices) + 4 * i, true)
          : view.getUint16(start(indices) + 2 * i, true);

      for (let t = 0; t < gltf.accessors[indices].count; t += 3) {
        const corners = [index(t), index(t + 1), index(t + 2)];
        const [a, b, c] = corners.map((v) => vec3(attributes.POSITION, v));
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const face = [
          u[1] * w[2] - u[2] * w[1],
          u[2] * w[0] - u[0] * w[2],
          u[0] * w[1] - u[1] * w[0],
        ];
        area += Math.hypot(...face);
        for (const corner of corners) {
          const n = vec3(attributes.NORMAL, corner);
          agreement += (face[0] * n[0] + face[1] * n[1] + face[2] * n[2]) / 3;
        }
      }
    }
  }
  return agreement / area;
}

describe('unit models', () => {
  it('are found', () => {
    expect(Object.keys(MODELS).length).toBeGreaterThan(0);
  });

  // ⚠️ The STL conversion these came through turned every normal a quarter-turn
  // about one axis, a different way per model, so units were lit from the side
  // and the infantry from the opposite side to the rest. A turned normal still
  // points outward, so nothing else catches it.
  const byName = Object.entries(MODELS).map(
    ([path, text]) => [path.slice(path.lastIndexOf('/') + 1), text] as const,
  );
  it.each(byName)('%s has normals facing the way its triangles do', (_, text) => {
    expect(normalAgreement(text)).toBeGreaterThan(0.9);
  });
});
