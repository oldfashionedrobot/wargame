import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { makeState } from '@vod/shared/testing';
import type {
  Command,
  CommandResult,
  Coordinate,
  GameEvent,
  GameServer,
  GameState,
  UpdateListener,
} from '@vod/shared';
import { useGameSession } from './useGameSession';
import type { GameSessionCallbacks } from './useGameSession';

// The hook against a fake in-memory GameServer -- the same interface the real
// polling implementation serves, minus the network. `push` plays the role of a
// poll delivering an update; `respond` scripts what the next submit returns.

const at = (col: number, row: number): Coordinate => ({ col, row });

// b1 can act; its position and movementRange 2 make (1,3) a legal move target.
const board = makeState(7, [{ id: 'b1', col: 1, row: 1, movementRange: 2 }]);

interface FakeServer {
  server: GameServer;
  submissions: Command[];
  push: (events: GameEvent[], state: GameState) => void;
  respond: (result: CommandResult | Promise<CommandResult>) => void;
}

function fakeServer(initial: GameState): FakeServer {
  let state = initial;
  const listeners = new Set<UpdateListener>();
  const submissions: Command[] = [];
  let nextResult: CommandResult | Promise<CommandResult> = {
    ok: false,
    reason: 'no response scripted',
  };

  return {
    server: {
      getState: () => state,
      submit: async (command) => {
        submissions.push(command);
        return nextResult;
      },
      subscribe: (onUpdate) => {
        listeners.add(onUpdate);
        onUpdate([], state);
        return () => listeners.delete(onUpdate);
      },
      dispose: () => listeners.clear(),
    },
    submissions,
    push: (events, next) => {
      state = next;
      for (const listener of listeners) listener(events, next);
    },
    respond: (result) => {
      nextResult = result;
    },
  };
}

function callbacks(): GameSessionCallbacks {
  return { onSelectionChange: vi.fn(), onEvents: vi.fn() };
}

function renderSession(fake: FakeServer, initial = callbacks()) {
  return renderHook(({ cb }) => useGameSession(fake.server, cb), {
    initialProps: { cb: initial },
  });
}

describe('useGameSession', () => {
  it('serves the render replica and follows server updates', () => {
    const fake = fakeServer(board);
    const { result } = renderSession(fake);
    expect(result.current.gameState).toEqual(board);

    const next = makeState(7, [{ id: 'b1', col: 1, row: 3, movementRange: 2 }]);
    act(() => fake.push([], next));
    expect(result.current.gameState).toEqual(next);
  });

  it('forwards events to onEvents', () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    renderSession(fake, cb);
    const moved: GameEvent[] = [{ type: 'unitMoved', unitId: 'b1', path: [at(1, 1), at(1, 3)] }];
    act(() => fake.push(moved, board));
    expect(cb.onEvents).toHaveBeenLastCalledWith(moved);
  });

  it('selects on click and submits a move for a reachable tile, clearing optimistically', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    const { result } = renderSession(fake, cb);

    act(() => result.current.clickTile(at(1, 1)));
    expect(cb.onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'unitSelected', unitId: 'b1' }),
    );

    fake.respond({ ok: true, seq: 1, events: [], state: board });
    await act(async () => result.current.clickTile(at(1, 3)));
    expect(fake.submissions).toEqual([{ type: 'move', unitId: 'b1', path: [at(1, 1), at(1, 3)] }]);
    // Cleared the moment the command left, not when the server answered.
    expect(cb.onSelectionChange).toHaveBeenLastCalledWith({ phase: 'idle' });
    expect(result.current.rejection).toBeNull();
  });

  it('sets rejection and rolls the selection back when the authority refuses', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    const { result } = renderSession(fake, cb);

    act(() => result.current.clickTile(at(1, 1)));
    fake.respond({ ok: false, reason: 'illegal move' });
    await act(async () => result.current.clickTile(at(1, 3)));

    expect(result.current.rejection).toBe('illegal move');
    // The rollback restored the selection it cleared optimistically.
    expect(cb.onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'unitSelected', unitId: 'b1' }),
    );
  });

  it('clears the rejection on the next server update', async () => {
    const fake = fakeServer(board);
    const { result } = renderSession(fake);
    fake.respond({ ok: false, reason: 'illegal move' });
    await act(async () => result.current.endTurn());
    expect(result.current.rejection).toBe('illegal move');

    act(() => fake.push([], board));
    expect(result.current.rejection).toBeNull();
  });

  // The hazard the extraction had to dodge: subscribe fires synchronously and
  // clears the rejection, so if the subscription depended on the callbacks'
  // identities, a re-render with fresh callbacks would re-subscribe and wipe a
  // rejection before anyone saw it. The latest-ref keeps the subscription on
  // `server` alone; this fails if that regresses.
  it('keeps the rejection across re-renders with new callback identities', async () => {
    const fake = fakeServer(board);
    const { result, rerender } = renderSession(fake);
    fake.respond({ ok: false, reason: 'illegal move' });
    await act(async () => result.current.endTurn());
    expect(result.current.rejection).toBe('illegal move');

    rerender({ cb: callbacks() });
    expect(result.current.rejection).toBe('illegal move');
  });

  it('ignores clicks while a submit is in flight', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    const { result } = renderSession(fake, cb);

    act(() => result.current.clickTile(at(1, 1)));
    let release!: (result: CommandResult) => void;
    fake.respond(new Promise<CommandResult>((res) => (release = res)));

    await act(async () => result.current.clickTile(at(1, 3))); // in flight now
    const pushes = vi.mocked(cb.onSelectionChange).mock.calls.length;
    act(() => result.current.clickTile(at(1, 1))); // swallowed by the guard
    expect(fake.submissions).toHaveLength(1);
    expect(cb.onSelectionChange).toHaveBeenCalledTimes(pushes);

    release({ ok: true, seq: 1, events: [], state: board });
    await act(async () => {});
  });

  it('endTurn submits and clears the selection', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    const { result } = renderSession(fake, cb);
    act(() => result.current.clickTile(at(1, 1)));

    fake.respond({ ok: true, seq: 1, events: [], state: board });
    await act(async () => result.current.endTurn());
    expect(fake.submissions).toEqual([{ type: 'endTurn' }]);
    expect(cb.onSelectionChange).toHaveBeenLastCalledWith({ phase: 'idle' });
  });
});
