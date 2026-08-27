import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial } from '@babylonjs/core';
import type { Coordinate } from '@aw/shared';
import { TILE_SIZE, tileToWorld } from './coordinates';

export function createTileHighlight(
  scene: Scene,
  name: string,
  color: Color3,
  alpha: number,
): Mesh {
  const mesh = MeshBuilder.CreateGround(
    name,
    { width: TILE_SIZE * 0.96, height: TILE_SIZE * 0.96 },
    scene,
  );
  const material = new StandardMaterial(`${name}-material`, scene);
  material.diffuseColor = color;
  material.emissiveColor = color;
  material.alpha = alpha;
  mesh.material = material;
  mesh.setEnabled(false);
  return mesh;
}

export function setHighlightTile(
  mesh: Mesh,
  coordinate: Coordinate | null,
  height: number,
  gridWidth: number,
  gridHeight: number,
): void {
  if (!coordinate) {
    mesh.setEnabled(false);
    return;
  }

  const center = tileToWorld(coordinate, gridWidth, gridHeight);
  mesh.position.set(center.x, height, center.z);
  mesh.setEnabled(true);
}
