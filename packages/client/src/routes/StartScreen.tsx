import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { MatchSummary } from '@vod/shared';
import api from '../net/api';

interface MatchData {
  matches: MatchSummary[] | null;
  error: string | null;
}

export function StartScreen() {
  const navigate = useNavigate();
  const [{ matches, error }, setMatchData] = useState<MatchData>({ matches: null, error: null });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMatches().then((result) => {
      if (!cancelled) setMatchData(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onRefresh = () => {
    fetchMatches().then(setMatchData);
  };

  const onCreate = () => {
    setCreating(true);
    api.matches
      .create()
      .then((match) => navigate(`/${match.id}`))
      .catch((cause: unknown) => {
        setCreating(false);
        setMatchData({ matches, error: message(cause, 'could not create a match') });
      });
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Victory or Death</h1>

      <p>
        <button type="button" onClick={onCreate} disabled={creating}>
          {creating ? 'Creating…' : 'New match'}
        </button>{' '}
        <button type="button" onClick={onRefresh}>
          Refresh
        </button>
      </p>

      {error && <p style={{ color: '#c0392b' }}>{error}</p>}

      {matches === null && !error && <p>Loading…</p>}
      {matches?.length === 0 && <p>No matches yet.</p>}

      {matches && matches.length > 0 && (
        <ul>
          {matches.map((match) => (
            <li key={match.id}>
              <Link to={`/${match.id}`}>{match.id.slice(0, 8)}</Link>
              {' — '}
              {match.currentTurn}
              {match.seq === 0 ? ' · not started' : ` · ${match.seq} moves`}
              {' · '}
              {formatWhen(match.createdAt)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

// Plain function rather than a hook: it does no state work, so the effect and
// the Refresh button can share it and each decide whether the result still
// matters by the time it arrives.
async function fetchMatches(): Promise<MatchData> {
  try {
    return { matches: await api.matches.list(), error: null };
  } catch (cause) {
    return { matches: null, error: message(cause, 'could not load matches') };
  }
}

function formatWhen(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}
