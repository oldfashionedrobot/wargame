import type { Coordinate } from './types';

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
