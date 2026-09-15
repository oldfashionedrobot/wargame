import { describe, expect, it } from 'bun:test';
import {
  coordinateKey,
  coordinatesEqual,
  directionBetween,
  isWithinGrid,
  tileDistance,
} from './coordinate';

const at = (col: number, row: number) => ({ col, row });

describe('coordinatesEqual', () => {
  it('compares by value, since Coordinate has no identity in JS', () => {
    expect(coordinatesEqual(at(2, 3), at(2, 3))).toBe(true);
    expect(coordinatesEqual(at(2, 3), at(3, 2))).toBe(false);
  });
});

describe('coordinateKey', () => {
  // It exists so coordinates can key a Map. Two different tiles sharing a key
  // would silently merge in the movement search.
  it('gives transposed coordinates different keys', () => {
    expect(coordinateKey(at(1, 2))).not.toBe(coordinateKey(at(2, 1)));
  });

  it('gives equal coordinates the same key', () => {
    expect(coordinateKey(at(4, 7))).toBe(coordinateKey(at(4, 7)));
  });
});

describe('isWithinGrid', () => {
  // The bounds are half-open, and both axes are checked -- a version that
  // tested only one, or used <= on the far edge, is what this pins.
  it('accepts the corners and rejects everything one step past them', () => {
    expect(isWithinGrid(at(0, 0), 4, 3)).toBe(true);
    expect(isWithinGrid(at(3, 2), 4, 3)).toBe(true); // last column, last row
    expect(isWithinGrid(at(4, 2), 4, 3)).toBe(false); // one column too far
    expect(isWithinGrid(at(3, 3), 4, 3)).toBe(false); // one row too far
    expect(isWithinGrid(at(-1, 0), 4, 3)).toBe(false);
    expect(isWithinGrid(at(0, -1), 4, 3)).toBe(false);
  });
});

describe('directionBetween', () => {
  it('names each of the four orthogonal steps', () => {
    expect(directionBetween(at(1, 1), at(2, 1))).toBe('east');
    expect(directionBetween(at(1, 1), at(0, 1))).toBe('west');
    expect(directionBetween(at(1, 1), at(1, 2))).toBe('north');
    expect(directionBetween(at(1, 1), at(1, 0))).toBe('south');
  });

  // Both cases a caller has to treat the same way: nothing to derive.
  it('is null for standing still and for a jump', () => {
    expect(directionBetween(at(2, 2), at(2, 2))).toBeNull();
    expect(directionBetween(at(0, 0), at(0, 2))).toBeNull(); // two tiles
    expect(directionBetween(at(0, 0), at(1, 1))).toBeNull(); // diagonal
  });
});

describe('tileDistance', () => {
  it('counts orthogonal steps, not straight-line distance', () => {
    expect(tileDistance({ col: 0, row: 0 }, { col: 3, row: 0 })).toBe(3);
    expect(tileDistance({ col: 0, row: 0 }, { col: 0, row: 3 })).toBe(3);
  });

  // ⚠️ The case that decides the whole function. Euclidean would call this 1.41
  // and Chebyshev would call it 1; the board is orthogonal, so it is 2 -- and a
  // range band that disagreed would let a gun reach corners its movement cannot.
  it('counts a diagonal as two steps', () => {
    expect(tileDistance({ col: 0, row: 0 }, { col: 1, row: 1 })).toBe(2);
  });

  it('is zero for a tile against itself, and symmetric otherwise', () => {
    expect(tileDistance({ col: 4, row: 7 }, { col: 4, row: 7 })).toBe(0);
    expect(tileDistance({ col: 1, row: 5 }, { col: 4, row: 2 })).toBe(
      tileDistance({ col: 4, row: 2 }, { col: 1, row: 5 }),
    );
  });
});
