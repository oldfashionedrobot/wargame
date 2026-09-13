import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { TILE_SIZE } from './coordinates';

/**
 * How far the slab hangs below the board's floor.
 *
 * Deep enough to read as an object from a shallow orbit, shallow enough that it
 * never reaches the camera's near plane. Purely a look -- nothing stands on it,
 * nothing picks against it, and `surfaceAt` does not know it exists.
 */
const BASE_THICKNESS = 0.45;

/**
 * How far the slab's top sits *below* the floor it hangs under.
 *
 * ⚠️ Not a fudge factor — without it the top face is coplanar with the ground
 * tiles, which are flat planes with no thickness of their own, and coplanar
 * surfaces depth-fight. The symptom is not subtle: the board mottles brown in
 * bands that move as the camera does, because which surface wins varies with
 * depth across the screen. Small enough that the gap cannot be seen from any
 * angle the camera is allowed to reach.
 */
const BASE_SINK = 0.01;

/**
 * ⚠️ Darker than any terrain on the board, deliberately.
 *
 * The slab's job is to stop the eye at the board's edge, and an edge that is
 * lighter than what it frames reads as more board. Matte like everything else,
 * with a floor of self-illumination for the same reason units have one: the
 * sides are vertical and the only light is hemispheric from above, so without
 * it the thing that defines the silhouette renders as a black band.
 */
const BASE_COLOR = new Color3(0.27, 0.22, 0.18);
const BASE_GLOW = 0.35;

/**
 * A slab under the grid, so the board is an object rather than geometry that
 * stops.
 *
 * Sized to the board exactly: the sides sit flush under the outermost tiles, so
 * the silhouette from directly above is the same rectangle the grid lines draw.
 * A lip would be a second decision about how wide, and this phase does not need
 * one.
 *
 * ⚠️ Not pickable, like the terrain and the grid. `screenToTile` is plane
 * arithmetic against the surfaces a unit can stand on, and a slab is neither --
 * a click that lands on the side of the board should miss, not resolve to
 * whichever tile sits above it.
 */
export function createBoardBase(
  scene: Scene,
  boardFloor: number,
  gridWidth: number,
  gridHeight: number,
): Mesh {
  const base = CreateBox(
    'board-base',
    {
      width: gridWidth * TILE_SIZE,
      depth: gridHeight * TILE_SIZE,
      height: BASE_THICKNESS,
    },
    scene,
  );

  // tileToWorld centres the board on the origin, so the slab needs no offset in
  // x or z. CreateBox centres on its own origin, hence the half.
  //
  // ⚠️ `boardFloor` must be the **lowest** ground on the board, not the highest.
  // Ground models do not all sit at one height -- grass measures 0.00 and a road
  // 0.05 -- so hanging the slab off the maximum puts its top face above every
  // grass tile and paints the board brown.
  base.position.y = boardFloor - BASE_SINK - BASE_THICKNESS / 2;

  const material = new StandardMaterial('board-base', scene);
  material.diffuseColor = BASE_COLOR;
  material.emissiveColor = BASE_COLOR.scale(BASE_GLOW);
  material.specularColor = new Color3(0, 0, 0);
  base.material = material;
  base.isPickable = false;

  return base;
}
