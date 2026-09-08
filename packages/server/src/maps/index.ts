import { classic } from './classic';
import type { GameMap } from './types';

export type { GameMap } from './types';

// Every map, by id. Maps are code rather than rows because there is one of
// them and it is reviewed as a diff; see *Maps in a table* in the roadmap for
// when that changes.
const MAPS: Record<string, GameMap> = { [classic.id]: classic };

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
