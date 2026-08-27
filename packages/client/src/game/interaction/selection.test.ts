import { describe, expect, it } from 'vitest';
import { makeState } from '@vod/shared/testing';
import type { Coordinate, GameState } from '@vod/shared';
import { handleTileClick, initialSelectionState } from './selection';
import type { SelectionState } from './selection';

// handleTileClick is the only genuinely pure thing in the client: state and a
// coordinate in, new selection and an optional command out. No React, no
// Babylon, no server.
//
// Blue to move. b1 is free, b2 has already acted, r1 belongs to the opponent.
const board = (): GameState =>
  makeState(7, [
    { id: 'b1', col: 1, row: 1, movementRange: 2 },
    { id: 'b2', col: 5, row: 5, hasActed: true },
    { id: 'r1', col: 6, row: 6, owner: 'red' },
  ]);

const at = (col: number, row: number): Coordinate => ({ col, row });

/** Select b1 and hand back the resulting selection, since most cases start there. */
const withB1Selected = (state: GameState): SelectionState =>
  handleTileClick(state, initialSelectionState, at(1, 1)).selection;

describe('handleTileClick, nothing selected', () => {
  it('selects a unit that can act', () => {
    const { selection, command } = handleTileClick(board(), initialSelectionState, at(1, 1));
    expect(command).toBeNull();
    expect(selection.selectedUnitId).toBe('b1');
    expect(selection.reachableTiles.length).toBeGreaterThan(0);
  });

  it('ignores an empty tile', () => {
    const result = handleTileClick(board(), initialSelectionState, at(3, 3));
    expect(result).toEqual({ selection: initialSelectionState, command: null });
  });

  it('ignores an enemy unit', () => {
    const result = handleTileClick(board(), initialSelectionState, at(6, 6));
    expect(result).toEqual({ selection: initialSelectionState, command: null });
  });

  // Selection is a preview of a game rule, not a UI whim -- canSelectUnit is
  // the same predicate the server enforces.
  it('ignores an own unit that has already acted', () => {
    const result = handleTileClick(board(), initialSelectionState, at(5, 5));
    expect(result).toEqual({ selection: initialSelectionState, command: null });
  });
});

describe('handleTileClick, a unit selected', () => {
  it('emits a move command for a reachable tile, and clears the selection', () => {
    const state = board();
    const { selection, command } = handleTileClick(state, withB1Selected(state), at(1, 3));
    expect(command).toEqual({
      type: 'move',
      unitId: 'b1',
      path: [at(1, 1), at(1, 3)],
    });
    expect(selection).toEqual(initialSelectionState);
  });

  it('deselects when the selected unit is clicked again', () => {
    const state = board();
    const result = handleTileClick(state, withB1Selected(state), at(1, 1));
    expect(result).toEqual({ selection: initialSelectionState, command: null });
  });

  it('clears the selection on an unreachable empty tile, without a command', () => {
    const state = board();
    const result = handleTileClick(state, withB1Selected(state), at(6, 1));
    expect(result).toEqual({ selection: initialSelectionState, command: null });
  });

  it('switches to another of your units rather than trying to move onto it', () => {
    const state = makeState(7, [
      { id: 'b1', col: 1, row: 1, movementRange: 2 },
      { id: 'b3', col: 6, row: 1 },
    ]);
    const { selection, command } = handleTileClick(state, withB1Selected(state), at(6, 1));
    expect(command).toBeNull();
    expect(selection.selectedUnitId).toBe('b3');
  });

  // A friendly unit is pass-through but not a stopping point, so its tile is
  // never in reachableTiles -- clicking it must reselect, never move.
  it('reselects rather than moving when a friendly unit stands in range', () => {
    const state = makeState(7, [
      { id: 'b1', col: 1, row: 1, movementRange: 3 },
      { id: 'b3', col: 1, row: 2 },
    ]);
    const { selection, command } = handleTileClick(state, withB1Selected(state), at(1, 2));
    expect(command).toBeNull();
    expect(selection.selectedUnitId).toBe('b3');
  });

  it('does not offer a move onto an enemy', () => {
    const state = makeState(7, [
      { id: 'b1', col: 1, row: 1, movementRange: 3 },
      { id: 'r1', col: 1, row: 2, owner: 'red' },
    ]);
    const result = handleTileClick(state, withB1Selected(state), at(1, 2));
    expect(result).toEqual({ selection: initialSelectionState, command: null });
  });

  it('recovers if the selected unit has vanished from state', () => {
    const state = board();
    const stale = withB1Selected(state);
    const without: GameState = { ...state, units: state.units.filter((u) => u.id !== 'b1') };
    const { selection, command } = handleTileClick(without, stale, at(3, 3));
    expect(command).toBeNull();
    expect(selection).toEqual(initialSelectionState);
  });
});
