import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { makeState, route } from '@vod/shared/testing';
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

// b1 can act; its position and infantry's range of 3 make (1,3) a legal move target.
const board = makeState(7, [{ id: 'b1', col: 1, row: 1 }]);

const moved = (): GameEvent => ({ type: 'unitMoved', unitId: 'b1', path: [at(1, 1), at(1, 3)] });

// happy-dom's document.hidden is a prototype getter; an own property shadows
// it for the hidden-tab case below.
function setTabHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
}

afterEach(() => {
  Reflect.deleteProperty(document, 'hidden'); // drop any per-test shadow
  vi.restoreAllMocks();
});

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
  return {
    onSelectionChange: vi.fn(),
    onEvents: vi.fn(() => Promise.resolve()),
    onSnap: vi.fn(),
  };
}

function renderSession(fake: FakeServer, initial = callbacks()) {
  return renderHook(({ cb }) => useGameSession(fake.server, cb), {
    initialProps: { cb: initial },
  });
}

describe('useGameSession', () => {
  it('serves the render replica and follows server updates', async () => {
    const fake = fakeServer(board);
    const { result } = renderSession(fake);
    expect(result.current.gameState).toEqual(board);

    const next = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
    // The commit runs through the queue, a microtask behind the push -- a
    // synchronous act would still see the old state.
    await act(async () => fake.push([], next));
    expect(result.current.gameState).toEqual(next);
  });

  it('forwards events to onEvents', async () => {
    const fake = fakeServer(board);
    const cb = callbacks();
    renderSession(fake, cb);
    await act(async () => fake.push([moved()], board));
    expect(cb.onEvents).toHaveBeenLastCalledWith([moved()]);
  });

  // 5b: a state is committed only after the events that produced it have
  // finished animating. Every batch snaps before it commits; animation is
  // skipped entirely for large catch-up batches and hidden tabs.
  describe('the animation gate', () => {
    it('commits state only after the batch finishes animating', async () => {
      const fake = fakeServer(board);
      const cb = callbacks();
      let finish!: () => void;
      vi.mocked(cb.onEvents).mockImplementation(() => new Promise((res) => (finish = res)));
      const { result } = renderSession(fake, cb);
      await act(async () => {}); // settle the initial (empty, unanimated) batch

      const next = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
      await act(async () => fake.push([moved()], next));

      // Arrived and animating -- not yet snapped over, not yet committed.
      expect(cb.onEvents).toHaveBeenCalledWith([moved()]);
      expect(cb.onSnap).toHaveBeenCalledTimes(1); // the initial batch only
      expect(result.current.gameState).toEqual(board);

      await act(async () => finish());
      expect(cb.onSnap).toHaveBeenLastCalledWith(next);
      expect(result.current.gameState).toEqual(next);
    });

    it('runs batches serially, in arrival order', async () => {
      const fake = fakeServer(board);
      const cb = callbacks();
      const pending: Array<() => void> = [];
      vi.mocked(cb.onEvents).mockImplementation(() => new Promise((res) => pending.push(res)));
      const { result } = renderSession(fake, cb);
      await act(async () => {});

      const mid = makeState(7, [{ id: 'b1', col: 1, row: 2 }]);
      const end = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
      await act(async () => fake.push([moved()], mid));
      await act(async () => fake.push([moved()], end));

      // Batch two waits on batch one: its animation has not even started.
      expect(pending).toHaveLength(1);
      expect(result.current.gameState).toEqual(board);

      await act(async () => pending[0]?.());
      // One committed; only now does two animate.
      expect(result.current.gameState).toEqual(mid);
      expect(pending).toHaveLength(2);

      await act(async () => pending[1]?.());
      expect(result.current.gameState).toEqual(end);
    });

    it('snaps instead of animating a large catch-up batch', async () => {
      const fake = fakeServer(board);
      const cb = callbacks();
      const { result } = renderSession(fake, cb);
      await act(async () => {});

      const next = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
      await act(async () => fake.push(Array.from({ length: 11 }, moved), next));

      expect(cb.onEvents).not.toHaveBeenCalled();
      expect(cb.onSnap).toHaveBeenLastCalledWith(next);
      expect(result.current.gameState).toEqual(next);
    });

    it('snaps instead of animating while the tab is hidden', async () => {
      const fake = fakeServer(board);
      const cb = callbacks();
      const { result } = renderSession(fake, cb);
      await act(async () => {});

      setTabHidden(true);
      const next = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
      await act(async () => fake.push([moved()], next));

      expect(cb.onEvents).not.toHaveBeenCalled();
      expect(cb.onSnap).toHaveBeenLastCalledWith(next);
      expect(result.current.gameState).toEqual(next);
    });

    it('snaps over a failed animation and still commits', async () => {
      const fake = fakeServer(board);
      const cb = callbacks();
      vi.mocked(cb.onEvents).mockRejectedValue(new Error('webgl died'));
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderSession(fake, cb);
      await act(async () => {});

      const next = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
      await act(async () => fake.push([moved()], next));

      expect(cb.onSnap).toHaveBeenLastCalledWith(next);
      expect(result.current.gameState).toEqual(next);
      expect(errorLog).toHaveBeenCalled();
    });

    it('clears a rejection on arrival, before the batch finishes animating', async () => {
      const fake = fakeServer(board);
      const cb = callbacks();
      let finish!: () => void;
      vi.mocked(cb.onEvents).mockImplementation(() => new Promise((res) => (finish = res)));
      const { result } = renderSession(fake, cb);
      await act(async () => {});

      fake.respond({ ok: false, reason: 'illegal move' });
      await act(async () => result.current.endTurn());
      expect(result.current.rejection).toBe('illegal move');

      // Newer authority supersedes the rejection the moment it arrives; only
      // the state commit waits on the animation.
      const next = makeState(7, [{ id: 'b1', col: 1, row: 3 }]);
      await act(async () => fake.push([moved()], next));
      expect(result.current.rejection).toBeNull();
      expect(result.current.gameState).toEqual(board);

      await act(async () => finish());
      expect(result.current.gameState).toEqual(next);
    });
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
    expect(fake.submissions).toEqual([
      { type: 'move', unitId: 'b1', path: route(at(1, 1), at(1, 3)) },
    ]);
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

  // The hook is written against the interface: the real implementation never
  // rejects, but one that does must read as a rejection and release the
  // in-flight guard, not soft-lock the UI forever.
  it('treats a rejecting submit as a rejection and releases the guard', async () => {
    const fake = fakeServer(board);
    const { result } = renderSession(fake);

    const failure = Promise.reject(new Error('implementation broke'));
    // Pre-handle so the runner never sees an unhandled rejection; the await
    // inside the hook still receives the rejection.
    failure.catch(() => {});
    fake.respond(failure);
    await act(async () => result.current.endTurn());
    expect(result.current.rejection).toBe('implementation broke');

    // The guard released: the next submit goes through.
    fake.respond({ ok: true, seq: 1, events: [], state: board });
    await act(async () => result.current.endTurn());
    expect(fake.submissions).toHaveLength(2);
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
