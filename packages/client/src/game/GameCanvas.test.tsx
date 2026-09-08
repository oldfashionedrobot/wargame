import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Coordinate, GameServer, GameState } from '@vod/shared';
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
    setMovementRange: vi.fn(),
    playEvents: vi.fn(() => Promise.resolve()),
    snapUnits: vi.fn(),
    toggleInspector: vi.fn(),
    dispose: vi.fn(),
  };
  vi.mocked(createGameRenderer).mockReturnValue(renderer);
});

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
  it('names whose turn it is', () => {
    render(<GameCanvas server={fakeServer()} connection="connected" />);
    expect(screen.getByText(/Blue Army's turn/)).toBeTruthy();
  });

  it('shows the reconnecting banner only while retrying', () => {
    const { rerender } = render(<GameCanvas server={fakeServer()} connection="connected" />);
    expect(screen.queryByText(/reconnecting/)).toBeNull();

    rerender(<GameCanvas server={fakeServer()} connection="retrying" />);
    expect(screen.getByText(/reconnecting/)).toBeTruthy();
  });

  it('shows the server reason when a command is refused', async () => {
    const server = fakeServer({
      submit: vi.fn(async () => ({ ok: false as const, reason: 'that unit has already acted' })),
    });
    render(<GameCanvas server={server} connection="connected" />);

    fireEvent.click(screen.getByRole('button', { name: 'End Turn' }));
    expect(await screen.findByText(/that unit has already acted/)).toBeTruthy();
  });

  it('submits an endTurn when the button is pressed', () => {
    const server = fakeServer();
    render(<GameCanvas server={server} connection="connected" />);
    fireEvent.click(screen.getByRole('button', { name: 'End Turn' }));
    expect(server.submit).toHaveBeenCalledWith({ type: 'endTurn' });
  });

  // The renderer is built once for a canvas and torn down with it; leaving it
  // alive would keep a WebGL context and a render loop running per navigation.
  it('builds a renderer on mount and disposes it on unmount', () => {
    const { unmount } = render(<GameCanvas server={fakeServer()} connection="connected" />);
    expect(createGameRenderer).toHaveBeenCalledTimes(1);
    unmount();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  // The click handler is registered with the renderer, so a tile click has to
  // reach the session through it rather than through any React event.
  it('routes a tile click into a selection push', () => {
    render(<GameCanvas server={fakeServer()} connection="connected" />);
    expect(renderer.onTileClick).toHaveBeenCalled();

    clickTile({ col: 1, row: 1 }); // the unit's own tile
    expect(renderer.setSelectedTile).toHaveBeenLastCalledWith({ col: 1, row: 1 });
    expect(vi.mocked(renderer.setMovementRange).mock.lastCall?.[0].length).toBeGreaterThan(0);
  });

  it('clears the overlays when the selection is dropped', () => {
    render(<GameCanvas server={fakeServer()} connection="connected" />);
    clickTile({ col: 1, row: 1 }); // select
    clickTile({ col: 1, row: 1 }); // click it again to deselect
    expect(renderer.setSelectedTile).toHaveBeenLastCalledWith(null);
    expect(renderer.setMovementRange).toHaveBeenLastCalledWith([]);
  });
});
