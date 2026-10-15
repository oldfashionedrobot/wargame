import type { GameMap } from './types';

/**
 * One island, with ridges of hills across its middle and roads running in
 * between them from either end -- so the fight is on land the whole way, and
 * the ridges decide where the guns can go.
 *
 * ⚠️ **Drawn from Advance Wars: Dual Strike's War Room map *Ridge Island***, at
 * its own size, by way of Advance Wars By Web's copy (awbw.amarriner.com). Its
 * cities, bases and headquarters are the buildings. Changed only where the
 * deployment zones need it: each end of the island reaches the board's edge
 * where its army stands, cleared to open ground, with a road run down to it.
 *
 * ⚠️ **Near enough a rotation**, as the original is.
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
