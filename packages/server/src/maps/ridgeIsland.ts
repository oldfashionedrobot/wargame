import type { GameMap } from './types';

/**
 * From Advance Wars: Dual Strike's *Ridge Island*. One island, with ridges of
 * hills across its middle and roads running in between them from either end,
 * so the ridges decide where the guns can go. Near enough a rotation.
 */
export const ridgeIsland: GameMap = {
  id: 'ridge-island',
  name: 'Ridge Island',
  rows: [
    'wwww.........-wwwww',
    'wwww.........-wwwww',
    'www...ff.####-.wwww',
    'ww...ff......-f.www',
    'ww..##-#------f^www',
    'wwf#-....^^ff-f^^ww',
    'wwf.-..ff^^^^f^^^ww',
    'www.-.f^fffff-#ffww',
    'www#-#^^-#ff#-.#fww',
    'www.-.^f-....-..fww',
    'ww.f-.f.-----#...ww',
    'wwf##f^ff##-###fwww',
    'ww...^^f...-..ffwww',
    'www.^^^f###-fffwwww',
    'wwwww......-...wwww',
    'wwwww......-...wwww',
  ],
};
