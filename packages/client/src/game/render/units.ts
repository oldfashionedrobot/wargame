// Side effect: installs scene.beginAnimation -- undefined at runtime without it.
import '@babylonjs/core/Animations/animatable';
import { Animation } from '@babylonjs/core/Animations/animation';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { directionBetween } from '@vod/shared';
import type { Coordinate, Facing, PlayerColor, Unit } from '@vod/shared';
import { tileToWorld } from './coordinates';

const UNIT_DIAMETER = 0.5;
const UNIT_HEIGHT = 0.6;
const FRAME_RATE = 30;
// One tile of walking, at FRAME_RATE. The pace every unit moves at -- there is
// no per-type speed, so this is the single dial for how long a move takes: a
// three-tile move is 3x this. 9/30 = 0.3s.
const FRAMES_PER_TILE = 9;

// A symmetric cylinder placeholder has no visible "front", but wiring facing to
// rotation now means a real unit model/sprite can drop in later with no renderer changes.
const FACING_ROTATION: Record<Facing, number> = {
  north: 0,
  east: Math.PI / 2,
  south: Math.PI,
  west: -Math.PI / 2,
};

const PLAYER_COLORS: Record<PlayerColor, Color3> = {
  blue: new Color3(0.2, 0.4, 0.9),
  red: new Color3(0.85, 0.2, 0.2),
  green: new Color3(0.2, 0.7, 0.3),
  yellow: new Color3(0.9, 0.8, 0.2),
};

export function createUnitMesh(
  scene: Scene,
  unit: Unit,
  color: PlayerColor,
  gridWidth: number,
  gridHeight: number,
): Mesh {
  const mesh = CreateCylinder(
    `unit-${unit.id}`,
    { height: UNIT_HEIGHT, diameter: UNIT_DIAMETER },
    scene,
  );
  const material = new StandardMaterial(`unit-${unit.id}-material`, scene);
  material.diffuseColor = PLAYER_COLORS[color];
  mesh.material = material;

  const center = tileToWorld(unit.position, gridWidth, gridHeight);
  mesh.position.set(center.x, UNIT_HEIGHT / 2, center.z);
  setUnitFacing(mesh, unit.facing);
  return mesh;
}

/**
 * Points a unit mesh a compass direction. The only writer of `rotation.y`, so
 * that swapping the placeholder cylinder for a model means changing what
 * `FACING_ROTATION` holds and nothing else.
 */
export function setUnitFacing(mesh: Mesh, facing: Facing): void {
  mesh.rotation.y = FACING_ROTATION[facing];
}

function animateSegment(mesh: Mesh, scene: Scene, target: Vector3): Promise<void> {
  return new Promise((resolve) => {
    const positionAnimation = new Animation(
      'unit-move',
      'position',
      FRAME_RATE,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    positionAnimation.setKeys([
      { frame: 0, value: mesh.position.clone() },
      { frame: FRAMES_PER_TILE, value: target },
    ]);
    mesh.animations = [positionAnimation];
    scene.beginAnimation(mesh, 0, FRAMES_PER_TILE, false, 1, () => resolve());
  });
}

export async function animateUnitAlongPath(
  mesh: Mesh,
  path: Coordinate[],
  gridWidth: number,
  gridHeight: number,
  scene: Scene,
): Promise<void> {
  for (const [index, coordinate] of path.slice(1).entries()) {
    // Turn before the step, so the unit walks the way it is looking rather
    // than arriving and rotating. A snapped turn is deliberate: interpolating
    // it costs a tween per corner for something read at a glance.
    const heading = directionBetween(path[index], coordinate);
    if (heading) setUnitFacing(mesh, heading);

    const target = tileToWorld(coordinate, gridWidth, gridHeight);
    target.y = mesh.position.y;
    await animateSegment(mesh, scene, target);
  }
}
