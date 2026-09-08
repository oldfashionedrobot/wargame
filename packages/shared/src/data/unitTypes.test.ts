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

  // Types make this unreachable in-process and guarantee nothing about a
  // GameState parsed back out of the database -- a row written before a unit
  // type existed is exactly the case. Loud beats an undefined that surfaces
  // as NaN movement somewhere else entirely.
  it('throws on an id the catalog does not hold', () => {
    expect(() => getUnitType('trebuchet' as UnitTypeId)).toThrow(/unknown unit type/);
  });
});
