/**
 * Plays the game against itself, many times, and reports what happened.
 *
 *     bun packages/server/scripts/simulate.ts [games] [mapId] [opener] [budget]
 *                                              [blueArmy] [redArmy]
 *
 * An army is comma-separated rows, e.g. `caac......,iiii......`. Omitted, both
 * sides take the default deployment.
 *
 * ⚠️ **A prototype, built to answer whether this is worth building properly.**
 * The bot is one-ply greedy: it scores every legal command by what it gains
 * this instant and takes the best. That is enough to find a *dominant* option
 * and nowhere near enough to play well.
 *
 * ⚠️ **Read the mechanic counts, not the win rate.** A bot confirms whatever it
 * is scored on -- score it on damage and it will report that the
 * highest-damage unit wins. What it cannot fake is whether a rule *fired*: a
 * charge nobody takes and a terrain nobody is defended by are visible here and
 * are not opinions. Both dead dials found by hand so far were of that shape.
 *
 * ⚠️ **Seeded, so any run replays exactly.** `shared/` takes rolls as an input,
 * which is what lets this exist at all -- no server, no database, no browser.
 */
import {
  applyEvents,
  canSelectUnit,
  chargeChance,
  exploreMovement,
  facingToward,
  defenseAt,
  getUnit,
  getUnitType,
  isOver,
  LUCK_MAX,
  refuseAttack,
  refuseCharge,
  repelDamage,
  resolveAction,
  resolveBattle,
  tileDistance,
  tilesInRange,
  validateCommand,
} from '@wargame/shared';
import type { Command, Coordinate, GameEvent, GameState, Unit, UnitTypeId } from '@wargame/shared';
import { getMap } from '../src/maps';
import { createMatchState, PLAYERS } from '../src/matchState';
import { rollLuck } from '../src/rollLuck';
import type { Deployment } from '../src/matchState';

// mulberry32: small, fast, and good enough for tuning statistics.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What failing this charge costs on average: the repel, over every roll that fails it. */
function expectedRepel(defender: Unit, chance: number): number {
  if (chance >= 100) return 0;
  let total = 0;
  for (let roll = chance; roll < 100; roll++) total += repelDamage(defender, chance, roll);
  return total / (100 - chance);
}

/** A candidate command and what the bot thinks it is worth. */
interface Scored {
  command: Command;
  score: number;
}

/**
 * Every legal command for the player to move, scored.
 *
 * ⚠️ Facing is not enumerated -- four facings per destination would multiply
 * the space by four for a bot too shallow to use them. An attack faces its
 * target; a plain move faces the nearest enemy.
 */
function candidates(state: GameState): Scored[] {
  const width = state.grid[0].length;
  const height = state.grid.length;
  const enemies = state.units.filter((u) => u.owner !== state.currentTurn);
  const out: Scored[] = [];
  if (enemies.length === 0) return out;

  for (const unit of state.units) {
    if (!canSelectUnit(state, unit)) continue;
    const type = getUnitType(unit.unitTypeId);
    const movement = exploreMovement(state, unit, type.movementRange, type.movementType);

    // Standing still is a legal "path" of one tile, and is how a gun shoots
    // without giving up its shot to `slow`.
    const stops: Coordinate[] = [unit.position, ...movement.reachable];

    for (const stop of stops) {
      const path = movement.pathTo(stop);
      if (!path) continue;
      const moved: Unit = { ...unit, position: stop };
      const nearest = enemies.reduce((a, b) =>
        tileDistance(stop, a.position) <= tileDistance(stop, b.position) ? a : b,
      );

      // A plain reposition. Scored well below any attack, so the bot only
      // walks when it cannot shoot -- which is what makes it close at all.
      out.push({
        command: {
          type: 'move',
          unitId: unit.id,
          path,
          facing: facingToward(stop, nearest.position, unit.facing),
        },
        score: -tileDistance(stop, nearest.position) * 0.01,
      });

      for (const target of enemies) {
        const facing = facingToward(stop, target.position, unit.facing);

        // Shooting: expected damage, less what the reply is expected to cost.
        if (
          tilesInRange(moved, stop, width, height).some(
            (t) => t.col === target.position.col && t.row === target.position.row,
          ) &&
          refuseAttack(state, moved, path, target.id) === null
        ) {
          const mid = Math.floor(LUCK_MAX / 2);
          const battle = resolveBattle(state, moved, target, { attack: mid, counter: mid });
          const dealt = target.health - battle.defender.health;
          const riposte = moved.health - battle.attacker.health;
          out.push({
            command: {
              type: 'move',
              unitId: unit.id,
              path,
              facing,
              targetUnitId: target.id,
              attackKind: 'fire',
            },
            score: dealt + (battle.defender.health <= 0 ? 25 : 0) - riposte,
          });
        }

        // Charging: a kill at a price, weighted by the odds of getting it.
        if (refuseCharge(state, moved, path, target.id) === null) {
          const chance = chargeChance(state, moved, target);
          if (chance !== null) {
            const p = chance / 100;
            out.push({
              command: {
                type: 'move',
                unitId: unit.id,
                path,
                facing,
                targetUnitId: target.id,
                attackKind: 'charge',
              },
              score: p * (target.health + 25) - (1 - p) * expectedRepel(target, chance),
            });
          }
        }
      }
    }
  }
  return out;
}

interface Stats {
  games: number;
  wins: Record<string, number>;
  unfinished: number;
  turns: number[];
  actions: number[];
  damageBy: Record<string, number>;
  killsBy: Record<string, number>;
  shots: number;
  countered: number;
  chargesTried: number;
  chargesBroke: number;
  hitsOnCover: number;
  hitsTotal: number;
}

function playOne(
  mapId: string,
  seed: number,
  stats: Stats,
  actionCap: number,
  first: string,
  budget: number | null,
  deployments: Deployment[] | undefined,
): void {
  const random = rng(seed);
  const base = createMatchState(getMap(mapId), deployments);
  // ⚠️ Who moves first is a *balance* question, not a fixture detail -- a whole
  // army acts before the other answers, so the opening is the alpha strike the
  // roadmap flags. Switchable so the two can be compared.
  let state: GameState = { ...base, currentTurn: first };
  let turns = 0;
  let actions = 0;

  // ⚠️ **Capped on *actions*, not turns, and that is what makes two budgets
  // comparable.** A turn is a whole roster at one budget and a single command
  // at another, so a turn limit would give one regime eight times the play of
  // the other and then report the difference as a result.
  while (!isOver(state) && actions < actionCap) {
    const options = candidates(state);
    // ⚠️ Ties broken at random, not by enumeration order. Without it both sides
    // play one fixed line and the only variation between games is the dice,
    // which makes any win rate a statement about a single game rather than a
    // distribution.
    const best = options.reduce<Scored | null>(
      (a, b) =>
        a === null || b.score > a.score || (b.score === a.score && random() < 0.5) ? b : a,
      null,
    );
    const command: Command = best ? best.command : { type: 'endTurn' };

    const validation = validateCommand(state, command, state.currentTurn);
    if (!validation.ok) {
      // The bot proposed something the rulebook refuses: a real finding, since
      // every candidate was built from the rulebook's own predicates.
      throw new Error(`bot proposed an illegal command: ${validation.reason}`);
    }

    const rolls = rollLuck(command, random);

    const before = state;
    const events: GameEvent[] = resolveAction(state, validation.action, rolls, budget);
    record(before, command, events, stats);
    state = applyEvents(state, events);
    actions++;
    if (events.some((e) => e.type === 'turnEnded')) turns++;
  }

  stats.games++;
  stats.turns.push(turns);
  stats.actions.push(actions);
  const winner = state.winner;
  if (winner === null) stats.unfinished++;
  else stats.wins[winner] = (stats.wins[winner] ?? 0) + 1;
}

/** What a resolved command says about the rules, read off the events. */
function record(before: GameState, command: Command, events: GameEvent[], stats: Stats): void {
  for (const event of events) {
    if (event.type !== 'battleResolved') continue;
    const attacker = getUnit(before, event.attacker.unitId);
    const defender = getUnit(before, event.defender.unitId);
    if (!attacker || !defender) continue;
    const by: UnitTypeId = attacker.unitTypeId;

    if (event.kind === 'charge') {
      stats.chargesTried++;
      if (event.defender.health <= 0) {
        stats.chargesBroke++;
        stats.killsBy[by] = (stats.killsBy[by] ?? 0) + 1;
      }
      continue;
    }

    stats.shots++;
    stats.hitsTotal++;
    const defense = defenseAt(before, defender.position);
    if (defense > 0) stats.hitsOnCover++;
    stats.damageBy[by] = (stats.damageBy[by] ?? 0) + (defender.health - event.defender.health);
    if (event.defender.health <= 0) stats.killsBy[by] = (stats.killsBy[by] ?? 0) + 1;
    if (event.answered && event.attacker.health < attacker.health) stats.countered++;
  }
  void command;
}

// --- run -------------------------------------------------------------------

const games = Number(process.argv[2] ?? 200);
const mapId = process.argv[3] ?? 'classic';

/**
 * An army per side, as comma-separated rows -- `caac......,iiii......`.
 *
 * ⚠️ **Composition is the point of passing them, not deployment.** Both sides
 * run the identical policy, so any departure from an even split is the map, the
 * deployment, or the *armies* rather than the bot -- which is what makes an
 * asymmetric pair the one case these win rates are trustworthy for.
 *
 * Omit both and the default deployment applies, so the existing invocations
 * mean exactly what they meant before.
 */
const parseArmy = (arg: string | undefined) => arg?.split(',');
const blueArmy = parseArmy(process.argv[6]);
const redArmy = parseArmy(process.argv[7]) ?? blueArmy;
const deployments: Deployment[] | undefined =
  blueArmy && redArmy
    ? [
        { player: PLAYERS[0], army: blueArmy },
        { player: PLAYERS[1], army: redArmy },
      ]
    : undefined;
const ACTION_CAP = 480; // 60 turns of a full eight-unit roster

const stats: Stats = {
  games: 0,
  wins: {},
  unfinished: 0,
  turns: [],
  actions: [],
  damageBy: {},
  killsBy: {},
  shots: 0,
  countered: 0,
  chargesTried: 0,
  chargesBroke: 0,
  hitsOnCover: 0,
  hitsTotal: 0,
};

const first = process.argv[4] ?? 'player-blue';
// ⚠️ **The turn budget is passed, not inherited.** `resolveAction` takes it as
// an argument for the tests' sake; the same seam lets a whole regime be
// compared here without editing `turns.ts` and rebuilding an opinion from
// memory. `all` means the whole roster, which is `ACTIONS_PER_TURN`'s `null`.
const budgetArg = process.argv[5] ?? 'all';
const budget: number | null = budgetArg === 'all' ? null : Number(budgetArg);
const started = Date.now();
for (let i = 0; i < games; i++)
  playOne(mapId, i + 1, stats, ACTION_CAP, first, budget, deployments);
const elapsed = Date.now() - started;

const pct = (n: number, d: number) => (d === 0 ? '  —  ' : `${((100 * n) / d).toFixed(1)}%`);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sorted = [...stats.turns].sort((a, b) => a - b);

console.log(
  `\n${stats.games} games on ${mapId}, greedy both sides, ${first} opens, ` +
    `${budgetArg} per turn, ${elapsed} ms\n` +
    (deployments
      ? `  blue ${deployments[0].army.join(',')}   red ${deployments[1].army.join(',')}\n`
      : ''),
);

console.log('outcome');
for (const [player, n] of Object.entries(stats.wins)) {
  console.log(`  ${player.padEnd(14)} ${String(n).padStart(5)}  ${pct(n, stats.games)}`);
}
console.log(
  `  ${'unfinished'.padEnd(14)} ${String(stats.unfinished).padStart(5)}  ${pct(stats.unfinished, stats.games)}  (hit the ${ACTION_CAP}-action cap)`,
);

const sortedActions = [...stats.actions].sort((a, b) => a - b);
console.log('\nmatch length');
console.log(
  `  turns    mean ${mean(stats.turns).toFixed(1)}   median ${sorted[Math.floor(sorted.length / 2)]}   min ${sorted[0]}   max ${sorted[sorted.length - 1]}`,
);
console.log(
  `  actions  mean ${mean(stats.actions).toFixed(1)}   median ${sortedActions[Math.floor(sortedActions.length / 2)]}   min ${sortedActions[0]}   max ${sortedActions[sortedActions.length - 1]}`,
);

console.log('\ndamage and kills, by who dealt it');
const types: UnitTypeId[] = ['infantry', 'cavalry', 'artillery'];
const totalDamage = types.reduce((a, t) => a + (stats.damageBy[t] ?? 0), 0);
for (const t of types) {
  const d = stats.damageBy[t] ?? 0;
  console.log(
    `  ${t.padEnd(10)} ${String(d).padStart(7)} damage  ${pct(d, totalDamage).padStart(6)} of all   ${String(stats.killsBy[t] ?? 0).padStart(4)} kills`,
  );
}

console.log('\ndid the mechanics fire at all');
console.log(`  shots taken            ${stats.shots}`);
console.log(`  ...answered            ${stats.countered}  ${pct(stats.countered, stats.shots)}`);
console.log(
  `  ...onto covered ground ${stats.hitsOnCover}  ${pct(stats.hitsOnCover, stats.hitsTotal)}`,
);
console.log(`  charges attempted      ${stats.chargesTried}`);
console.log(
  `  ...broke through       ${stats.chargesBroke}  ${pct(stats.chargesBroke, stats.chargesTried)}`,
);
console.log();
