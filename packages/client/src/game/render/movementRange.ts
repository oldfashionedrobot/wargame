import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { Coordinate } from '@vod/shared';
import { TILE_SIZE, tileToWorld } from './coordinates';

const RANGE_HEIGHT = 0.015; // above grid lines, below the hover/selection highlights
const RANGE_COLOR = new Color3(0.3, 0.55, 1);
const RANGE_ALPHA = 0.4;

export function createMovementRangeOverlay(scene: Scene): Mesh {
  const mesh = new Mesh('movement-range', scene);
  const material = new StandardMaterial('movement-range-material', scene);
  material.diffuseColor = RANGE_COLOR;
  material.emissiveColor = RANGE_COLOR;
  material.alpha = RANGE_ALPHA;
  material.backFaceCulling = false;
  mesh.material = material;
  mesh.isVisible = false;
  return mesh;
}

export function setMovementRangeTiles(
  mesh: Mesh,
  coordinates: Coordinate[],
  gridWidth: number,
  gridHeight: number,
): void {
  if (coordinates.length === 0) {
    mesh.isVisible = false;
    return;
  }

  const half = TILE_SIZE / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  coordinates.forEach((coordinate, i) => {
    const center = tileToWorld(coordinate, gridWidth, gridHeight);
    const base = i * 4;

    // One vertex per line; flattening into a column loses the shape.
    // prettier-ignore
    positions.push(
      center.x - half, RANGE_HEIGHT, center.z - half,
      center.x + half, RANGE_HEIGHT, center.z - half,
      center.x + half, RANGE_HEIGHT, center.z + half,
      center.x - half, RANGE_HEIGHT, center.z + half,
    )
    for (let v = 0; v < 4; v++) normals.push(0, 1, 0);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  });

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.indices = indices;
  vertexData.applyToMesh(mesh, true);

  mesh.isVisible = true;
}
