import { useEffect, useState } from 'react'
import type { GameServer } from '@aw/shared'
import { GameCanvas } from './game/GameCanvas'
import { connectGameServer } from './game/net/httpGameServer'
import type { ConnectionStatus } from './game/net/httpGameServer'

// App owns the connection, not GameCanvas. A remote server has no state until
// a round trip completes, so something has to hold the "not ready yet" case --
// and a component shouldn't be constructing the thing it talks to anyway.
function App() {
  const [server, setServer] = useState<GameServer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus>('connected')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let connected: GameServer | null = null

    connectGameServer({ onConnectionChange: setConnection })
      .then((instance) => {
        connected = instance
        // The effect may already have been torn down while this was in flight
        // -- StrictMode does exactly that. Dispose rather than leak a polling
        // loop nobody is listening to.
        if (cancelled) instance.dispose()
        else setServer(instance)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'connection failed')
      })

    return () => {
      cancelled = true
      connected?.dispose()
    }
  }, [attempt])

  if (error) {
    return (
      <p>
        Could not reach the server: {error}{' '}
        <button
          type="button"
          onClick={() => {
            setError(null)
            setAttempt((n) => n + 1)
          }}
        >
          Retry
        </button>
      </p>
    )
  }

  if (!server) return <p>Connecting…</p>

  return <GameCanvas server={server} connection={connection} />
}

export default App
