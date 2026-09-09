import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Coordinate, GameEvent, GameServer, GameState } from '@vod/shared';
import type { ConnectionStatus } from '../net/gameServer';
import { makeState } from '@vod/shared/testing';
import { GameCanvas } from './GameCanvas';
import type { GameRenderer } from './render/renderer';

// The renderer is the seam: it builds a Babylon engine, which needs WebGL that
// happy-dom does not have. Everything below is the wiring around it -- the
// chrome, the lifecycle, and the three callbacks the session pushes through.
vi.mock('./render/renderer', () => ({ createGameRenderer: vi.fn() }));
const { createGameRenderer } = await import('./render/renderer');

let renderer: GameRenderer;
let clickTile: (coordinate: Coordinate) => void;

const board: GameState = makeState(5, [{ id: 'b1', col: 1, row: 1 }]);

beforeEach(() => {
  vi.clearAllMocks();
  renderer = {
    onTileClick: vi.fn((handler: (c: Coordinate) => void) => {
      clickTile = handler;
    }),
    setSelectedTile: vi.fn(),
    setMovement: vi.fn(),
    playEvents: vi.fn(() => Promise.resolve()),
    snapUnits: vi.fn(),
    toggleInspector: vi.fn(),
    dispose: vi.fn(),
  };
  vi.mocked(createGameRenderer).mockResolvedValue(renderer);
});

// Construction is async now -- unit models load before the renderer exists --
// so anything touching `renderer` or `clickTile` has to let that promise settle
// first. Rendering through one helper keeps every test on the same footing.
async function renderCanvas(server: GameServer, connection: ConnectionStatus = 'connected') {
  const result = render(<GameCanvas server={server} connection={connection} />);
  await act(async () => {});
  return result;
}

const fakeServer = (over: Partial<GameServer> = {}): GameServer => ({
  getState: () => board,
  submit: vi.fn(async () => ({ ok: true as const, seq: 1, events: [], state: board })),
  subscribe: vi.fn((onUpdate) => {
    onUpdate([], board);
    return () => {};
  }),
  dispose: vi.fn(),
  ...over,
});

describe('GameCanvas', () => {
  it('names whose turn it is', async () => {
    await renderCanvas(fakeServer());
    expect(screen.getByText(/Blue Army's turn/)).toBeTruthy();
  });

  it('shows the reconnecting banner only while retrying', async () => {
    const { rerender } = await renderCanvas(fakeServer());
    expect(screen.queryByText(/reconnecting/)).toBeNull();

    rerender(<GameCanvas server={fakeServer()} connection="retrying" />);
    expect(screen.getByText(/reconnecting/)).toBeTruthy();
  });

  it('shows the server reason when a command is refused', async () => {
    const server = fakeServer({
      submit: vi.fn(async () => ({ ok: false as const, reason: 'that unit has already acted' })),
    });
    await renderCanvas(server);

    fireEvent.click(screen.getByRole('button', { name: 'End Turn' }));
    expect(await screen.findByText(/that unit has already acted/)).toBeTruthy();
  });

  it('submits an endTurn when the button is pressed', async () => {
    const server = fakeServer();
    await renderCanvas(server);
    fireEvent.click(screen.getByRole('button', { name: 'End Turn' }));
    expect(server.submit).toHaveBeenCalledWith({ type: 'endTurn' });
  });

  // The renderer is built once for a canvas and torn down with it; leaving it
  // alive would keep a WebGL context and a render loop running per navigation.
  it('builds a renderer on mount and disposes it on unmount', async () => {
    const { unmount } = await renderCanvas(fakeServer());
    expect(createGameRenderer).toHaveBeenCalledTimes(1);
    unmount();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  // The mirror of MatchRoute's late-connect case: models load asynchronously,
  // so a canvas can unmount while its renderer is still being built. The
  // renderer that arrives afterwards has to be disposed rather than stored, or
  // its engine keeps rendering into a canvas nobody is showing.
  it('disposes a renderer that finishes building after unmount', async () => {
    const { unmount } = render(<GameCanvas server={fakeServer()} connection="connected" />);
    unmount();
    expect(renderer.dispose).not.toHaveBeenCalled();

    await act(async () => {}); // the build resolves now, into a dead component
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.onTileClick).not.toHaveBeenCalled();
  });

  // The click handler is registered with the renderer, so a tile click has to
  // reach the session through it rather than through any React event.
  // The renderer ref is nulled on unmount, and that is load-bearing rather than
  // tidiness: a queue task parked on an animation resolves after teardown and
  // then calls onSnap, which would otherwise reach a disposed scene.
  it('does not touch a disposed renderer when a batch lands after unmount', async () => {
    let push!: (events: GameEvent[], state: GameState) => void;
    const server = fakeServer({
      subscribe: vi.fn((onUpdate) => {
        push = onUpdate;
        return () => {};
      }),
    });
    const { unmount } = await renderCanvas(server);

    let finish!: () => void;
    vi.mocked(renderer.playEvents).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );

    const moved: GameEvent = {
      type: 'unitMoved',
      unitId: 'b1',
      path: [
        { col: 1, row: 1 },
        { col: 1, row: 2 },
      ],
    };
    await act(async () => push([moved], board)); // the task parks on playEvents
    unmount();
    vi.mocked(renderer.snapUnits).mockClear();

    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(renderer.snapUnits).not.toHaveBeenCalled();
  });

  it('routes a tile click into a selection push', async () => {
    await renderCanvas(fakeServer());
    expect(renderer.onTileClick).toHaveBeenCalled();

    clickTile({ col: 1, row: 1 }); // the unit's own tile
    expect(renderer.setSelectedTile).toHaveBeenLastCalledWith({ col: 1, row: 1 });
    // The whole search is handed over, so the renderer can draw a route on
    // hover without asking React for anything.
    const movement = vi.mocked(renderer.setMovement).mock.lastCall?.[0];
    expect(movement?.reachable.length).toBeGreaterThan(0);
    expect(typeof movement?.pathTo).toBe('function');
  });

  it('clears the overlays when the selection is dropped', async () => {
    await renderCanvas(fakeServer());
    clickTile({ col: 1, row: 1 }); // select
    clickTile({ col: 1, row: 1 }); // click it again to deselect
    expect(renderer.setSelectedTile).toHaveBeenLastCalledWith(null);
    expect(renderer.setMovement).toHaveBeenLastCalledWith(null);
  });
});
