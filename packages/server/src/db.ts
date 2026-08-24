import { createClient } from '@libsql/client'
import type { Client } from '@libsql/client'

// Read from the repo-root .env. A local file today; a libsql:// URL on Turso,
// which is the whole reason for the libSQL client over bun:sqlite -- the code
// is identical either way.
const DEFAULT_URL = 'file:./aw.db'

export interface Database {
  client: Client
  url: string
}

// The url travels with the client so migrate() can't be pointed at a different
// database than the one it's configuring.
export function createDb(url: string = process.env.DATABASE_URL ?? DEFAULT_URL): Database {
  return { client: createClient({ url }), url }
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
    await client.execute('PRAGMA journal_mode = WAL')
    await client.execute('PRAGMA busy_timeout = 5000')
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
  `)

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
  `)
}
