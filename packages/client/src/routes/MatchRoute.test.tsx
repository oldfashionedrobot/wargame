import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { GameServer } from '@vod/shared';
import { makeState } from '@vod/shared/testing';
import { MatchRoute } from './MatchRoute';

// Two seams: the connection, and the canvas. GameCanvas is replaced because it
// builds a Babylon engine, which needs WebGL; everything MatchRoute decides
// happens before that.
vi.mock('../net/gameServer', () => ({ connectGameServer: vi.fn() }));
vi.mock('../game/GameCanvas', () => ({
  GameCanvas: ({ connection }: { connection: string }) => <p>canvas: {connection}</p>,
}));

const { connectGameServer } = await import('../net/gameServer');
const connect = vi.mocked(connectGameServer);

// Call counts are asserted below, so they must not carry across tests.
beforeEach(() => {
  vi.clearAllMocks();
});

const fakeServer = (): GameServer => ({
  getState: () => makeState(3, []),
  submit: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  dispose: vi.fn(),
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:matchId" element={<MatchRoute />} />
        <Route path="/" element={<p>start screen</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('MatchRoute', () => {
  it('renders the canvas once a connection resolves', async () => {
    connect.mockResolvedValue({ ok: true, server: fakeServer() });
    renderAt('/m1');
    expect(screen.getByText('Connecting…')).toBeTruthy();
    expect(await screen.findByText(/canvas:/)).toBeTruthy();
  });

  // The two failure branches are the whole reason FailureKind exists: one of
  // them can never succeed, so offering Retry there would be a lie.
  it('offers no retry for a match that does not exist', async () => {
    connect.mockResolvedValue({ ok: false, kind: 'notFound', reason: 'not found' });
    renderAt('/nope');
    expect(await screen.findByText(/No match with that id/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('offers a working retry when the server is unreachable', async () => {
    connect.mockResolvedValue({ ok: false, kind: 'unreachable', reason: 'fetch failed' });
    renderAt('/m1');
    expect(await screen.findByText(/Could not reach the server/)).toBeTruthy();

    connect.mockResolvedValue({ ok: true, server: fakeServer() });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/canvas:/)).toBeTruthy();
  });

  it('disposes the connection when the route unmounts', async () => {
    const server = fakeServer();
    connect.mockResolvedValue({ ok: true, server });
    const { unmount } = renderAt('/m1');
    await screen.findByText(/canvas:/);

    unmount();
    expect(server.dispose).toHaveBeenCalled();
  });

  // What StrictMode produces: the effect tears down while a connect is still
  // in flight. Nothing is listening by the time it lands, so it has to be
  // disposed or its poll loop runs for the life of the tab.
  it('disposes a connection that resolves after teardown', async () => {
    const server = fakeServer();
    let land!: (result: { ok: true; server: GameServer }) => void;
    connect.mockReturnValue(new Promise((resolve) => (land = resolve)));

    const { unmount } = renderAt('/m1');
    unmount();
    land({ ok: true, server });
    await vi.waitFor(() => expect(server.dispose).toHaveBeenCalled());
  });

  it('reports a missing match id rather than connecting', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MatchRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/No match specified/)).toBeTruthy();
    expect(connect).not.toHaveBeenCalled();
  });
});
