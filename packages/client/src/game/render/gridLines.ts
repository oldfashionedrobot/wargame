import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { Scene } from '@babylonjs/core/scene';
import { tileToWorld, TILE_SIZE } from './coordinates';

const LINE_HEIGHT = 0.012;

/**
 * ⚠️ A mid grey, very faintly. These started near-black at 35%, which drew a
 * hard rule between every pair of tiles and read as a wireframe laid over the
 * board. White was tried next and overcorrected -- a bright seam is still a
 * seam. Grey at 7% neither cuts the board nor lights it: the eye finds a
 * boundary when it goes looking for one and otherwise sees terrain, which is
 * the whole job of a grid here.
 */
const LINE_COLOR = new Color4(0.35, 0.36, 0.36, 1);
const LINE_ALPHA = 0.07;

/**
 * One flat grid across the whole board, at the height of the ground.
 *
 * ⚠️ This was briefly a square per tile at each tile's *own* surface, because a
 * raised tile would otherwise have the line running through it. That is no
 * longer a case that arises: a mountain is a mesa standing on an ordinary tile,
 * so the **ground is flat everywhere** and only props rise above it. The grid
 * marks the board's floor, and the floor is one plane.
 *
 * Flat also means long spans rather than per-tile outlines, which means every
 * interior edge is drawn **once** instead of by both of its tiles — so the
 * alpha is the alpha, rather than roughly double it over the interior.
 *
 * Nothing here touches the overlays. A hover or range tint sits at
 * `surfaceAt`, which is the top of whatever you would stand on, so hovering a
 * mesa lights the mesa rather than the floor hidden underneath it.
 */
export function createGridLines(
  scene: Scene,
  groundLevel: number,
  gridWidth: number,
  gridHeight: number,
): LinesMesh {
  const half = TILE_SIZE / 2;
  const y = groundLevel + LINE_HEIGHT;

  const southWest = tileToWorld({ col: 0, row: 0 }, gridWidth, gridHeight);
  const northEast = tileToWorld({ col: gridWidth - 1, row: gridHeight - 1 }, gridWidth, gridHeight);
  const minX = southWest.x - half;
  const maxX = northEast.x + half;
  const minZ = southWest.z - half;
  const maxZ = northEast.z + half;

  const lines: Vector3[][] = [];
  for (let col = 0; col <= gridWidth; col++) {
    const x = minX + col * TILE_SIZE;
    lines.push([new Vector3(x, y, minZ), new Vector3(x, y, maxZ)]);
  }
  for (let row = 0; row <= gridHeight; row++) {
    const z = minZ + row * TILE_SIZE;
    lines.push([new Vector3(minX, y, z), new Vector3(maxX, y, z)]);
  }

  const colors = lines.map((line) => line.map(() => LINE_COLOR));
  const gridLines = CreateLineSystem('grid-lines', { lines, colors }, scene);
  gridLines.alpha = LINE_ALPHA;
  gridLines.isPickable = false; // picking is plane arithmetic, never a ray at a mesh
  return gridLines;
}
