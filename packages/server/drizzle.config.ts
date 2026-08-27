import { defineConfig } from 'drizzle-kit';

// Paths are relative to the REPO ROOT, because drizzle-kit resolves them
// against cwd and the db:* scripts always run from there -- which is also how
// the single root .env gets picked up, since bun loads .env from cwd and does
// not walk up. Running these through `bun run --filter` would break both.
export default defineConfig({
  dialect: 'turso',
  schema: './packages/server/src/schema.ts',
  out: './packages/server/drizzle',
  dbCredentials: {
    // Same default and the same root-relative reading as db.ts. Keep them in
    // step: pointing these two at different files is the failure this whole
    // arrangement exists to prevent.
    url: process.env.DATABASE_URL ?? 'file:./packages/server/vod.db',
  },
});
