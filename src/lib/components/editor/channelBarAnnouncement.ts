// What the channel bar says aloud (v1.2.0 T031, the rest of CODE-11).
//
// The bar's numbers change with nearly every edit: a wait is added, a line moves. A live region that
// carried all of them would read the bar again after every keystroke. The words below are the few
// changes that matter to someone fixing the waits: how many waits have no partner, how many name a
// channel the machine does not have, which channels are not shown, and that the last problem is gone.
// Counts of lined-up waits and of lines in no channel are never said; they stay on the screen.

import { t } from '$lib/i18n';

export interface BarFacts {
  /** Waits lined up, with no partner, and naming a channel the machine does not have. */
  matched: number;
  unmatched: number;
  unknown: number;
  /** The names of the channels that are not shown. */
  notShown: readonly string[];
}

/**
 * The text of the bar's live region for `facts`. `hadProblem` is whether the last answer named a
 * problem: when none is left it is "All waits are lined up." once, and nothing while all was well.
 */
export function announcement(facts: BarFacts, hadProblem: boolean): { text: string; problem: boolean } {
  const parts: string[] = [];
  if (facts.unmatched > 0) parts.push(t('channelPanes.bar.unmatched', { count: facts.unmatched }));
  if (facts.unknown > 0) parts.push(t('channelPanes.bar.unknown', { count: facts.unknown }));
  const problem = parts.length > 0;
  if (!problem && hadProblem && facts.matched > 0) parts.push(t('channelPanes.bar.allLinedUp'));
  if (facts.notShown.length > 0) parts.push(t('channelPanes.bar.notShown', { channels: facts.notShown.join(', ') }));
  return { text: parts.join('. '), problem };
}
