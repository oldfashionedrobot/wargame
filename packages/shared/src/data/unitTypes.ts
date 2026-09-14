// Static content, not runtime state: what a Cavalry *is* never changes during a
// match, so it lives here rather than being copied onto every Unit instance.
// `Unit.unitTypeId` references an entry in this catalog.

export type UnitTypeId = 'infantry' | 'cavalry' | 'artillery';

// One movement type per unit type for now -- they're deliberately kept as
// separate axes because the movement-cost table is keyed by movement type, not
// by unit type, and later units will share rows (e.g. dragoons on 'horse').
export type MovementType = 'foot' | 'horse' | 'wheels';

export interface UnitType {
  id: UnitTypeId;
  name: string;
  /**
   * How this unit is written in an army. The legend lives here and nowhere
   * else -- `parseArmyGrid` inverts this column rather than keeping a second
   * copy that could drift, exactly as `parseTerrainGrid` does with terrain's.
   *
   * ⚠️ `.` is not among them and cannot be: it means *empty* in an army and
   * *plains* in a map. Two grids, two legends, one character that belongs to
   * both -- which is fine while nothing ever parses a row as both.
   */
  char: string;
  movementType: MovementType;
  // Movement points, not tiles: once terrain costs exist these are spent per
  // tile entered via the (movementType, tileType) table rather than 1-per-tile.
  movementRange: number;
  /**
   * How far this unit can shoot, inclusive at both ends, in tiles.
   *
   * ⚠️ **Two numbers, and no category beside them.** There is no
   * `canMoveAndAttack` and no direct/indirect flag: everything moves and
   * attacks, and `min: 2` *describes* a gun rather than classifying it. Every
   * behaviour AW spreads across those categories falls out of this pair --
   * including whether a defender can answer, which is "is the attacker inside
   * my own range" and nothing else.
   */
  range: { min: number; max: number };
}

/**
 * What every unit starts at and tops out at.
 *
 * ⚠️ **A constant, not a `UnitType` field, and deliberately not on `Unit`.**
 * Nothing varies it, so a per-instance copy would be the same number written
 * once per unit -- the duplication that moving `movementRange` onto the catalog
 * just removed. It lives in this file rather than beside the damage table
 * because the day some unit is tougher than another, it becomes a column of
 * `UnitType` below and the change is local.
 *
 * 100 because the damage table is read as a percentage of a full-strength
 * unit: at full health an attack scoring 55 takes 55 off, and a half-strength
 * attacker deals half of that. Choosing any other maximum would make the table
 * mean something other than what Advance Wars' numbers mean.
 */
export const MAX_HEALTH = 100;

// A Record, so adding a UnitTypeId turns every incomplete table in data/ into a
// compile error instead of a silent runtime gap.
export const UNIT_TYPES: Record<UnitTypeId, UnitType> = {
  infantry: {
    id: 'infantry',
    name: 'Infantry',
    char: 'i',
    movementType: 'foot',
    movementRange: 3,
    // ⚠️ Reaching two tiles is what gives infantry a choice against a battery:
    // trade at two and be answered, or close to one where the gun cannot fire.
    range: { min: 1, max: 2 },
  },
  cavalry: {
    id: 'cavalry',
    name: 'Cavalry',
    char: 'c',
    movementType: 'horse',
    movementRange: 4,
    // ⚠️ Adjacent only, which is the whole shape of the unit: it is shot at all
    // the way in, cannot answer a gun that outranges it, and is safe from a
    // counter once it arrives. Closing is the cost, and the charge is the point.
    range: { min: 1, max: 1 },
  },
  artillery: {
    id: 'artillery',
    name: 'Artillery',
    char: 'a',
    movementType: 'wheels',
    movementRange: 4,
    // ⚠️ `min: 2` is the unit's defining weakness and the reason cavalry has a
    // job: a gun cannot fire at what has reached it, and therefore cannot
    // counter it either -- the same predicate, not a second rule.
    range: { min: 2, max: 5 },
  },
};

/**
 * Throws on an id the catalog does not hold, rather than returning undefined.
 *
 * The types make that unreachable in-process, and guarantee nothing about a
 * `GameState` parsed back out of the database -- where a row written before a
 * unit type existed is exactly the case this catches. Same reasoning as
 * applyEvents refusing an unknown event: a silent undefined here surfaces as
 * NaN movement somewhere far away.
 */
export function getUnitType(id: UnitTypeId): UnitType {
  const unitType = UNIT_TYPES[id];
  if (!unitType) throw new Error(`unknown unit type: ${String(id)}`);
  return unitType;
}
