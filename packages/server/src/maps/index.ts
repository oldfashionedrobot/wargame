import { classic } from './classic';
import { crossroads } from './crossroads';
import { lakeland } from './lakeland';
import { twoBridges } from './twoBridges';
import type { GameMap } from './types';

export type { GameMap } from './types';

// Every map, by id. Maps are code rather than rows because they are reviewed
// as diffs; see *Maps in a table* in the roadmap for when that changes.
const MAPS: Record<string, GameMap> = Object.fromEntries(
  [classic, crossroads, twoBridges, lakeland].map((map) => [map.id, map]),
);

export const DEFAULT_MAP_ID = classic.id;

export function listMaps(): GameMap[] {
  return Object.values(MAPS);
}

/** Throws on an unknown id, the same way the other content lookups do. */
export function getMap(id: string): GameMap {
  const map = MAPS[id];
  if (!map) throw new Error(`unknown map: ${id}`);
  return map;
}
