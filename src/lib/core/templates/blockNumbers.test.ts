// P3b fix NC (review NC-01, NC-02, SK-02): the block numbers a template names, the numbers a
// program uses, and the values the form starts with (`blockNumbers.ts`). The service's use of
// them is pinned in `app/templateService.test.ts`.

import { describe, expect, it } from 'vitest';
import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { blockNumberParams, blockValueErrors, documentLabels, documentNumbers, documentNumbersByTokens, freeBlockValues, namedOwnNumbers, needsDocumentNumbers, ownNumbers } from './blockNumbers';
import type { TemplateDef } from './types';

const ROUGH: TemplateDef = {
  id: 'rough',
  label: 'Rough',
  group: 'Turning',
  body: '{{N}}G71 U1. R0.5\n{{N}}G71 P{{ns}} Q{{nf}} U0.4 W0.1 F0.2\nN{{ns}} G0 X16.\n/N{{nf}} G1 X34.\n{{N}}G70 P{{ns}} Q{{nf}}',
  params: [
    { id: 'ns', label: 'First', type: 'integer', required: true, min: 1, max: 99999, default: 100 },
    { id: 'nf', label: 'Last', type: 'integer', required: true, min: 1, max: 99999, default: 200 },
  ],
};

const LAP: TemplateDef = {
  id: 'lap',
  label: 'LAP',
  group: 'Turning',
  body: '{{name}} G81\nG0 X16\nG80\n{{N}}G85 {{name}} D3 F0.3\n{{N}}G87 {{name}}',
  params: [{ id: 'name', label: 'Name', type: 'text', required: true, uppercase: true, default: 'NLAP1' }],
};

describe('which parameters name a block', () => {
  it('reads N{{id}} at a line start (also behind a block-delete slash) and a name a reference of the body names', () => {
    expect(blockNumberParams(ROUGH, cpOf('fanuc-lathe'))).toEqual([
      { id: 'ns', kind: 'number' },
      { id: 'nf', kind: 'number' },
    ]);
    expect(blockNumberParams(LAP, cpOf('okuma-osp'))).toEqual([{ id: 'name', kind: 'name' }]);
    // A parameter alone at a line start that nothing references names no block.
    expect(blockNumberParams({ ...LAP, body: '{{name}} G81\nG80' }, cpOf('okuma-osp'))).toEqual([]);
  });

  it('WX-NC-2: a parameter that only a kept word or another program\'s block names is no block number', () => {
    const t = (body: string): TemplateDef => ({ id: 't', label: 'T', group: 'G', body, params: [{ id: 'n', label: 'N', type: 'integer', default: 30 }] });
    // GOTO names a block of its own program; M99 P one of the caller, M98 Q one of the called program.
    expect(blockNumberParams(t('{{n}} G0 X0\nGOTO {{n}}'), cpOf('fanuc-gcode'))).toEqual([{ id: 'n', kind: 'number' }]);
    expect(blockNumberParams(t('{{n}} G0 X0\nM99 P{{n}}'), cpOf('fanuc-gcode'))).toEqual([]);
    expect(blockNumberParams(t('{{n}} G0 X0\nM98 P1000 Q{{n}}'), cpOf('fanuc-lathe'))).toEqual([]);
    // On a mill G73 Q and P are kept as written (a peck depth and a dwell).
    expect(blockNumberParams(t('{{n}} G0 X0\nG73 X1. Z-5. R1. Q{{n}} P20 F100.'), cpOf('fanuc-gcode'))).toEqual([]);
  });

  it('has none on a consecutive profile, and a template without {{N}} and block numbers needs no scan', () => {
    expect(blockNumberParams(ROUGH, cpOf('heidenhain-klartext'))).toEqual([]);
    expect(needsDocumentNumbers(ROUGH, cpOf('heidenhain-klartext'))).toBe(false);
    expect(needsDocumentNumbers({ id: 'x', label: 'X', group: 'G', body: 'M0' }, cpOf('fanuc-gcode'))).toBe(false);
  });
});

describe('what a program uses', () => {
  it('collects the block numbers with their first line, the highest one, and what references point at', () => {
    const doc = documentNumbers(['%', 'O1', 'N10 G0 X0', 'N0100 G0 X1', 'N120 G71 P130 Q170', 'GOTO 300', '(N900 IN A COMMENT)'], cpOf('fanuc-lathe'));
    expect([...doc.blocks.entries()]).toEqual([
      ['10', { line: 3 }],
      ['100', { line: 4 }],
      ['120', { line: 5 }],
    ]);
    expect(doc.max).toBe(120);
    expect([...doc.referenced.entries()]).toEqual([
      ['130', { line: 5, word: 'P130' }],
      ['170', { line: 5, word: 'Q170' }],
      ['300', { line: 6, word: 'GOTO 300' }],
    ]);
  });

  it('WX-NC-2: a word kept as written (mill G73 Q/P) or naming another program\'s block (M99 P, M98 P… Q…) still counts as referenced: refuse, do not guess', () => {
    const cp = cpOf('fanuc-gcode');
    const lines = ['O2000', 'N30 G0 X0', 'N40 G98 G73 X10. Y10. Z-20. R2. Q10 P20 F100.', 'N50 M98 P1000 Q60', 'M99 P30', 'GOTO 70'];
    for (const doc of [documentNumbers(lines, cp), documentNumbersByTokens(lines, cp)]) {
      expect([...doc.referenced.entries()]).toEqual([
        ['10', { line: 3, word: 'Q10' }],
        ['20', { line: 3, word: 'P20' }],
        ['60', { line: 4, word: 'Q60' }],
        ['30', { line: 5, word: 'P30' }],
        ['70', { line: 6, word: 'GOTO 70' }],
      ]);
      expect([...doc.blocks.keys()]).toEqual(['30', '40', '50']);
    }
    // The form refuses N60 (an M98 Q of the file may name it) and says so of a {{N}} that writes N20.
    const doc = documentNumbers(lines, cp);
    const params = [{ id: 'ns', kind: 'number' as const }];
    expect(blockValueErrors(params, { ns: '60' }, doc, [], cp).ns?.key).toBe('templates.value.blockNumberNamed');
    expect(namedOwnNumbers([10, 20], doc, cp).map((x) => x.word)).toEqual(['Q10', 'P20']);
  });

  it('compares Okuma sequence numbers and names as text: N0100 is not N100', () => {
    const doc = documentNumbers(['N0100 G0 X1', 'NLAP1 G81', 'G85 NLAP2 D3', 'GOTO N200'], cpOf('okuma-osp'));
    expect([...doc.blocks.keys()]).toEqual(['N0100', 'NLAP1', 'NLAP2']);
    expect([...doc.referenced.keys()]).toEqual(['N200']);
  });
});

describe('the values the form starts with, and what it refuses', () => {
  const cp = cpOf('fanuc-lathe');
  const env = { cp, prevBlockNumber: 100, numbered: true, sys: { date: '', time: '', file: '', stem: '' } };

  it('keeps a free default, moves a used one above the highest number, never onto its own {{N}} numbers', () => {
    const own = ownNumbers(env, 3);
    expect(own).toEqual([110, 120, 130]);
    const doc = documentNumbers(['N10 G0', 'N100 G0'], cp);
    const params = blockNumberParams(ROUGH, cp);
    expect(freeBlockValues(ROUGH, params, doc, own, cp)).toEqual({ ns: '140', nf: '200' });
    const empty = documentNumbers([''], cp);
    expect(freeBlockValues(ROUGH, params, empty, ownNumbers({ ...env, numbered: false }, 3), cp)).toEqual({ ns: '100', nf: '200' });
  });

  it('takes the lowest free numbers when there is no room above the highest one', () => {
    const doc = documentNumbers(['N99990 G0', 'N100 G0', 'N200 G0'], cp);
    expect(freeBlockValues(ROUGH, blockNumberParams(ROUGH, cp), doc, [], cp)).toEqual({ ns: '10', nf: '20' });
  });

  it('refuses a used, a referenced, an own and a doubled number', () => {
    const doc = documentNumbers(['N100 G0', 'G70 P300 Q400'], cp);
    const params = blockNumberParams(ROUGH, cp);
    const keys = (values: Record<string, unknown>) => Object.fromEntries(Object.entries(blockValueErrors(params, values, doc, [110], cp)).map(([k, v]) => [k, v.key]));
    expect(keys({ ns: '100', nf: '300' })).toEqual({ ns: 'templates.value.blockNumberUsed', nf: 'templates.value.blockNumberNamed' });
    expect(keys({ ns: '110', nf: '500' })).toEqual({ ns: 'templates.value.blockNumberOwn' });
    expect(keys({ ns: '500', nf: '0500' })).toEqual({ nf: 'templates.value.blockNumberTwice' });
    expect(keys({ ns: '', nf: 'x' })).toEqual({});
  });

  it('gives an Okuma name the next free one of its kind', () => {
    const ok = cpOf('okuma-osp');
    const doc = documentNumbers(['NLAP1 G81', 'G85 NLAP2 D3'], ok);
    expect(freeBlockValues(LAP, blockNumberParams(LAP, ok), doc, [], ok)).toEqual({ name: 'NLAP3' });
  });

  it('names the {{N}} numbers a reference of the program points at', () => {
    const doc = documentNumbers(['N120 G71 P130 Q170'], cp);
    expect(namedOwnNumbers([110, 120, 130], doc, cp)).toEqual([{ number: 'N130', word: 'P130', line: 1 }]);
  });
});

describe('v1.2.0 T160: Klartext labels', () => {
  const klartext = cpOf('heidenhain-klartext');
  const tpl = (body: string): TemplateDef => ({ id: 't', label: 'T', group: 'G', body, params: [{ id: 'lbl', label: 'Label', type: 'integer' }, { id: 'n', label: 'N', type: 'integer' }] });

  it('a parameter written as the label of LBL at the head of a block is a label field; one only called is not', () => {
    expect(blockNumberParams(tpl('{{N}}LBL {{lbl}}\n{{N}}CALL LBL {{lbl}}'), klartext)).toEqual([{ id: 'lbl', kind: 'label' }]);
    expect(blockNumberParams(tpl('{{N}}/ LBL {{lbl}}'), klartext)).toEqual([{ id: 'lbl', kind: 'label' }]);
    expect(blockNumberParams(tpl('{{N}}CALL LBL {{n}}'), klartext)).toEqual([]);
    expect(needsDocumentNumbers(tpl('{{N}}LBL {{lbl}}'), klartext)).toBe(true);
    expect(needsDocumentNumbers(tpl('{{N}}L X+{{n}}'), klartext)).toBe(false);
  });

  it('reads the labels a program defines and calls, offers the next free one and refuses a used or called one', () => {
    const doc = documentLabels(['0 BEGIN PGM A MM', '1 CALL LBL 9', '2 LBL 1', '3 LBL 0', '4 LBL 4', '5 L X+0 ; LBL 7 in a comment', '6 LBL "NAME"'], klartext);
    expect([...doc.blocks.keys()]).toEqual(['LBL1', 'LBL4']);
    expect([...doc.referenced.entries()]).toEqual([['LBL9', { line: 2, word: 'CALL LBL 9' }]]);
    expect(doc.max).toBe(4);
    const params = [{ id: 'lbl', kind: 'label' as const }];
    const t: TemplateDef = { ...tpl('{{N}}LBL {{lbl}}'), params: [{ id: 'lbl', label: 'Label', type: 'integer', default: '1', min: 1, max: 65535 }] };
    expect(freeBlockValues(t, params, doc, [], klartext)).toEqual({ lbl: '5' });
    expect(blockValueErrors(params, { lbl: '4' }, doc, [], klartext).lbl).toEqual({ key: 'templates.value.labelUsed', params: { number: 'LBL 4', line: 5 } });
    expect(blockValueErrors(params, { lbl: '9' }, doc, [], klartext).lbl).toEqual({ key: 'templates.value.labelCalled', params: { number: 'LBL 9', word: 'CALL LBL 9', line: 2 } });
    expect(blockValueErrors(params, { lbl: '6' }, doc, [], klartext)).toEqual({});
  });
});
