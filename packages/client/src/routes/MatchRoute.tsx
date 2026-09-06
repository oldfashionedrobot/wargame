import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { GameServer } from '@vod/shared';
import { GameCanvas } from '../game/GameCanvas';
import { connectGameServer } from '../net/gameServer';
import type { ConnectionStatus } from '../net/gameServer';
import type { FailureKind } from '../net/api';

interface Failure {
  kind: FailureKind;
  reason: string;
}

/**
 * Owns the connection for one match.
 *
 * A remote server has no state until a round trip finishes, so something has
 * to hold the not-ready case -- and a component shouldn't construct the thing
 * it talks to. GameCanvas receives a live server and nothing else.
 */
export function MatchRoute() {
  const { matchId } = useParams<{ matchId: string }>();
  const [server, setServer] = useState<GameServer | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>('connected');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    let connected: GameServer | null = null;

    void connectGameServer(matchId, { onConnectionChange: setConnection }).then((result) => {
      if (!result.ok) {
        if (!cancelled) setFailure({ kind: result.kind, reason: result.reason });
        return;
      }
      connected = result.server;
      // The effect may already have been torn down while this was in flight --
      // StrictMode does exactly that. Dispose rather than leak a polling loop
      // nobody is listening to.
      if (cancelled) result.server.dispose();
      else setServer(result.server);
    });

    return () => {
      cancelled = true;
      connected?.dispose();
    };
  }, [matchId, attempt]);

  if (!matchId)
    return (
      <p>
        No match specified. <Link to="/">Back</Link>
      </p>
    );

  if (failure) {
    // A missing match will never resolve, so offering Retry would be a lie.
    return failure.kind === 'notFound' ? (
      <p style={{ padding: '2rem' }}>
        No match with that id. <Link to="/">Back to matches</Link>
      </p>
    ) : (
      <p style={{ padding: '2rem' }}>
        Could not reach the server: {failure.reason}{' '}
        <button
          type="button"
          onClick={() => {
            setFailure(null);
            setAttempt((n) => n + 1);
          }}
        >
          Retry
        </button>{' '}
        <Link to="/">Back to matches</Link>
      </p>
    );
  }

  if (!server) return <p style={{ padding: '2rem' }}>Connecting…</p>;

  return <GameCanvas server={server} connection={connection} />;
}
