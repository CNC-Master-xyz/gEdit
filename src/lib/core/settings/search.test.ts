// The settings search (§6.9 rule 43): which entries a query finds, and in which order.
// The dialog's part (a hit opens its page and focuses the control) is tested in SettingsDialog.test.ts.

import { describe, expect, it } from 'vitest';
import { MAX_SEARCH_HITS, fold, searchSettings, type SearchEntry } from './search';

function setting(id: string, label: string, help = '', tab = id.split('.')[0]): SearchEntry {
  return { id, kind: 'setting', tab, label, help };
}
function page(id: string, label: string): SearchEntry {
  return { id, kind: 'page', tab: id, label, help: '' };
}

const entries: SearchEntry[] = [
  setting('editor.tabWidth', 'Tab width', 'How many columns one tab stands for.'),
  setting('files.backup', 'Backup on save', 'Where the copy of a file goes before a save overwrites it.'),
  setting('assist.acceptOnEnter', 'Enter takes the suggestion', 'Off: Enter always ends the block; Tab takes it.'),
  setting('editor.insertSpaces', 'Insert spaces', 'Press the Tab key and get spaces instead of a tab character.'),
  setting('appearance.editorFontSize', 'Font size', 'The size of the program text.'),
  page('keyboard', 'Keyboard'),
  page('machines', 'Machines'),
];

const ids = (query: string, list: readonly SearchEntry[] = entries): string[] =>
  searchSettings(query, list).map((h) => h.entry.id);

describe('the settings search', () => {
  it('has a cap of 20 hits', () => {
    expect(MAX_SEARCH_HITS).toBe(20);
  });

  it('an empty or blank query finds nothing', () => {
    expect(searchSettings('', entries)).toEqual([]);
    expect(searchSettings('   \t ', entries)).toEqual([]);
  });

  it('finds a setting by its label, its help text and its key', () => {
    expect(ids('width')).toEqual(['editor.tabWidth']);
    expect(ids('overwrites')).toEqual(['files.backup']);
    expect(ids('acceptonenter')).toEqual(['assist.acceptOnEnter']);
    expect(ids('files.backup')).toEqual(['files.backup']);
  });

  it('needs every word of the query, in any of the three texts', () => {
    expect(ids('tab width')).toEqual(['editor.tabWidth']);
    expect(ids('width tab')).toEqual(['editor.tabWidth']);
    // "backup" is in the label, "overwrites" in the help.
    expect(ids('backup overwrites')).toEqual(['files.backup']);
    expect(ids('backup nonesuch')).toEqual([]);
    expect(ids('nonesuch')).toEqual([]);
  });

  it('ignores case and accents, in the query and in the texts', () => {
    expect(ids('TAB WIDTH')).toEqual(['editor.tabWidth']);
    expect(fold('Äpfel Ç Ö ü')).toBe('apfel c o u');
    expect(ids('ä', [setting('x.a', 'Spänne', '')])).toEqual(['x.a']);
    expect(ids('a', [setting('x.a', 'Spänne', '')])).toEqual(['x.a']);
    expect(ids('spanne', [setting('x.a', 'Spänne', '')])).toEqual(['x.a']);
  });

  it('ranks a label that starts with the first word before any label, the help and the key', () => {
    const hits = searchSettings('tab', entries);
    expect(hits.map((h) => [h.entry.id, h.where])).toEqual([
      ['editor.tabWidth', 'labelStart'],
      ['assist.acceptOnEnter', 'help'], // "Tab takes it"
      ['editor.insertSpaces', 'help'],
    ]);
  });

  it('puts a label hit before a help hit before a key hit, table order inside a class', () => {
    const list = [
      setting('a.key', 'Other', 'nothing'),
      setting('zzz.sizeKey', 'Other too', 'nothing'),
      setting('b.help', 'Other three', 'the size of it'),
      setting('c.label', 'The size', ''),
      setting('d.start', 'Size first', ''),
      setting('e.label2', 'Pixel size', ''),
    ];
    const hits = searchSettings('size', list);
    expect(hits.map((h) => [h.entry.id, h.where])).toEqual([
      ['d.start', 'labelStart'],
      ['c.label', 'label'],
      ['e.label2', 'label'],
      ['b.help', 'help'],
      ['zzz.sizeKey', 'key'],
    ]);
  });

  it('finds a page by its heading, not by a key it does not have', () => {
    expect(ids('keyboard')).toEqual(['keyboard']);
    expect(ids('mach')).toEqual(['machines']);
    // A page has no key and no help; its id is not searched (the heading is translated, the id is not).
    expect(ids('edit', [page('editor', 'Bearbeiten')])).toEqual([]);
  });

  it('returns at most 20 hits, keeping the best', () => {
    const many = Array.from({ length: 30 }, (_, i) => setting(`k.n${i}`, i < 25 ? `Row ${i}` : `Late row ${i}`));
    const hits = searchSettings('row', many);
    expect(hits).toHaveLength(MAX_SEARCH_HITS);
    expect(hits.map((h) => h.entry.id)).toEqual(many.slice(0, 20).map((e) => e.id));
    // The cap comes after the ranking: a late label start still beats an earlier plain label.
    const mixed = [...Array.from({ length: 25 }, (_, i) => setting(`k.a${i}`, `A row ${i}`)), setting('k.best', 'Row first')];
    expect(searchSettings('row', mixed)[0].entry.id).toBe('k.best');
  });

  it('searches the text it is given, so it follows the language in use', () => {
    const german = [setting('editor.einzug', 'Tabulatorbreite', 'Wie viele Spalten ein Tabulator ist.')];
    expect(ids('tabulator', german)).toEqual(['editor.einzug']);
    expect(ids('tab width', german)).toEqual([]);
  });
});
