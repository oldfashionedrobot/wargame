import type { Coordinate, Facing } from './types';

export function coordinatesEqual(a: Coordinate, b: Coordinate): boolean {
  return a.col === b.col && a.row === b.row;
}

// Coordinate objects don't have value equality in JS, so Map/Set usage needs
// a string key instead.
export function coordinateKey(coordinate: Coordinate): string {
  return `${coordinate.col},${coordinate.row}`;
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
