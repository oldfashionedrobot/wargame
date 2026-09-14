import { describe, expect, it } from 'bun:test';
import { getUnitType, UNIT_TYPES } from './unitTypes';
import type { UnitTypeId } from './unitTypes';

// The catalog was dead code until 6a wired `Unit.unitTypeId` to it. These
// cover the contract the rest of the rulebook now leans on, not the numbers:
// asserting that cavalry moves 6 would fail every time the game is tuned,
// which says nothing about whether the lookup works.

describe('getUnitType', () => {
  it('returns the catalog entry for every id', () => {
    for (const id of Object.keys(UNIT_TYPES) as UnitTypeId[]) {
      expect(getUnitType(id).id).toBe(id);
    }
  });

  it('gives every unit type a positive movement range and a movement type', () => {
    for (const unitType of Object.values(UNIT_TYPES)) {
      expect(unitType.movementRange).toBeGreaterThan(0);
      expect(['foot', 'horse', 'wheels']).toContain(unitType.movementType);
    }
  });

  it('gives every unit type a coherent shooting range', () => {
    for (const { range } of Object.values(UNIT_TYPES)) {
      expect(Number.isInteger(range.min)).toBe(true);
      expect(Number.isInteger(range.max)).toBe(true);
      // A minimum below 1 would mean shooting your own tile; a max below the
      // min is a band nothing can ever be inside, so the unit could never fire
      // and could never counter -- both silent, since no rule reads a category.
      expect(range.min).toBeGreaterThanOrEqual(1);
      expect(range.max).toBeGreaterThanOrEqual(range.min);
    }
  });

  // ⚠️ A design assertion rather than a technical one, like the maps suite's
  // "is twelve by twelve". Nothing breaks if every unit can shoot at one tile
  // -- but a gun that can defend itself at arm's length leaves cavalry with no
  // job, and the whole triangle rests on that not being true. Loud, here,
  // rather than discovered in a playtest.
  it('keeps at least one unit unable to fire at what has reached it', () => {
    const helplessUpClose = Object.values(UNIT_TYPES).filter(({ range }) => range.min > 1);
    expect(helplessUpClose.length).toBeGreaterThan(0);
  });

  // Types make this unreachable in-process and guarantee nothing about a
  // GameState parsed back out of the database -- a row written before a unit
  // type existed is exactly the case. Loud beats an undefined that surfaces
  // as NaN movement somewhere else entirely.
  it('throws on an id the catalog does not hold', () => {
    expect(() => getUnitType('trebuchet' as UnitTypeId)).toThrow(/unknown unit type/);
  });
});
