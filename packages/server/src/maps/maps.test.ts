import { describe, expect, it } from 'bun:test';
import { getTerrain, getUnitType, parseTerrainGrid } from '@vod/shared';
import { DEFAULT_MAP_ID, getMap, listMaps } from './index';

// A map is content the compiler cannot check: it is characters and
// coordinates, and every way of getting one wrong produces a board that loads
// and plays wrong. These are the properties every map has to satisfy, applied
// to all of them, so a new map is covered the moment it is added.

describe('every map', () => {
  const maps = listMaps();

  it('there is at least one, and the default is among them', () => {
    expect(maps.length).toBeGreaterThan(0);
    expect(getMap(DEFAULT_MAP_ID).id).toBe(DEFAULT_MAP_ID);
  });

  for (const map of maps) {
    describe(map.id, () => {
      const grid = parseTerrainGrid(map.rows); // throws on a ragged row or bad char
      const height = grid.length;
      const width = grid[0].length;

      it('places every unit on the board', () => {
        for (const { at } of map.units) {
          expect(at.col).toBeGreaterThanOrEqual(0);
          expect(at.row).toBeGreaterThanOrEqual(0);
          expect(at.col).toBeLessThan(width);
          expect(at.row).toBeLessThan(height);
        }
      });

      // A unit on impassable ground can never move, and one on terrain its own
      // movement type cannot enter is stuck from the first turn.
      it('places every unit on terrain it can stand on', () => {
        for (const { at, type } of map.units) {
          const { movementType } = getUnitType(type);
          const terrain = getTerrain(grid[at.row][at.col]);
          expect(terrain.cost[movementType]).not.toBeNull();
        }
      });

      it('never stacks two units on one tile', () => {
        const keys = map.units.map(({ at }) => `${at.col},${at.row}`);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it('gives every player the same number of units', () => {
        const perOwner = new Map<number, number>();
        for (const { owner } of map.units) {
          perOwner.set(owner, (perOwner.get(owner) ?? 0) + 1);
        }
        expect(perOwner.size).toBeGreaterThan(1); // somebody to play against
        expect(new Set(perOwner.values()).size).toBe(1); // and an even start
      });

      // The board has to be crossable by everything on it, or a unit is stranded
      // from the first turn. Checked per movement type actually placed: the river
      // is impassable to horse and wheels, so this is what proves the bridge
      // connects the two halves rather than merely existing.
      const movementTypes = [
        ...new Set(map.units.map(({ type }) => getUnitType(type).movementType)),
      ];
      for (const movementType of movementTypes) {
        it(`leaves a route across for ${movementType}`, () => {
          const passable = (col: number, row: number) =>
            getTerrain(grid[row][col]).cost[movementType] !== null;
          const seen = new Set<string>();
          const seed = map.units.find(
            ({ type }) => getUnitType(type).movementType === movementType,
          )!;
          const queue = [{ col: seed.at.col, row: seed.at.row }];
          while (queue.length) {
            const { col, row } = queue.shift()!;
            const key = `${col},${row}`;
            if (seen.has(key)) continue;
            if (col < 0 || row < 0 || col >= width || row >= height) continue;
            if (!passable(col, row)) continue;
            seen.add(key);
            queue.push({ col: col + 1, row }, { col: col - 1, row });
            queue.push({ col, row: row + 1 }, { col, row: row - 1 });
          }
          for (const { at, type } of map.units) {
            if (getUnitType(type).movementType !== movementType) continue;
            expect(seen.has(`${at.col},${at.row}`)).toBe(true);
          }
          // And the far side is reachable, not just the corner it started in.
          expect(seen.size).toBeGreaterThan((width * height) / 2);
        });
      }
    });
  }
});

describe('getMap', () => {
  it('throws on an id no map has', () => {
    expect(() => getMap('atlantis')).toThrow(/unknown map: atlantis/);
  });
});
