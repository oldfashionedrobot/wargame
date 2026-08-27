import { join, resolve } from 'node:path';
import { parseCommand } from '@aw/shared';
import type { GameState, PlayerId } from '@aw/shared';
import { createDb, migrate } from './db';
import { createMatchStore } from './match';

const PORT = Number(process.env.PORT ?? 3001);
const IS_PROD = process.env.NODE_ENV === 'production';
const CLIENT_DIST = resolve(new URL('../../client/dist', import.meta.url).pathname);

const db = createDb();
await migrate(db);
const matches = createMatchStore(db);

const SESSION_COOKIE = 'aw_session';

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function sessionCookie(id: string): string {
  // Secure only in production -- dev runs over plain http://localhost.
  // SameSite=Lax is what covers CSRF, which is the risk cookies introduce.
  const parts = [
    `${SESSION_COOKIE}=${id}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=31536000',
  ];
  if (IS_PROD) parts.push('Secure');
  return parts.join('; ');
}

/**
 * The single place a request becomes a player.
 *
 * Hot-seat concession: one browser drives both sides, so the server cannot
 * tell them apart and stamps whoever's turn it is. This is where a
 * session -> PlayerId lookup goes once sessions mean something.
 */
function resolveActor(_session: string, state: GameState): PlayerId {
  return state.currentTurn;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

const notFound = (): Response => json({ error: 'not found' }, { status: 404 });

async function handleApi(request: Request, url: URL, session: string): Promise<Response> {
  // ['api', 'matches'] | ['api', 'matches', :id, 'state' | 'events' | 'commands']
  const segments = url.pathname.split('/').filter(Boolean);
  const [, collection, matchId, resource] = segments;
  // Anything longer is a URL we don't understand, and answering it 200 would
  // be pretending we do.
  if (collection !== 'matches' || segments.length > 4) return notFound();

  if (matchId === undefined) {
    if (request.method === 'GET') return json(await matches.list());
    if (request.method === 'POST') return json(await matches.create(), { status: 201 });
    return notFound();
  }

  if (resource === 'state' && request.method === 'GET') {
    const snapshot = await matches.snapshot(matchId);
    return snapshot ? json(snapshot) : notFound();
  }

  if (resource === 'events' && request.method === 'GET') {
    const since = Number(url.searchParams.get('since') ?? 0);
    if (!Number.isInteger(since) || since < 0) {
      return json({ error: 'since must be a non-negative integer' }, { status: 400 });
    }
    const events = await matches.since(matchId, since);
    return events ? json(events) : notFound();
  }

  if (resource === 'commands' && request.method === 'POST') {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, reason: 'malformed JSON' }, { status: 400 });
    }

    const command = parseCommand(body);
    if (!command) {
      return json({ ok: false, reason: 'not a valid command' }, { status: 400 });
    }

    const snapshot = await matches.snapshot(matchId);
    if (!snapshot) return notFound();

    const result = await matches.submit(matchId, command, resolveActor(session, snapshot.state));
    // A rejected command is a legitimate answer, not an HTTP error -- the
    // client reads `ok`, and 200 keeps rejection distinct from transport
    // failure.
    return json(result);
  }

  return notFound();
}

async function serveClient(url: URL): Promise<Response> {
  // Production only: in dev the client is served by Vite, which proxies
  // /api here. Falls back to index.html so client routing works.
  const index = Bun.file(join(CLIENT_DIST, 'index.html'));
  const serveIndex = async (): Promise<Response> =>
    (await index.exists())
      ? new Response(index)
      : new Response('client not built -- run `bun run build`', { status: 404 });

  if (url.pathname === '/') return serveIndex();

  // Resolve and confirm the result is still inside the build directory. URL
  // parsing already collapses `..`, so this is belt-and-braces rather than a
  // known hole -- but "safe because of how the parser happens to behave" is
  // not a property to rely on for filesystem access.
  const resolved = resolve(CLIENT_DIST, '.' + url.pathname);
  if (!resolved.startsWith(CLIENT_DIST)) return serveIndex();

  const requested = Bun.file(resolved);
  if (await requested.exists()) return new Response(requested);

  return serveIndex();
}

const server = Bun.serve({
  port: PORT,
  // A command is a few hundred bytes. Anything approaching this is either a
  // bug or an attempt to make us allocate; parseCommand caps path length too.
  maxRequestBodySize: 64 * 1024,

  error(cause) {
    // JSON, so the client can parse it and report accurately rather than
    // failing to decode and blaming the network.
    console.error('unhandled request error:', cause);
    return json({ ok: false, reason: 'internal server error' }, { status: 500 });
  },

  async fetch(request) {
    const url = new URL(request.url);
    const session = readCookie(request, SESSION_COOKIE) ?? crypto.randomUUID();
    const isNewSession = readCookie(request, SESSION_COOKIE) === null;

    const response = url.pathname.startsWith('/api/')
      ? await handleApi(request, url, session)
      : await serveClient(url);

    if (isNewSession) response.headers.append('set-cookie', sessionCookie(session));
    return response;
  },
});

console.log(`server listening on http://localhost:${server.port}`);
