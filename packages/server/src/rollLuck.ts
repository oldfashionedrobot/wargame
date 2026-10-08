import { LUCK_MAX } from '@wargame/shared';
import type { Command, Rolls } from '@wargame/shared';

/**
 * The only randomness in the codebase, and it is here because `shared/` is not
 * allowed any (invariant 2).
 *
 * ⚠️ **No seed, and that is invariant 9 paying off.** Events carry *resulting*
 * values rather than inputs, so a replay reads what happened and never re-rolls
 * -- there is nothing to reproduce. Most games need a seeded generator, a stored
 * seed and a determinism story; this design bought its way out of all three.
 *
 * ⚠️ **But the rolls are recorded**, on the resolution row beside its events.
 * Luck joins the base before the attacker's band and the defender's cover scale
 * it, so two floors sit between a roll and the damage it produced, and most rolls
 * cannot be read back out of the log. Replay never needs them -- it reads
 * outcomes -- so they are kept as a record, written and not read, like `action`.
 *
 * ⚠️ **`random` is a parameter so the simulator can pass its seeded source** and
 * draw exactly as a match does. The server never passes one.
 */
export function rollLuck(command: Command, random: () => number = Math.random): Rolls {
  // ⚠️ **Reads the command, never the rules.** The note below forbids letting
  // the *rules* decide how many draws to make -- which is why a counter is drawn
  // whether or not it turns out to be used. Asking the command is a different
  // thing: the client already said which attack it is making, and reading that
  // is not running a rule.
  if (command.type === 'move' && command.attackKind === 'charge') {
    // ⚠️ 0..99, not 0..LUCK_MAX. A charge rolls against a *percentage*, and the
    // same draw decides success and sizes the repel -- so one number, on the
    // scale the chance is expressed in.
    return { charge: Math.floor(random() * 100) };
  }

  const draw = () => Math.floor(random() * (LUCK_MAX + 1));
  // ⚠️ Both drawn whether or not both are used. Deciding first and rolling
  // second would make the *number of draws* depend on the rules, which is the
  // coupling that keeping randomness out of `shared/` exists to avoid.
  return { attack: draw(), counter: draw() };
}
