import type { Coordinate, Facing } from './types';

export function coordinatesEqual(a: Coordinate, b: Coordinate): boolean {
  return a.col === b.col && a.row === b.row;
}

// Coordinate objects don't have value equality in JS, so Map/Set usage needs
// a string key instead.
export function coordinateKey(coordinate: Coordinate): string {
  return `${coordinate.col},${coordinate.row}`;
}

/**
 * Orthogonal steps between two tiles -- Manhattan, because the board is.
 *
 * ⚠️ **Not Euclidean, and not Chebyshev.** Movement is orthogonal, so two tiles
 * diagonally apart are *two* steps away, and a range band that counted them as
 * one would let a gun reach corners its own movement could not. Every rule that
 * measures distance measures it the same way: a shooting range now, whether a
 * defender can answer at 9g, and what a panel may target at 9h.
 *
 * This is deliberately the **only** distance in the codebase. Written inline at
 * each of those three, it is three chances to disagree about a diagonal.
 */
export function tileDistance(a: Coordinate, b: Coordinate): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

// A rule, not a rendering concern -- what's on the board is a game fact, so
// pathfinding and picking both read it from here.
export function isWithinGrid(
  coordinate: Coordinate,
  gridWidth: number,
  gridHeight: number,
): boolean {
  return (
    coordinate.col >= 0 &&
    coordinate.col < gridWidth &&
    coordinate.row >= 0 &&
    coordinate.row < gridHeight
  );
}

/**
 * Which way to look at something any distance off.
 *
 * ⚠️ **The generalisation of `directionBetween`, which answers only for a single
 * step.** Attacking points a unit at its target, and a target four tiles away on
 * a diagonal is not one step in any direction -- so the dominant axis decides,
 * and a tie goes to the row. Arbitrary, but it has to be *some* answer and an
 * arbitrary one stated once beats two rules for near and far.
 *
 * Returns the unit's existing facing for its own tile, which the caller supplies
 * -- there is no direction from a tile to itself.
 */
export function facingToward(from: Coordinate, to: Coordinate, fallback: Facing): Facing {
  const east = to.col - from.col;
  const north = to.row - from.row;
  if (east === 0 && north === 0) return fallback;
  if (Math.abs(north) >= Math.abs(east)) return north > 0 ? 'north' : 'south';
  return east > 0 ? 'east' : 'west';
}

/** The four, as data: a runtime check needs a list the type alone cannot give. */
export const FACINGS = ['north', 'east', 'south', 'west'] as const satisfies readonly Facing[];

export function isFacing(value: unknown): value is Facing {
  return typeof value === 'string' && (FACINGS as readonly string[]).includes(value);
}

/**
 * Which way you face having stepped from `from` to `to`, or `null` if that is
 * not one orthogonal step.
 *
 * `null` covers both cases a caller has to handle: standing still, where there
 * is no direction to derive and facing should be left alone, and a jump, which
 * `validatePath` refuses anyway.
 */
export function directionBetween(from: Coordinate, to: Coordinate): Facing | null {
  const dCol = to.col - from.col;
  const dRow = to.row - from.row;
  if (Math.abs(dCol) + Math.abs(dRow) !== 1) return null;

  if (dCol === 1) return 'east';
  if (dCol === -1) return 'west';
  // Row 0 renders at the near edge, so a rising row index faces away.
  return dRow === 1 ? 'north' : 'south';
}

/** Which way `facing` is looking, reversed. */
function opposite(facing: Facing): Facing {
  return FACINGS[(FACINGS.indexOf(facing) + 2) % FACINGS.length];
}

/**
 * Where a shot is coming from, relative to the way its target is looking.
 *
 * ⚠️ **`attackerAt` is measured *from* the defender, not toward it.** The
 * direction from a unit to its attacker equalling its facing means it is
 * *looking at* the shot, which is `front`. Read the other way round every case
 * inverts and nothing about the result looks wrong -- the same sign error
 * `maps.test.ts` guards for deployment, and the reason both ends are asserted
 * rather than just one.
 *
 * Diagonals inherit `facingToward`'s tie-break -- dominant axis, ties to row --
 * so a gun sitting off the axis is classified by the same arbitrary rule that
 * decides which way the attacker itself turns. Arbitrary, but stated once and
 * shared, which is what `facingToward` is for.
 *
 * ⚠️ `flank` is returned and read by nothing: `wouldCounter` asks only about
 * `rear`, and charge wants all three in 10a. The one place this file knowingly
 * describes more than the game currently uses.
 */
export function attackSide(
  defenderFacing: Facing,
  defenderAt: Coordinate,
  attackerAt: Coordinate,
): 'front' | 'flank' | 'rear' {
  // Its own tile is unreachable -- nothing may target itself -- and `facingToward`
  // answers with the fallback, so this reads `front` rather than throwing.
  const towardAttacker = facingToward(defenderAt, attackerAt, defenderFacing);
  if (towardAttacker === defenderFacing) return 'front';
  return towardAttacker === opposite(defenderFacing) ? 'rear' : 'flank';
}
