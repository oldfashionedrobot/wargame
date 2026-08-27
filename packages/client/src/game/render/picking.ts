import { Matrix } from '@babylonjs/core';
import type { Camera, Scene } from '@babylonjs/core';
import { isWithinGrid } from '@aw/shared';
import type { Coordinate } from '@aw/shared';

import { worldToTile } from './coordinates';

// Casts a ray from screen space through the camera and intersects it with the
// ground plane (y = 0) directly, rather than raycasting against scene meshes.
// This makes tile lookup independent of what's actually rendered on the
// ground and avoids Babylon's mesh-picking performance gates entirely.
export function screenToTile(
  scene: Scene,
  camera: Camera,
  screenX: number,
  screenY: number,
  gridWidth: number,
  gridHeight: number,
): Coordinate | null {
  const ray = scene.createPickingRay(screenX, screenY, Matrix.Identity(), camera);
  if (Math.abs(ray.direction.y) < 1e-6) return null;

  const distance = -ray.origin.y / ray.direction.y;
  if (distance < 0) return null;

  const x = ray.origin.x + ray.direction.x * distance;
  const z = ray.origin.z + ray.direction.z * distance;
  const coordinate = worldToTile(x, z, gridWidth, gridHeight);
  return isWithinGrid(coordinate, gridWidth, gridHeight) ? coordinate : null;
}
