import type { GameMap } from './types';

export const tester: GameMap = {
  id: 'tester',
  name: 'Tester',

  // . plains   - road   = bridge   ~ river   ^ mountain   f forest
  rows: [
    '....-.....',
    '....-.....',
    '..ff-.....',
    '..ff-.....',
    '~~~~=~~~~~',
    '....-..^^.',
    '....-..^^.',
    '....-.....',
    '....-.....',
    '....-.....',
  ],
};
