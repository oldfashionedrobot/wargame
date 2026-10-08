import { describe, expect, it } from 'bun:test';
import { getTerrain, getUnitType, MAX_HEALTH, parseTerrainGrid } from '@wargame/shared';
import { createMatchState, DEPLOYMENT_ZONE, PLAYERS } from '../matchState';
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
      it('is twelve by twelve', () => {
        expect(width).toBe(12);
        expect(height).toBe(12);
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

      // ⚠️ Cheap, and it guards a failure that is silent rather than loud: a
      // unit deployed without health types as `number` and is `undefined`, and
      // `undefined` arithmetic is `NaN` -- so the first symptom would be a
      // damage figure rather than a crash, several phases from here.
      it('deploys every unit at full health', () => {
        for (const { health } of units) expect(health).toBe(MAX_HEALTH);
      });

      it('never stacks two units on one tile', () => {
        const keys = units.map(({ position }) => `${position.col},${position.row}`);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it('gives every player a roster to play with', () => {
        const perOwner = new Map<string, number>();
        for (const { owner } of units) perOwner.set(owner, (perOwner.get(owner) ?? 0) + 1);
        expect(perOwner.size).toBeGreaterThan(1); // somebody to play against
        for (const count of perOwner.values()) expect(count).toBeGreaterThan(0);
      });

      // ⚠️ **The zone, not the army** -- and that is the stronger property. A
      // board validated against one formation is a board validated against a
      // formation nobody may field once composition is a choice; a board whose
      // deployment zones are standable throughout is one where *every* legal
      // army deploys. It is also what makes an existing convention checkable:
      // a river may only leave the board where an army does not stand.
      //
      // ⚠️ **Deployed, not worked out.** The engine places the far zone by
      // rotating the near one, so a test computing the columns itself checks the
      // wrong ones on an odd-width board. A full zone for both seats puts a unit
      // on every square; the count makes sure an empty deployment cannot pass.
      it('leaves both deployment zones standable by every movement type', () => {
        const fullZone = Array.from({ length: DEPLOYMENT_ZONE.depth }, () =>
          'i'.repeat(DEPLOYMENT_ZONE.width),
        );
        const everySquare = createMatchState(
          map,
          PLAYERS.map((player) => ({ player, army: fullZone })),
        ).units;
        expect(everySquare.length).toBe(
          PLAYERS.length * DEPLOYMENT_ZONE.width * DEPLOYMENT_ZONE.depth,
        );

        for (const { position } of everySquare) {
          const { col, row } = position;
          // ⚠️ **Read off the cost table, not the unit catalog.** Every movement
          // type terrain knows how to price is one a unit could arrive on,
          // including one no unit uses yet -- which is the case a list taken
          // from today's roster would quietly stop covering.
          for (const [movementType, cost] of Object.entries(getTerrain(grid[row][col]).cost)) {
            // The whole square in the assertion, so a failure names the tile
            // and the movement type rather than just a line number.
            expect(`${col},${row} for ${movementType}: ${cost === null ? 'barred' : 'ok'}`).toBe(
              `${col},${row} for ${movementType}: ok`,
            );
          }
        }
      });

      it('points each army at the other rather than off its own edge', () => {
        // ⚠️ A rule reads this now: a shot from directly behind is never
        // answered, so deployment facing the wrong way would hand every opening
        // exchange's counter to whoever moved second. Row index increases north,
        // and that is the sign worth stating -- it is the one thing here that
        // can be backwards while every individual value still looks reasonable.
        //
        // ⚠️ **Asked of the owner, not of the row.** This found the northmost
        // row and expected everything else to face north, which holds only
        // while an army is one rank deep -- a two-rank formation put a player's
        // own back rank on the wrong side of the comparison. Facing is a
        // property of whose army it is.
        const [near, far] = [...new Set(units.map((unit) => unit.owner))];
        for (const unit of units) {
          expect(unit.facing).toBe(unit.owner === near ? 'north' : 'south');
        }
        expect(far).toBeDefined();
      });

      // The board has to be crossable by everything on it, or a unit is stranded
      // from the first turn. Checked per movement type actually deployed.
      // ⚠️ **It only has teeth for `wheels` now.** It was written when a river
      // stopped horse as well, so it proved a bridge connected the two halves;
      // since horse can ford, `foot` and `horse` pass on every board that is not
      // solid rock. Kept at full breadth anyway -- it costs one flood fill, and
      // it is the movement type *not* yet invented that it is really for.
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
