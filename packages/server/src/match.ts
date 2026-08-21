import { applyAction } from '@aw/shared'
import type {
  Action,
  Command,
  CommandResult,
  EventsResponse,
  GameEvent,
  GameState,
  PlayerId,
  StateResponse,
} from '@aw/shared'

/**
 * One entry per accepted command. The action is kept for audit -- who tried
 * what, and eventually what the dice said. The events are the replayable
 * record.
 */
export interface LogEntry {
  seq: number
  action: Action
  events: GameEvent[]
}

/**
 * The authority. Holds the only mutable GameState in the process, alongside
 * the append-only log that `?since=N` serves from.
 *
 * Materialized, not folded: current state is kept as a field rather than
 * recomputed from the log on every read. The log is for replay, audit, and
 * catch-up.
 */
export interface Match {
  getState(): GameState
  getSeq(): number
  snapshot(): StateResponse
  since(seq: number): EventsResponse
  submit(command: Command, actor: PlayerId): CommandResult
}

export function createMatch(initial: GameState): Match {
  let state = initial
  let seq = 0
  const log: LogEntry[] = []

  return {
    getState: () => state,
    getSeq: () => seq,

    snapshot: () => ({ seq, state }),

    since(from) {
      // seq is dense and starts at 1, so log[i].seq === i + 1 and everything
      // after `from` starts at index `from`. Indexing rather than filtering
      // matters because every client does this on every poll, forever.
      const events = log.slice(Math.max(0, from)).flatMap((entry) => entry.events)
      return { seq, events, state }
    },

    submit(command, actor) {
      // `actor` is assigned AFTER the spread, so a client-supplied `actor` in
      // the JSON body is overwritten rather than honoured. Swapping these two
      // would be a privilege escalation the type system cannot catch.
      const action: Action = { ...command, actor }

      const result = applyAction(state, action)
      if (!result.ok) return { ok: false, reason: result.reason }

      state = result.state
      seq += 1
      log.push({ seq, action, events: result.events })

      return { ok: true, seq, events: result.events, state }
    },
  }
}
