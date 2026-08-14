import { Animation, Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from '@babylonjs/core'
import type { Coordinate, Facing, PlayerColor, Unit } from '@aw/shared'
import { tileToWorld } from './coordinates'

const UNIT_DIAMETER = 0.5
const UNIT_HEIGHT = 0.6
const FRAME_RATE = 30
const FRAMES_PER_TILE = 12

// A symmetric cylinder placeholder has no visible "front", but wiring facing to
// rotation now means a real unit model/sprite can drop in later with no renderer changes.
const FACING_ROTATION: Record<Facing, number> = {
  north: 0,
  east: Math.PI / 2,
  south: Math.PI,
  west: -Math.PI / 2,
}

const PLAYER_COLORS: Record<PlayerColor, Color3> = {
  blue: new Color3(0.2, 0.4, 0.9),
  red: new Color3(0.85, 0.2, 0.2),
  green: new Color3(0.2, 0.7, 0.3),
  yellow: new Color3(0.9, 0.8, 0.2),
}

export function createUnitMesh(
  scene: Scene,
  unit: Unit,
  color: PlayerColor,
  gridWidth: number,
  gridHeight: number,
): Mesh {
  const mesh = MeshBuilder.CreateCylinder(
    `unit-${unit.id}`,
    { height: UNIT_HEIGHT, diameter: UNIT_DIAMETER },
    scene,
  )
  const material = new StandardMaterial(`unit-${unit.id}-material`, scene)
  material.diffuseColor = PLAYER_COLORS[color]
  mesh.material = material

  const center = tileToWorld(unit.position, gridWidth, gridHeight)
  mesh.position.set(center.x, UNIT_HEIGHT / 2, center.z)
  mesh.rotation.y = FACING_ROTATION[unit.facing]
  return mesh
}

function animateSegment(mesh: Mesh, scene: Scene, target: Vector3): Promise<void> {
  return new Promise((resolve) => {
    const positionAnimation = new Animation(
      'unit-move',
      'position',
      FRAME_RATE,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    )
    positionAnimation.setKeys([
      { frame: 0, value: mesh.position.clone() },
      { frame: FRAMES_PER_TILE, value: target },
    ])
    mesh.animations = [positionAnimation]
    scene.beginAnimation(mesh, 0, FRAMES_PER_TILE, false, 1, () => resolve())
  })
}

export async function animateUnitAlongPath(
  mesh: Mesh,
  path: Coordinate[],
  gridWidth: number,
  gridHeight: number,
  scene: Scene,
): Promise<void> {
  for (const coordinate of path.slice(1)) {
    const target = tileToWorld(coordinate, gridWidth, gridHeight)
    target.y = mesh.position.y
    await animateSegment(mesh, scene, target)
  }
}
