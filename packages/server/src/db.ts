import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';

// Read from the repo-root .env. A local file today; a libsql:// URL on Turso,
// which is the whole reason for the libSQL client over bun:sqlite -- the code
// is identical either way.
const DEFAULT_URL = 'file:./packages/server/aw.db';

// `file:` paths in DATABASE_URL are relative to the REPO ROOT, not to whoever
// is running. That has to be pinned down because two processes read the same
// variable from different directories: the server runs with cwd set to its own
// package, while drizzle-kit runs from the root. Left to cwd, one string would
// mean two different files and migrations would quietly build a second, empty
// database next to the real one.
// fileURLToPath, not .pathname -- the latter percent-encodes, so a checkout
// under a path with a space would resolve to a literal "my%20name" directory.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function resolveUrl(url: string): string {
  if (!url.startsWith('file:')) return url; // libsql://, http:// -- not a path
  const path = url.slice('file:'.length);
  if (path.startsWith('/')) return url; // already absolute
  return `file:${resolve(REPO_ROOT, path)}`;
}

export interface Database {
  client: Client;
  url: string;
}

// The url travels with the client so migrate() can't be pointed at a different
// database than the one it's configuring.
export function createDb(url: string = process.env.DATABASE_URL ?? DEFAULT_URL): Database {
  const resolved = resolveUrl(url);
  return { client: createClient({ url: resolved }), url: resolved };
}

/**
 * Creates the schema if it isn't there. No migration framework yet -- when one
 * is needed it will be because a column changed, and that is the moment to add
 * it rather than now.
 */
export async function migrate({ client, url }: Database): Promise<void> {
  // WAL lets readers run alongside the single writer; busy_timeout makes
  // contention wait rather than throw SQLITE_BUSY. Both are better than the
  // defaults and neither is on by default. No-ops against a remote libSQL
  // server, which manages its own concurrency.
  if (url.startsWith('file:')) {
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA busy_timeout = 5000');
  }

  await client.execute(`
    CREATE TABLE IF NOT EXISTS matches (
      id            TEXT PRIMARY KEY,
      created_at    INTEGER NOT NULL,
      initial_state TEXT    NOT NULL,
      current_state TEXT    NOT NULL,
      current_seq   INTEGER NOT NULL,
      -- Denormalised from current_state so listing matches doesn't have to
      -- parse an entire board per row just to show whose turn it is.
      current_turn  TEXT    NOT NULL
    )
  `);

  // (match_id, seq) is the natural key for an ordered log, and it is what makes
  // `WHERE seq > N` an index scan. It also happens to catch two writers racing
  // for the same seq -- see the note in match.ts.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS log_entries (
      match_id   TEXT    NOT NULL,
      seq        INTEGER NOT NULL,
      action     TEXT    NOT NULL,
      events     TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (match_id, seq)
    )
  `);
}
