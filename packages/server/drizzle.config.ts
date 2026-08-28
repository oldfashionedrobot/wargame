import { defineConfig } from 'drizzle-kit';
import { DEFAULT_DB_URL } from './src/const';

// Paths are relative to the REPO ROOT, because drizzle-kit resolves them
// against cwd and the db:* scripts always run from there -- which is also how
// the single root .env gets picked up, since bun loads .env from cwd and does
// not walk up. Running these through `bun run --filter` would break both.
export default defineConfig({
  dialect: 'turso',
  schema: './packages/server/src/schema.ts',
  out: './packages/server/drizzle',
  dbCredentials: {
    url: DEFAULT_DB_URL,
  },
});
