import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { MatchSummary } from '@aw/shared'
import { createMatch, listMatches } from '../net/matchesApi'

interface Loaded {
  matches: MatchSummary[] | null
  error: string | null
}

const message = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message : fallback

// Plain function rather than a hook: it does no state work, so the effect and
// the Refresh button can share it and each decide whether the result still
// matters by the time it arrives.
async function fetchMatches(): Promise<Loaded> {
  try {
    return { matches: await listMatches(), error: null }
  } catch (cause) {
    return { matches: null, error: message(cause, 'could not load matches') }
  }
}

function formatWhen(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

export function StartScreen() {
  const navigate = useNavigate()
  const [{ matches, error }, setLoaded] = useState<Loaded>({ matches: null, error: null })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchMatches().then((result) => {
      if (!cancelled) setLoaded(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const onRefresh = (): void => {
    void fetchMatches().then(setLoaded)
  }

  const onCreate = (): void => {
    setCreating(true)
    createMatch()
      .then((match) => void navigate(`/${match.id}`))
      .catch((cause: unknown) => {
        setCreating(false)
        setLoaded({ matches, error: message(cause, 'could not create a match') })
      })
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Advance Wars Clone</h1>

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
  )
}
