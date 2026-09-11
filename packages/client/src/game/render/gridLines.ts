import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { Coordinate } from '@vod/shared';
import type { Scene } from '@babylonjs/core/scene';
import { tileToWorld, TILE_SIZE } from './coordinates';

const LINE_HEIGHT = 0.012;

/**
 * ⚠️ Light, not dark. These were near-black at 35%, which put a hard rule
 * between every pair of tiles and read as a wireframe laid over the board
 * rather than as part of it. White at a low alpha lifts the seam instead of
 * cutting it — the same thing a highlight does, which is what a grid is for
 * here: saying where one tile ends, not drawing a cage.
 */
const LINE_COLOR = new Color4(1, 1, 1, 1);
// ⚠️ Reads at roughly double this over the interior of the board: an edge
// between two tiles is drawn by both of them. See the note on `createGridLines`.
const LINE_ALPHA = 0.1;

/**
 * A square per tile, each at the height that tile's surface actually is.
 *
 * ⚠️ Not four long spans across the board, which is what this was before there
 * were raised tiles: a line pinned at one `y` runs *through* a mountain's pad
 * rather than around it. Outlining each tile separately is what lets every
 * segment sit on its own ground, and where two tiles differ in height the two
 * lines separate and draw the step.
 *
 * The cost is that an interior edge belongs to both its tiles and is therefore
 * drawn twice, compositing to roughly twice the alpha. That is uniform across
 * the whole interior, so it reads as one weight; only the board's outer rim is
 * lighter, and that edge is against the background rather than against another
 * tile anyway.
 */
export function createGridLines(
  scene: Scene,
  surfaceAt: (coordinate: Coordinate) => number,
  gridWidth: number,
  gridHeight: number,
): LinesMesh {
  const half = TILE_SIZE / 2;
  const lines: Vector3[][] = [];

  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const { x, z } = tileToWorld({ col, row }, gridWidth, gridHeight);
      const y = surfaceAt({ col, row }) + LINE_HEIGHT;

      lines.push([
        new Vector3(x - half, y, z - half),
        new Vector3(x + half, y, z - half),
        new Vector3(x + half, y, z + half),
        new Vector3(x - half, y, z + half),
        new Vector3(x - half, y, z - half),
      ]);
    }
  }

  const colors = lines.map((line) => line.map(() => LINE_COLOR));
  const gridLines = CreateLineSystem('grid-lines', { lines, colors }, scene);
  gridLines.alpha = LINE_ALPHA;
  gridLines.isPickable = false; // picking is plane arithmetic, never a ray at a mesh
  return gridLines;
}
