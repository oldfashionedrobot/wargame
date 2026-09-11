// Side effect: installs scene.beginAnimation -- undefined at runtime without it.
import '@babylonjs/core/Animations/animatable';
import { Animation } from '@babylonjs/core/Animations/animation';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { directionBetween } from '@vod/shared';
import type { Coordinate, Facing, PlayerColor, Unit } from '@vod/shared';
import { tileToWorld } from './coordinates';
import type { UnitModels } from './unitModels';

const FRAME_RATE = 60;
// One tile of walking, at FRAME_RATE. The pace every unit moves at -- there is
// no per-type speed, so this is the single dial for how long a move takes: a
// three-tile move is 3x this. 9/60 = 0.15s.
const FRAMES_PER_TILE = 9;

// The models face +Z, which is what north is here: tileToWorld maps a rising
// row to a rising z. So zero rotation is zero correction.
const FACING_ROTATION: Record<Facing, number> = {
  north: 0,
  east: Math.PI / 2,
  south: Math.PI,
  west: -Math.PI / 2,
};

// Chosen to read against the board rather than to be canonical blue and red:
// the ground is a bright saturated teal, so the old darker colours sank into
// it. Green is deliberately pushed toward lime -- a true green sits almost on
// top of the grass, which matters the day there are four players.
const PLAYER_COLORS: Record<PlayerColor, Color3> = {
  blue: new Color3(0.35, 0.6, 1),
  red: new Color3(1, 0.33, 0.3),
  green: new Color3(0.6, 0.92, 0.25),
  yellow: new Color3(1, 0.85, 0.25),
};

/**
 * How much of its own colour a unit gives off regardless of the light.
 *
 * Units are mostly vertical -- soldiers, horses, a gun carriage -- and the only
 * light is hemispheric from above, so their sides fall into shadow exactly
 * where the silhouette needs to read. A floor of self-illumination keeps them
 * legible from any angle without flattening the shading that gives them shape.
 */
const UNIT_GLOW = 0.28;

/**
 * One material per player colour, not per unit -- the models arrive untextured
 * and near-white, so a flat diffuse colour is the whole of a side's identity.
 * The scene is the cache: looking the material up by name keeps this a plain
 * function with no state of its own.
 */
function unitMaterial(scene: Scene, color: PlayerColor): StandardMaterial {
  const name = `unit-${color}`;
  const existing = scene.getMaterialByName(name);
  if (existing) return existing as StandardMaterial;

  const material = new StandardMaterial(name, scene);
  material.diffuseColor = PLAYER_COLORS[color];
  material.emissiveColor = PLAYER_COLORS[color].scale(UNIT_GLOW);
  // Matte, like the ground. Terrain kills its own specular and the kit's
  // materials define only a diffuse colour, so a unit left at the default white
  // highlight reads as being made of a different substance from the board it
  // stands on.
  material.specularColor = new Color3(0, 0, 0);
  return material;
}

export function createUnitMesh(
  scene: Scene,
  models: UnitModels,
  unit: Unit,
  color: PlayerColor,
  surfaceAt: (coordinate: Coordinate) => number,
  gridWidth: number,
  gridHeight: number,
): TransformNode {
  const node = models.instantiate(unit.unitTypeId, `unit-${unit.id}`);

  const material = unitMaterial(scene, color);
  for (const mesh of node.getChildMeshes()) mesh.material = material;

  // The models' origin is their base, so they stand on the board rather than
  // being lifted by half their height the way a centre-origin cylinder was.
  const center = tileToWorld(unit.position, gridWidth, gridHeight);
  node.position.set(center.x, surfaceAt(unit.position), center.z);
  setUnitFacing(node, unit.facing);
  return node;
}

/**
 * Points a unit a compass direction. The only writer of `rotation.y`, and it
 * writes it on our own node rather than the loader's `__root__` -- see
 * `unitModels.ts` for why that distinction matters.
 */
export function setUnitFacing(node: TransformNode, facing: Facing): void {
  node.rotation.y = FACING_ROTATION[facing];
}

// Exact reverse lookup, and exact is fine: `setUnitFacing` is the only writer
// of `rotation.y` and it only ever writes a value straight out of this table,
// so no arithmetic has happened to drift it.
const ROTATION_FACING = new Map<number, Facing>(
  (Object.entries(FACING_ROTATION) as [Facing, number][]).map(([facing, y]) => [y, facing]),
);

/** Which way a unit is pointing, for anything that has to put it back. */
export function getUnitFacing(node: TransformNode): Facing {
  return ROTATION_FACING.get(node.rotation.y) ?? 'north';
}

function animateSegment(mesh: TransformNode, scene: Scene, target: Vector3): Promise<void> {
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
  mesh: TransformNode,
  path: Coordinate[],
  surfaceAt: (coordinate: Coordinate) => number,
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
    // Carried between surfaces rather than pinned, so a unit is seen to climb
    // onto a plateau or step up onto a bridge instead of gliding through it.
    target.y = surfaceAt(coordinate);
    await animateSegment(mesh, scene, target);
  }
}
