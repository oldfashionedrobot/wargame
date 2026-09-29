import type { GameMap } from './types';

/**
 * A river across the middle with a single crossing, and one strongpoint on each
 * approach to it.
 *
 * The bridge is the whole board. Infantry fords the river anywhere at 2 and
 * cavalry at 3, but `wheels` cannot enter water at any price -- so artillery has
 * exactly one way across and both players know where it is.
 *
 * ⚠️ **The two approaches are not the same ground, deliberately.** A wood stands
 * beside the road on the near bank and a rise beside it on the far one: two
 * stars of cover anything can walk into, against four that no gun can hold.
 * Whoever crosses first does it past the other's strongpoint, and which kind of
 * strongpoint that is depends on which side of the river you started.
 */
export const classic: GameMap = {
  id: 'classic',
  name: 'Classic',

  // . plains   - road   = bridge   ~ river   ^ mountain   f forest
  rows: [
    '.....-......',
    '.....-......',
    '.....-......',
    '...ff-......',
    '...ff-......',
    '~~~~~=~~~~~~',
    '.....-..^^..',
    '.....-..^^..',
    '.....-......',
    '.....-......',
    '.....-......',
    '.....-......',
  ],
};
