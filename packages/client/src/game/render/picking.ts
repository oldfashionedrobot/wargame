// Side effect: installs scene.createPickingRay (and scene.pick, which the
// pointer observable's PICK events use) -- undefined at runtime without it.
import '@babylonjs/core/Culling/ray';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';
import { isWithinGrid } from '@vod/shared';
import type { Coordinate } from '@vod/shared';

import { worldToTile } from './coordinates';

// Casts a ray from screen space through the camera and intersects it with the
// ground plane (y = 0) directly, rather than raycasting against scene meshes.
// This makes tile lookup independent of what's actually rendered on the
// ground and avoids Babylon's mesh-picking performance gates entirely.
//
// ⚠️ That independence is also the constraint on how tall the board may get:
// anything drawn above this plane is picked where it *would* fall onto it, not
// where it appears. `MAX_STAND_HEIGHT` is where that stops being unnoticeable.
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
