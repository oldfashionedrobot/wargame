import { directionBetween } from './coordinate';
import type { GameEvent, GameState, Unit } from './types';

/**
 * The only thing that mutates state.
 *
 * Reducers decide *what happened* and return events; this turns events into a
 * new state. One mutation path, so live play and replay cannot diverge --
 * `applyEvents(initialState, wholeLog)` reproduces `currentState` by
 * construction rather than by hope.
 *
 * Two rules constrain every event, now and later:
 *
 * 1. **Independently applicable.** Each event must make sense against the state
 *    immediately before it, with no knowledge of its siblings. That is what
 *    lets a log be replayed to any point -- including mid-resolution -- and
 *    what lets the client fold as it animates. A successful charge therefore
 *    emits `unitDied` *and* `unitMoved`, not one compound event.
 *
 * 2. **Absolute values, not deltas.** An event says what something *became*,
 *    never how much it changed by. That is what makes applying one twice a
 *    no-op, so at-least-once delivery is safe and a replaying client needs no
 *    exact-once bookkeeping. `unitAttacked` must therefore carry the target's
 *    resulting HP, not the damage dealt -- damage is `before - after`, which
 *    the client already knows because it holds the preceding state.
 *
 * Idempotent is not commutative: order still matters, and comes from
 * `(seq, index within the events array)`.
 */
export function applyEvents(state: GameState, events: GameEvent[]): GameState {
  return events.reduce(applyEvent, state);
}

function applyEvent(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'unitMoved': {
      const path = event.path;
      const destination = path[path.length - 1];
      // Derived rather than carried: the path already says which way the unit
      // walked, so a facing field on the event would be a second source for
      // the same fact. A single-tile path has no direction, and leaves facing
      // as it was -- turning in place is an action, not a side effect.
      const turned = path.length > 1 ? directionBetween(path[path.length - 2], destination) : null;

      return {
        ...state,
        units: state.units.map((unit): Unit =>
          unit.id === event.unitId
            ? {
                ...unit,
                position: destination,
                facing: turned ?? unit.facing,
                hasActed: true,
              }
            : unit,
        ),
      };
    }

    case 'turnEnded':
      // Only the incoming player's units refresh; the outgoing player's stay
      // spent, which is what stops a unit acting twice across the boundary.
      return {
        ...state,
        currentTurn: event.nextPlayer,
        units: state.units.map((unit) =>
          unit.owner === event.nextPlayer ? { ...unit, hasActed: false } : unit,
        ),
      };

    default:
      // Same reasoning as applyAction's default: events arrive as JSON from the
      // database and over the wire, where types guarantee nothing. Ignoring an
      // unknown event would silently desync a replay, so refuse loudly.
      throw new Error(`unknown event type: ${String((event as GameEvent).type)}`);
  }
}
