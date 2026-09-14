import { describe, expect, it } from 'bun:test';
import { getTerrain, getUnitType, parseTerrainGrid } from '@vod/shared';
import { createMatchState } from '../matchState';
import { DEFAULT_MAP_ID, getMap, listMaps } from './index';

// A map is content the compiler cannot check: it is characters, and every way
// of getting one wrong produces a board that loads and plays wrong. These are
// the properties every map has to satisfy, applied to all of them, so a new map
// is covered the moment it is added.
//
// ⚠️ Asserted against `createMatchState` rather than against the map alone,
// because a map no longer carries units -- so what is under test is the board
// *and the army deployed onto it*. That is more than these used to cover for
// less content: a deployment zone drawn across a river is a property of the
// pair, and neither half can see it on its own.

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
      const { units } = createMatchState(map);

      // ⚠️ A chosen constraint, not a technical one: nothing in the code needs
      // boards to agree on a size, and `createMatchState` centres the rank on
      // whatever width it is given. Every map being the same shape is a design
      // decision about what the game is, so it is asserted rather than left as
      // a coincidence for the next board to quietly break.
      it('is twenty by twenty', () => {
        expect(width).toBe(20);
        expect(height).toBe(20);
      });

      it('deploys both armies onto the board', () => {
        expect(units.length).toBeGreaterThan(0);
        for (const { position } of units) {
          expect(position.col).toBeGreaterThanOrEqual(0);
          expect(position.row).toBeGreaterThanOrEqual(0);
          expect(position.col).toBeLessThan(width);
          expect(position.row).toBeLessThan(height);
        }
      });

      // A unit on ground its own movement type cannot enter is stuck from the
      // first turn. ⚠️ Artillery is what this really guards: `wheels` is barred
      // from river and mountain outright, so a board that draws either into a
      // deployment square strands a gun where it stands.
      it('deploys every unit onto terrain it can stand on', () => {
        for (const { position, unitTypeId } of units) {
          const { movementType } = getUnitType(unitTypeId);
          const terrain = getTerrain(grid[position.row][position.col]);
          expect(terrain.cost[movementType]).not.toBeNull();
        }
      });

      it('never stacks two units on one tile', () => {
        const keys = units.map(({ position }) => `${position.col},${position.row}`);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it('gives every player the same number of units', () => {
        const perOwner = new Map<string, number>();
        for (const { owner } of units) perOwner.set(owner, (perOwner.get(owner) ?? 0) + 1);
        expect(perOwner.size).toBeGreaterThan(1); // somebody to play against
        expect(new Set(perOwner.values()).size).toBe(1); // and an even start
      });

      it('points each army at the other rather than off its own edge', () => {
        // ⚠️ Worth asserting precisely because nothing else can see it: no rule
        // reads facing until 9d, so a sign error here is invisible in play and
        // then silently becomes a damage factor. Row index increases north.
        const northmost = Math.max(...units.map((unit) => unit.position.row));
        for (const unit of units) {
          const atBack = unit.position.row === northmost;
          expect(unit.facing).toBe(atBack ? 'south' : 'north');
        }
      });

      // The board has to be crossable by everything on it, or a unit is stranded
      // from the first turn. Checked per movement type actually deployed: the
      // river is impassable to horse and wheels, so this is what proves a bridge
      // connects the two halves rather than merely existing.
      const movementTypes = [
        ...new Set(units.map(({ unitTypeId }) => getUnitType(unitTypeId).movementType)),
      ];
      for (const movementType of movementTypes) {
        it(`leaves a route across for ${movementType}`, () => {
          const passable = (col: number, row: number) =>
            getTerrain(grid[row][col]).cost[movementType] !== null;
          const seen = new Set<string>();
          const seed = units.find(
            ({ unitTypeId }) => getUnitType(unitTypeId).movementType === movementType,
          )!;
          const queue = [{ col: seed.position.col, row: seed.position.row }];
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
          for (const { position, unitTypeId } of units) {
            if (getUnitType(unitTypeId).movementType !== movementType) continue;
            expect(seen.has(`${position.col},${position.row}`)).toBe(true);
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
