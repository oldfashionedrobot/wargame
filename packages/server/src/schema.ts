import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Action, GameEvent, GameState, PlayerId } from '@vod/shared';

export const matches = sqliteTable('matches', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  // Written once and never read back -- deliberately. initial_state plus the
  // log is a complete history; without it the log is deltas with no anchor,
  // and it cannot be reconstructed after the fact.
  initialState: text('initial_state', { mode: 'json' }).$type<GameState>().notNull(),
  // A checkpoint, not a second source of truth: rebuildable at any time by
  // folding the log from initial_state. It exists because submit must validate
  // against current state and already reads this row for the guard below.
  currentState: text('current_state', { mode: 'json' }).$type<GameState>().notNull(),
  currentSeq: integer('current_seq').notNull(),
  // Denormalised out of current_state so listing matches doesn't parse an
  // entire board per row just to show whose turn it is.
  currentTurn: text('current_turn').$type<PlayerId>().notNull(),
});

/**
 * One accepted action and everything it produced.
 *
 * `(match_id, seq)` is the natural key for an ordered log, is what makes
 * `WHERE seq > ?` an index scan, and catches two writers claiming the same seq
 * for free.
 */
export const resolutions = sqliteTable(
  'resolutions',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    // Promoted out of the action blob: the one field of an action worth
    // filtering on, and the only record of who did something once phase 9
    // makes that mean anything.
    actor: text('actor').$type<PlayerId>().notNull(),
    // An audit record, not something to act on. Events are the business data;
    // an Action is the intermediate step between a Command and its outcome.
    // Anything that ever needs to *act* on a stored action should take the
    // command back out of it and re-validate against current state -- validity
    // was proven against the state at the time, which is not this one.
    action: text('action', { mode: 'json' }).$type<Action>().notNull(),
    events: text('events', { mode: 'json' }).$type<GameEvent[]>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.seq] })],
);
