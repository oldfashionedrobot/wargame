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
   * ⚠️ **Two numbers, and *almost* no category beside them.** There is no
   * direct/indirect flag: `min: 2` *describes* a gun rather than classifying it,
   * and most of what AW spreads across those categories falls out of this pair
   * -- including how far a counter reaches, which is "is the attacker inside my
   * own range" for every unit `slow` does not speak for first.
   *
   * ⚠️ **What did not fall out is `slow`.** This comment used to claim there was
   * no `canMoveAndAttack` either, and play disagreed: no number makes "may not
   * move and shoot in one turn" emerge, because it is a rule about a *turn*
   * rather than about a distance. See `slow` below.
   */
  range: { min: number; max: number };

  /**
   * This weapon has to be set up, and cannot be swung round.
   *
   * ⚠️ **One physical fact with two consequences, which is why it is one flag
   * and not two.** A piece that must be unlimbered, laid and traversed cannot
   * fire in the same turn it repositions, and cannot snap off a reply to
   * something that shot at it. Both rules are the same sentence about the gun.
   * Bundling unrelated behaviours behind one boolean would be the category this
   * catalog refuses; bundling consequences of one cause is what a name is for.
   *
   * ⚠️ **It came from play, not from design.** The catalog argued against it on
   * the grounds that behaviour should fall out of numbers, and that argument is
   * still right about direct-versus-indirect -- it is just not right about this,
   * because a turn is not a distance.
   *
   * ⚠️ It subsumes what `min: 2` was already doing at contact: a gun could not
   * answer a unit standing on it, because 1 is outside `[2, 5]`. This removes
   * **counter-battery** as well, where two guns within reach of each other used
   * to answer each other.
   */
  slow: boolean;
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

/**
 * A health, brought inside its bounds.
 *
 * ⚠️ **Because the bounds were being written inline, and only half of them
 * were.** `resolveBattle` clamped the bottom with a literal `Math.max(0, …)` and
 * nothing anywhere clamped the top -- so "0 to `MAX_HEALTH`" was a rule the code
 * stated in pieces and the next person to compute a health would state again,
 * possibly differently. One function is a thing nobody can write half of.
 *
 * ⚠️ **For producers, not for `applyEvents`.** Clamping in the reducer would
 * cover every writer forever, which is tempting -- but it would *silently
 * correct* a bad event rather than refusing it, and this codebase refuses
 * loudly: `getUnitType` throws, and the reducer throws on an unknown event. A
 * health out of range can only come from a resolution bug, and quietly healing
 * it buries that bug in the log for good.
 */
export function clampHealth(value: number): number {
  return Math.min(MAX_HEALTH, Math.max(0, value));
}

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
    slow: false,
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
    slow: false,
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
    slow: true,
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
