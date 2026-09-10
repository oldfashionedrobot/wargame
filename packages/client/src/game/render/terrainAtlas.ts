import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

// Kenney's Tiny Battle, CC0. 18 by 11 tiles of 16px with no padding between
// them, so indices are row-major from the top-left and the whole sheet is one
// material. See public/textures/ for the licence.
const ATLAS_URL = '/textures/terrain-atlas.png';
const TILE_PX = 16;
export const ATLAS_COLUMNS = 18;
export const ATLAS_ROWS = 11;

const SHEET_WIDTH = ATLAS_COLUMNS * TILE_PX;
const SHEET_HEIGHT = ATLAS_ROWS * TILE_PX;

// Half a texel, pulled off every edge. Nearest sampling plus no mipmaps makes
// bleeding unlikely rather than impossible: a UV landing exactly on a tile
// boundary can round either way, and the sheet has no padding to round into.
const INSET = 0.5 / SHEET_WIDTH;
const INSET_V = 0.5 / SHEET_HEIGHT;

/**
 * The four UV pairs for one atlas tile, in the order `createTerrainMesh` winds
 * its quads: south-west, south-east, north-east, north-west.
 *
 * The sheet is loaded with `invertY` off, so it sits in memory exactly as it is
 * on disk and `v = 0` is its **top** row — no flip here, the arithmetic reads
 * straight off the sheet. A tile's top edge is *north*, because `tileToWorld`
 * maps a rising row to a rising z.
 */
export function tileUvs(index: number): number[] {
  const col = index % ATLAS_COLUMNS;
  const row = Math.floor(index / ATLAS_COLUMNS);

  const u0 = (col * TILE_PX) / SHEET_WIDTH + INSET;
  const u1 = ((col + 1) * TILE_PX) / SHEET_WIDTH - INSET;
  const vNorth = (row * TILE_PX) / SHEET_HEIGHT + INSET_V;
  const vSouth = ((row + 1) * TILE_PX) / SHEET_HEIGHT - INSET_V;

  // prettier-ignore
  return [
    u0, vSouth,   // south-west
    u1, vSouth,   // south-east
    u1, vNorth,   // north-east
    u0, vNorth,   // north-west
  ];
}

/**
 * Loads the sheet, resolving once it is actually decoded.
 *
 * Awaited rather than left to pop in: `createGameRenderer` is already async for
 * the unit models, so there is no reason to show one frame of untextured board.
 */
export function loadTerrainAtlas(scene: Scene): Promise<Texture> {
  return new Promise((resolve, reject) => {
    const texture = new Texture(
      ATLAS_URL,
      scene,
      true, // no mipmaps: they average neighbouring tiles together at distance
      // invertY. The sheet is indexed from the top and `tileUvs` already flips
      // rows to suit, so the image must be left exactly as it is on disk.
      false,
      Texture.NEAREST_SAMPLINGMODE, // pixel art, not a photograph
      () => resolve(texture),
      (message) => reject(new Error(message ?? `could not load ${ATLAS_URL}`)),
    );
  });
}
