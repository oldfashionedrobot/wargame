import type { Command, Coordinate, GameEvent, GameState } from './types'

// The wire contract. Lives in shared because both sides need it: the server
// implements it and the client's HTTP implementation must not have to import
// the server package to know its shape.

// --- The interface the client talks to ------------------------------------

export type CommandResult =
  | { ok: true; seq: number; events: GameEvent[]; state: GameState }
  | { ok: false; reason: string }

export type UpdateListener = (events: GameEvent[], state: GameState) => void

export interface GameServer {
  /** Latest known authoritative state. Synchronous, so a remote implementation
   *  serves it from a cache primed before construction completes. */
  getState(): GameState

  /** Submit intent. Async from the first version -- sync-to-async is a
   *  retrofit that touches every call site. */
  submit(command: Command): Promise<CommandResult>

  /**
   * Register for state changes. Fires with current state as soon as it has
   * one -- synchronously for an implementation that already holds it, on
   * connect for a remote one. Never assume delivery before this call returns.
   *
   * Implementations deduplicate by `seq`, so a listener sees each update
   * exactly once no matter whether it arrived as a submit response or a poll.
   * Callers never see `seq` and never track it.
   *
   * Returns an unsubscribe function.
   */
  subscribe(onUpdate: UpdateListener): () => void

  /**
   * Release the connection: stop polling, drop listeners.
   *
   * Unsubscribing a listener is not enough -- an implementation that polls
   * keeps running regardless of whether anyone is listening, so whoever
   * constructed the server has to be able to shut it down.
   */
  dispose(): void
}

// --- HTTP shapes ----------------------------------------------------------

/** GET /api/state -- initial load. No events; there's nothing to animate. */
export interface StateResponse {
  seq: number
  state: GameState
}

/** GET /api/events?since=N -- everything after N. */
export interface EventsResponse {
  seq: number
  events: GameEvent[]
  state: GameState
}

// --- Runtime validation ---------------------------------------------------
// TypeScript is erased; a POST body is attacker-controlled and can be
// anything. Hand-rolled because the command union is tiny and a schema library
// would be this package's first dependency.

// A defensive allocation bound, not a game rule -- validatePath enforces the
// real limit (the unit's movement budget). This exists so a hostile payload
// can't make us materialise a million coordinates before the reducer gets a
// chance to reject it. Far above any legitimate path on any plausible map.
const MAX_PATH_STEPS = 256

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseCoordinate(v: unknown): Coordinate | null {
  if (!isObject(v)) return null
  const { col, row } = v
  if (!Number.isInteger(col) || !Number.isInteger(row)) return null
  return { col: col as number, row: row as number }
}

/**
 * Narrows an untrusted payload to a Command, or null if it isn't one.
 *
 * Only ever produces the fields a Command may carry -- extra properties in the
 * input are dropped rather than passed through, so a client cannot smuggle an
 * `actor` or anything else into the authority.
 */
export function parseCommand(input: unknown): Command | null {
  if (!isObject(input)) return null

  switch (input.type) {
    case 'move': {
      if (typeof input.unitId !== 'string') return null
      if (!Array.isArray(input.path)) return null
      if (input.path.length === 0 || input.path.length > MAX_PATH_STEPS) return null
      const path: Coordinate[] = []
      for (const step of input.path) {
        const coordinate = parseCoordinate(step)
        if (!coordinate) return null
        path.push(coordinate)
      }
      return { type: 'move', unitId: input.unitId, path }
    }
    case 'endTurn':
      return { type: 'endTurn' }
    default:
      return null
  }
}
