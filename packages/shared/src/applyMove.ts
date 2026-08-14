import { canMoveUnit } from './legality'
import type { ActionResult, GameState, MoveAction } from './types'

export function applyMove(state: GameState, action: MoveAction): ActionResult {
  const unit = state.units.find((u) => u.id === action.unitId)
  if (!unit) return { ok: false, reason: 'unit not found' }

  const destination = action.path[action.path.length - 1]
  if (!destination) return { ok: false, reason: 'move has no destination' }

  if (!canMoveUnit(state, unit, destination)) {
    return { ok: false, reason: 'illegal move' }
  }

  return {
    ok: true,
    state: {
      ...state,
      units: state.units.map((u) =>
        u.id === unit.id ? { ...u, position: destination, hasActed: true } : u,
      ),
    },
  }
}
