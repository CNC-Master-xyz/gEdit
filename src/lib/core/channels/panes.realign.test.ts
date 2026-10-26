// The alignment from the one before an edit (v1.2.0 channel-enter): a line break typed in an ordinary line of a
// pane moves the waits below it and changes nothing about who meets whom. `alignPanes(…, { previous })` then
// works out the rows again and not the whole alignment; whatever it answers equals the whole alignment of the
// same panes (a random-edit test), and it declines (answers the whole) where it cannot know.

import { describe, expect, it } from 'vitest';
import { alignPanes, wasRealigned, type PaneMarks } from './panes';
import { TOY_CHANNELS, lcg, wait } from './paneFixtures';
import type { SyncHit, SyncRule } from './types';

const RULES: SyncRule[] = [
  { id: 'w', label: 'Waits', match: { kind: 'codes', codes: 'M900-M999' }, partners: { kind: 'word', address: 'P', decode: 'digits' }, samePartners: true },
  { id: 'o', label: 'Order', semantics: 'ordered', match: { kind: 'prefix', prefix: 'P' }, partners: { kind: 'all' } },
  { id: 'c', label: 'Count', semantics: 'count', match: { kind: 'codes', codes: 'M100' }, partners: { kind: 'all' } },
];

/** Random panes: marks of a few codes and partner sets in line order, sometimes two on one line. */
function randomPanes(next: () => number, count: number): PaneMarks[] {
  const codes = ['M901', 'M902', 'M903', 'M910'];
  const sets = ['12', '12', '123', '34', '1234', '2', '19'];
  return TOY_CHANNELS.slice(0, count).map((channel) => {
    const marks: SyncHit[] = [];
    let line = 1 + Math.floor(next() * 3);
    const n = Math.floor(next() * 14);
    for (let i = 0; i < n; i++) {
      const pick = next();
      if (pick < 0.12) marks.push(wait(channel.id, line, '', '12', { ruleId: 'c' }));
      else if (pick < 0.2) marks.push(wait(channel.id, line, 'P7', '123', { ruleId: 'o' }));
      else marks.push(wait(channel.id, line, codes[Math.floor(next() * codes.length)], sets[Math.floor(next() * sets.length)]));
      line += next() < 0.15 ? 0 : 1 + Math.floor(next() * 4);
    }
    return { channel, lineCount: line + 2 + Math.floor(next() * 3), marks };
  });
}

/** `panes` with pane `at`'s lines after `from` moved by `delta` (a line break typed at the end of line `from`, or a line taken out). */
function moved(panes: PaneMarks[], at: number, from: number, delta: number): PaneMarks[] {
  return panes.map((p, i) =>
    i !== at ? p : { ...p, lineCount: p.lineCount + delta, marks: p.marks.map((h) => (h.line > from ? { ...h, line: h.line + delta, partners: [...h.partners] } : h)) },
  );
}

describe('alignPanes with the alignment before the edit', () => {
  it('equals the whole alignment after lines moved, for random panes (two, three and four) and random line breaks, and is reused for them', () => {
    let reused = 0;
    let total = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const next = lcg(seed);
      const count = 2 + Math.floor(next() * 3);
      const declared = TOY_CHANNELS.slice(0, count).map((c) => c.id);
      let panes = randomPanes(next, count);
      let previous = alignPanes(panes, RULES, { declared });
      for (let step = 0; step < 6; step++) {
        const at = Math.floor(next() * count);
        const from = Math.floor(next() * (panes[at].lineCount + 1));
        // Lines are added, and sometimes taken out where no mark is (the pane's marks keep their order and their own lines).
        const delta = next() < 0.75 ? 1 + Math.floor(next() * 3) : -1;
        if (delta < 0 && panes[at].marks.some((h) => h.line === from + 1 || h.line === from)) continue;
        panes = moved(panes, at, from, delta);
        const whole = alignPanes(panes, RULES, { declared });
        const quick = alignPanes(panes, RULES, { declared, previous });
        expect(quick, `seed ${seed} step ${step}`).toEqual(whole);
        total++;
        if (wasRealigned(quick)) reused++;
        previous = quick;
      }
    }
    // The reuse is the rule, not a rarity: nothing but lines moved.
    expect(wasRealigned(alignPanes([{ channel: TOY_CHANNELS[0], lineCount: 5, marks: [] }, { channel: TOY_CHANNELS[1], lineCount: 5, marks: [] }], RULES))).toBe(false);
    expect(reused).toBe(total);
  });

  it('does not reuse the alignment when a mark changed, a pane gained or lost a mark, or the rules or the declared channels differ, and still answers the whole', () => {
    const base = (): PaneMarks[] => [
      { channel: TOY_CHANNELS[0], lineCount: 10, marks: [wait('1', 3, 'M901', '12'), wait('1', 6, 'M902', '12')] },
      { channel: TOY_CHANNELS[1], lineCount: 10, marks: [wait('2', 4, 'M901', '12'), wait('2', 7, 'M902', '12')] },
    ];
    const previous = alignPanes(base(), RULES, { declared: ['1', '2'] });
    const check = (panes: PaneMarks[], o: { declared?: string[]; rules?: SyncRule[]; jump?: boolean }): void => {
      const given = { declared: o.declared ?? ['1', '2'], ...(o.jump ? { jumpLines: { '1': [1, 9] } } : {}) };
      const whole = alignPanes(panes, o.rules ?? RULES, given);
      const quick = alignPanes(panes, o.rules ?? RULES, { ...given, previous });
      expect(wasRealigned(quick)).toBe(false);
      expect(quick).toEqual(whole);
    };
    // another code, another partner set, a mark less, a mark more, another channel in a pane
    check([{ ...base()[0], marks: [wait('1', 3, 'M901', '12'), wait('1', 6, 'M903', '12')] }, base()[1]], {});
    check([{ ...base()[0], marks: [wait('1', 3, 'M901', '12'), wait('1', 6, 'M902', '123')] }, base()[1]], {});
    check([{ ...base()[0], marks: [wait('1', 3, 'M901', '12')] }, base()[1]], {});
    check([{ ...base()[0], marks: [...base()[0].marks, wait('1', 8, 'M903', '12')] }, base()[1]], {});
    check([base()[0], { ...base()[1], marks: [wait('2', 4, 'M901', '12', { blocking: false }), wait('2', 7, 'M902', '12')] }], {});
    check(base().slice(0, 1), {});
    check(base(), { declared: ['1'] });
    check(base(), { rules: [RULES[1]] });
    // an alignment made from jump lines is the whole one too: the lines decide its loops
    check(base(), { jump: true });
    const withJumps = alignPanes(base(), RULES, { declared: ['1', '2'], jumpLines: { '1': [1, 9] } });
    const again = alignPanes(base(), RULES, { declared: ['1', '2'], previous: withJumps });
    expect(wasRealigned(again)).toBe(false);
    expect(again).toEqual(alignPanes(base(), RULES, { declared: ['1', '2'] }));
  });

  it('changes nothing of the answer it was given: the alignment before stays as it was', () => {
    const panes: PaneMarks[] = [
      { channel: TOY_CHANNELS[0], lineCount: 10, marks: [wait('1', 3, 'M901', '12')] },
      { channel: TOY_CHANNELS[1], lineCount: 10, marks: [wait('2', 6, 'M901', '12')] },
    ];
    const previous = alignPanes(panes, RULES);
    const frozen = JSON.parse(JSON.stringify(previous));
    const quick = alignPanes(moved(panes, 1, 2, 2), RULES, { previous });
    expect(wasRealigned(quick)).toBe(true);
    expect(JSON.parse(JSON.stringify(previous))).toEqual(frozen);
    // The wait is on row 8 in the second pane now: the first pane is let down by 5, and the second (12 rows) is filled up to its 15.
    expect(quick.zones).toEqual([
      { pane: 0, afterLine: 2, lines: 5 },
      { pane: 1, afterLine: 12, lines: 3 },
    ]);
  });
});
