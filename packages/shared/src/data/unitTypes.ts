// Static content, not runtime state: what a Cavalry *is* never changes during a
// match, so it lives here rather than being copied onto every Unit instance.
// `Unit.unitTypeId` references an entry in this catalog.

export type UnitTypeId = 'infantry' | 'cavalry' | 'artillery';

// One movement type per unit type for now -- they're deliberately kept as
// separate axes because the movement-cost table is keyed by movement type, not
// by unit type, and later units will share rows (e.g. dragoons on 'horse').
export type MovementType = 'foot' | 'horse' | 'wheels';

export interface UnitType {
  id: UnitTypeId;
  name: string;
  movementType: MovementType;
  // Movement points, not tiles: once terrain costs exist these are spent per
  // tile entered via the (movementType, tileType) table rather than 1-per-tile.
  movementRange: number;
}

// A Record, so adding a UnitTypeId turns every incomplete table in data/ into a
// compile error instead of a silent runtime gap.
export const UNIT_TYPES: Record<UnitTypeId, UnitType> = {
  infantry: {
    id: 'infantry',
    name: 'Infantry',
    movementType: 'foot',
    movementRange: 3,
  },
  cavalry: {
    id: 'cavalry',
    name: 'Cavalry',
    movementType: 'horse',
    movementRange: 6,
  },
  artillery: {
    id: 'artillery',
    name: 'Artillery',
    movementType: 'wheels',
    movementRange: 4,
  },
};

export function getUnitType(id: UnitTypeId): UnitType {
  return UNIT_TYPES[id];
}
