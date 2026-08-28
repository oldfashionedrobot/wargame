import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate as runMigrations } from 'drizzle-orm/libsql/migrator';
import * as schema from './schema';
import { DEFAULT_DB_URL } from './const';

// `file:` paths in DATABASE_URL are relative to the REPO ROOT, not to whoever
// is running. That has to be pinned down because two processes read the same
// variable from different directories: the server runs with cwd set to its own
// package, while drizzle-kit runs from the root. Left to cwd, one string would
// mean two different files and migrations would quietly build a second, empty
// database next to the real one.
// fileURLToPath, not .pathname -- the latter percent-encodes, so a checkout
// under a path with a space would resolve to a literal "my%20name" directory.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// Generated SQL lives beside this file's package, not beside whoever is
// running -- the same reason DATABASE_URL is resolved against the repo root.
const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

export interface Database {
  /** Typed queries. What everything reading or writing game data should use. */
  db: LibSQLDatabase<typeof schema>;
  /**
   * The raw driver, for the two things Drizzle cannot express: pragmas, and
   * the `'write'` transaction mode on submit's batch.
   */
  client: Client;
  url: string;
}

// The url travels with the client so migrate() can't be pointed at a different
// database than the one it's configuring.
export function createDb(url: string = DEFAULT_DB_URL): Database {
  const resolved = resolveUrl(url);
  const client = createClient({ url: resolved });
  return { db: drizzle(client, { schema }), client, url: resolved };
}

/**
 * Brings the database up to the schema in `schema.ts`.
 *
 * The DDL is generated -- `bun run db:generate` after changing the schema, and
 * the migration files it writes are the record of what has been applied. This
 * runs pending ones at boot, which is fine for a single instance; a rolling
 * deploy would want it as a separate step before the new code starts.
 */
export async function migrate({ db, client, url }: Database): Promise<void> {
  // WAL lets readers run alongside the single writer; busy_timeout makes
  // contention wait rather than throw SQLITE_BUSY. Both are better than the
  // defaults and neither is on by default. No-ops against a remote libSQL
  // server, which manages its own concurrency.
  if (url.startsWith('file:')) {
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA busy_timeout = 5000');
  }

  await runMigrations(db, { migrationsFolder: MIGRATIONS });
}

function resolveUrl(url: string): string {
  if (!url.startsWith('file:')) return url; // libsql://, http:// -- not a path
  const path = url.slice('file:'.length);
  if (path.startsWith('/')) return url; // already absolute
  return `file:${resolve(REPO_ROOT, path)}`;
}
