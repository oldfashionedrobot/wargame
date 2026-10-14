import type { GameMap } from './types';

export const tester: GameMap = {
  id: 'tester',
  name: 'Tester',

  // . plains   - road   = bridge   ~ river   ^ hills   f forest
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
