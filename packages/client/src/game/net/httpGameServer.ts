import type {
  Command,
  CommandResult,
  EventsResponse,
  GameServer,
  GameState,
  StateResponse,
  UpdateListener,
} from '@aw/shared'

const POLL_INTERVAL_MS = 2000
const MAX_BACKOFF_MS = 30_000

export type ConnectionStatus = 'connected' | 'retrying'

export interface ConnectOptions {
  onConnectionChange?: (status: ConnectionStatus) => void
}

// Same-origin: in dev Vite proxies /api to the server, in production the
// server serves this bundle itself. Either way there is no base URL to
// configure and the session cookie rides along automatically.
const API = '/api'

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`)
  if (!response.ok) throw new Error(`${path} -> ${response.status}`)
  return (await response.json()) as T
}

/**
 * The GameServer implementation that talks HTTP.
 *
 * Connects before returning, so callers never see a server without state --
 * which is what lets `getState()` stay synchronous.
 */
export async function connectGameServer(options: ConnectOptions = {}): Promise<GameServer> {
  const initial = await getJson<StateResponse>('/state')

  let state: GameState = initial.state
  // Every update the caller sees passes this. Deduplicating here rather than
  // in the UI is what keeps components ignorant of seq entirely: a poll
  // already in flight when a command is submitted will return the same events
  // the POST response is about to deliver, and applying both would animate
  // the same move twice.
  let lastSeq = initial.seq
  let status: ConnectionStatus = 'connected'

  const listeners = new Set<UpdateListener>()

  const setStatus = (next: ConnectionStatus): void => {
    if (next === status) return
    status = next
    options.onConnectionChange?.(next)
  }

  const applyUpdate = (update: EventsResponse | CommandResult): boolean => {
    if ('ok' in update && !update.ok) return false
    if (update.seq <= lastSeq) return false

    lastSeq = update.seq
    state = update.state
    for (const listener of listeners) listener(update.events, state)
    return true
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  let backoff = POLL_INTERVAL_MS
  let disposed = false

  const poll = async (): Promise<void> => {
    try {
      applyUpdate(await getJson<EventsResponse>(`/events?since=${lastSeq}`))
      backoff = POLL_INTERVAL_MS
      setStatus('connected')
    } catch {
      // A failed poll is not fatal -- the next one re-syncs from lastSeq, so
      // nothing is lost by missing one. Back off so a dead server isn't
      // hammered every two seconds.
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      setStatus('retrying')
    }
    schedule()
  }

  const schedule = (delay = backoff): void => {
    if (disposed) return
    if (timer !== null) clearTimeout(timer)
    // Nothing changes while the tab is hidden that can't be caught up on
    // return, and a hidden tab polling forever is pure waste.
    const hidden = typeof document !== 'undefined' && document.hidden
    timer = setTimeout(() => void poll(), hidden ? MAX_BACKOFF_MS : delay)
  }

  // Without this, going hidden schedules the next poll 30s out and coming back
  // doesn't reschedule -- so a visible tab could sit stale for half a minute.
  const onVisibilityChange = (): void => {
    if (document.hidden) return
    backoff = POLL_INTERVAL_MS
    schedule(0)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  schedule()

  return {
    getState: () => state,

    async submit(command: Command) {
      let result: CommandResult
      try {
        const response = await fetch(`${API}/commands`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(command),
        })
        result = (await response.json()) as CommandResult
      } catch {
        setStatus('retrying')
        return { ok: false, reason: 'could not reach the server' }
      }

      setStatus('connected')
      applyUpdate(result)
      return result
    },

    subscribe(onUpdate) {
      listeners.add(onUpdate)
      onUpdate([], state) // so a subscriber needs no separate initial fetch
      return () => listeners.delete(onUpdate)
    },

    dispose() {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      listeners.clear()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    },
  }
}
