import type { Coordinate, UnitTypeId } from '@vod/shared';

/**
 * A battlefield: terrain as character rows, plus where the units start.
 *
 * ⚠️ **Map ids are immutable.** A match records the id it was built from, so
 * changing a map's terrain under its id retroactively changes what every
 * existing match claims to have been played on. A changed map gets a new id.
 */
export interface GameMap {
  id: string;
  name: string;
  /**
   * Parsed by `parseTerrainGrid`. Every row must be the same length.
   *
   * ⚠️ **`rows[0]` is the row nearest the camera** — the bottom of the screen.
   * Row index increases north, so a map written top-down on paper is upside
   * down here. Author it bottom-up, or write it out and reverse it.
   */
  rows: string[];
  units: MapUnit[];
}

export interface MapUnit {
  at: Coordinate;
  type: UnitTypeId;
  /**
   * An index into the match's players, not a `PlayerId` — a map cannot know
   * who is playing it. Resolved by `createMatchState`.
   */
  owner: number;
}
