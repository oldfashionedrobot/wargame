import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { MapSummary, MatchSummary } from '@vod/shared';
import { api } from '../net/api';

interface MatchData {
  matches: MatchSummary[] | null;
  error: string | null;
}

export function StartScreen() {
  const navigate = useNavigate();
  const [{ matches, error }, setMatchData] = useState<MatchData>({ matches: null, error: null });
  const [creating, setCreating] = useState(false);
  // Empty until the list arrives, and empty for good if it fails: the picker
  // just does not appear, and creating falls back to the server's default.
  const [maps, setMaps] = useState<MapSummary[]>([]);
  // Seeded from the list rather than left undefined, so that what the select
  // shows and what create sends are the same value. Leaving it unset made them
  // agree only while the registry happened to lead with the default map.
  const [mapId, setMapId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void fetchMatches().then((result) => {
      if (!cancelled) setMatchData(result);
    });
    void api.maps
      .list()
      .then((available) => {
        if (cancelled) return;
        setMaps(available);
        setMapId(available[0]?.id);
      })
      .catch(() => {
        // Not worth an error banner. Without a picker you get the default map,
        // which is what happened before there was one.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onRefresh = (): void => {
    void fetchMatches().then(setMatchData);
  };

  const onCreate = (): void => {
    setCreating(true);
    api.matches
      .create(mapId)
      .then((match) => void navigate(`/${match.id}`))
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
        {maps.length > 0 && (
          <>
            <label>
              {' on '}
              <select
                value={mapId}
                onChange={(event) => setMapId(event.target.value)}
                disabled={creating}
              >
                {maps.map((map) => (
                  <option key={map.id} value={map.id}>
                    {map.name}
                  </option>
                ))}
              </select>
            </label>{' '}
          </>
        )}
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
              {' · '}
              {match.mapId}
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
