import type { MovementType } from './unitTypes';

// Static content, like unitTypes beside it: what a forest costs a horse never
// changes mid-match. `TileType` lives here rather than in types.ts because it
// is content vocabulary -- the set of things a map can be made of -- and this
// table is what gives each of them meaning.

export type TileType = 'plains' | 'road' | 'bridge' | 'forest' | 'mountain' | 'river';

export interface Terrain {
  /**
   * How this terrain is written in a map source file. The legend lives here
   * and nowhere else -- `parseTerrainGrid` inverts this column rather than
   * keeping a second copy that could drift.
   */
  char: string;
  /**
   * Stars of cover: each is a 10% damage reduction at full defender HP.
   * Unread until phase 8 -- it lives here now so that adding a terrain type
   * stays one edit rather than two, and so a matchup table is never tuned
   * against defence stubbed to zero.
   */
  defense: number;
  /**
   * Movement points to *enter* this tile, per movement type. `null` is
   * impassable -- not "expensive", genuinely no route through.
   */
  cost: Record<MovementType, number | null>;
}

// A Record over TileType, so adding a terrain type turns every incomplete
// table -- here, and the renderer's colours -- into a compile error rather
// than a tile that silently costs undefined.
export const TERRAIN: Record<TileType, Terrain> = {
  // Roads and bridges are mechanically identical; the split exists so the
  // renderer can draw a crossing over water. `wheels` paying 2 on plains and
  // 1 on road is the whole of "artillery prefers roads".
  road: { char: '-', defense: 0, cost: { foot: 1, horse: 1, wheels: 1 } },
  bridge: { char: '=', defense: 0, cost: { foot: 1, horse: 1, wheels: 1 } },
  plains: { char: '.', defense: 1, cost: { foot: 1, horse: 1, wheels: 2 } },
  forest: { char: 'f', defense: 2, cost: { foot: 1, horse: 2, wheels: 3 } },
  // Rough ground: passable on foot at a price, closed to anything mounted or
  // wheeled. This is what makes cavalry fast in the open rather than fast
  // everywhere.
  mountain: { char: '^', defense: 4, cost: { foot: 2, horse: null, wheels: null } },
  river: { char: '~', defense: 0, cost: { foot: 2, horse: null, wheels: null } },
};

/**
 * Throws on a tile the table does not hold, for the same reason `getUnitType`
 * does: the types make it unreachable in-process and guarantee nothing about
 * a `GameState` parsed back out of the database, where a board written before
 * a terrain existed is exactly the case. An undefined here would surface as
 * NaN movement somewhere else entirely.
 */
export function getTerrain(tile: TileType): Terrain {
  const terrain = TERRAIN[tile];
  if (!terrain) throw new Error(`unknown terrain: ${String(tile)}`);
  return terrain;
}
