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

// react-router reuses the component when only the param changes, so without
// the key a /a -> /b navigation would render GameCanvas against A's server --
// which the effect cleanup has already disposed -- until B resolves. Keying by
// matchId remounts the connection instead: every piece of its state resets and
// a mounted canvas can never see its server prop change, by construction.
export function MatchRoute() {
  const { matchId } = useParams<{ matchId: string }>();

  if (!matchId)
    return (
      <p>
        No match specified. <Link to="/">Back</Link>
      </p>
    );

  return <MatchConnection key={matchId} matchId={matchId} />;
}

/**
 * Owns the connection for one match -- exactly one, which the key above
 * enforces.
 *
 * A remote server has no state until a round trip finishes, so something has
 * to hold the not-ready case -- and a component shouldn't construct the thing
 * it talks to. GameCanvas receives a live server and nothing else.
 */
function MatchConnection({ matchId }: { matchId: string }) {
  const [server, setServer] = useState<GameServer | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>('connected');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
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
            // Not redundant with the effect re-run: batched with setAttempt,
            // this paints "Connecting…" in the click's own render, where the
            // effect fires only after a frame of stale failure UI.
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
