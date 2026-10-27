// The settings search (§6.9 rule 43): the stub, and the rows P4.37 turns into tests.

import { describe, expect, it } from 'vitest';
import { MAX_SEARCH_HITS, searchSettings, type SearchEntry } from './search';

const entries: SearchEntry[] = [
  { id: 'editor.tabWidth', kind: 'setting', tab: 'editor', label: 'Tab width', help: 'How many columns one tab stands for.' },
  { id: 'files.backup', kind: 'setting', tab: 'files', label: 'Backup on save', help: 'Where the copy of a file goes before a save overwrites it.' },
  { id: 'keyboard', kind: 'page', tab: 'keyboard', label: 'Keyboard', help: '' },
];

describe('the settings search (prelude)', () => {
  it('has a cap of 20 hits', () => {
    expect(MAX_SEARCH_HITS).toBe(20);
  });

  it('finds nothing until P4.37', () => {
    expect(searchSettings('tab', entries)).toEqual([]);
  });

  it.todo('every word of the query has to occur, in the label, the help or the key');
  it.todo('case and accents are ignored (Ä finds a)');
  it.todo('ranking: label start, then label, then help, then key; table order inside a class');
  it.todo('an empty or blank query finds nothing');
  it.todo('at most 20 hits');
  it.todo('a page entry (Keyboard, Packages, Configuration, Machines, Profiles) is found by its heading');
  it.todo('dialog: choosing a hit opens its page and focuses the control (data-field)');
  it.todo('dialog: a setting whose row is not in the dialog (dialog: false) is not offered');
  it.todo('dialog: the box is reachable with the keyboard and Escape clears it before it closes the dialog');
});
