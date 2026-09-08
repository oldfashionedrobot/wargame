import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { MatchSummary } from '@vod/shared';
import { StartScreen } from './StartScreen';

// The api module is the seam: StartScreen's whole job is turning what it
// returns into one of four states -- loading, error, empty, a list -- and
// turning a click into a navigation.
vi.mock('../net/api', () => ({
  api: { matches: { list: vi.fn(), create: vi.fn() } },
}));
const { api } = await import('../net/api');
const list = vi.mocked(api.matches.list);
const create = vi.mocked(api.matches.create);

const summary = (over: Partial<MatchSummary> = {}): MatchSummary => ({
  id: 'aaaaaaaa-1111-2222-3333-444444444444',
  createdAt: Date.now(),
  seq: 0,
  currentTurn: 'player-blue',
  ...over,
});

// Renders the real route table, so a navigation is observable as the other
// route appearing rather than as a spied-on callback.
function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<StartScreen />} />
        <Route path="/:matchId" element={<p>match screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StartScreen', () => {
  it('lists the matches it fetched', async () => {
    list.mockResolvedValue([summary({ seq: 3 }), summary({ id: 'bbbbbbbb-0000', seq: 0 })]);
    renderScreen();

    // The id is shown abbreviated, with the turn and a move count beside it.
    expect(await screen.findByText('aaaaaaaa')).toBeTruthy();
    expect(screen.getByText(/3 moves/)).toBeTruthy();
    expect(screen.getByText(/not started/)).toBeTruthy();
  });

  it('says so when there are none', async () => {
    list.mockResolvedValue([]);
    renderScreen();
    expect(await screen.findByText('No matches yet.')).toBeTruthy();
  });

  it('shows the reason when the list cannot be loaded', async () => {
    list.mockRejectedValue(new Error('server returned 500'));
    renderScreen();
    expect(await screen.findByText('server returned 500')).toBeTruthy();
    // Not stuck on the loading state.
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('creates a match and navigates to it', async () => {
    list.mockResolvedValue([]);
    create.mockResolvedValue(summary({ id: 'cccccccc-9999' }));
    renderScreen();
    await screen.findByText('No matches yet.');

    fireEvent.click(screen.getByRole('button', { name: 'New match' }));
    expect(await screen.findByText('match screen')).toBeTruthy();
  });

  // The guard exists so a slow create cannot be fired twice; it must also let
  // go again if the create fails, or the button is dead for good.
  it('re-enables the button and reports why when creating fails', async () => {
    list.mockResolvedValue([]);
    create.mockRejectedValue(new Error('could not reach the server'));
    renderScreen();
    await screen.findByText('No matches yet.');

    const button = screen.getByRole('button', { name: 'New match' });
    fireEvent.click(button);

    expect(await screen.findByText('could not reach the server')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'New match' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'New match' }).hasAttribute('disabled')).toBe(false);
  });

  it('refetches on Refresh', async () => {
    list.mockResolvedValue([]);
    renderScreen();
    await screen.findByText('No matches yet.');

    list.mockResolvedValue([summary({ id: 'dddddddd-7777' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('dddddddd')).toBeTruthy();
  });
});
