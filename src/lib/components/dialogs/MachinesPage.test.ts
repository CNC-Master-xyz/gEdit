// Settings ▸ Machines (plan §5 WP6.10, §7.12, §7.15, AD-31 "Management").
//
// The page's actions are pure functions over a `MachinesDeps`, so they are tested against
// a **fake `MachineService`**: what matters is which call each button makes, what it
// refuses, and what it says — not how a store publishes it.
//
// The one rule with teeth is the error state: while `machines.json` could not be read,
// every write is refused and only "Open machines file" and "Replace with an empty file"
// are offered, so a broken hand edit is never overwritten behind the user's back.
//
// The markup is rendered with `svelte/server` (no DOM), which is where the `machine-row`
// and `machine-action` test ids of §7.12 are checked.

import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocId, NewDocMeta } from '$lib/app/types';
import type { EffectiveProfile, MachineConfig, MachineProblem } from '$lib/core/machines/types';

const LATHE_2: MachineConfig = {
  id: 'lathe-2',
  name: 'Lathe 2',
  profile: 'fanuc-lathe',
  params: { variants: { gcodeSystem: 'B' }, units: 'mm', diameter: 'on' },
};
const MILL_1: MachineConfig = { id: 'mill-1', name: 'Mill 1', profile: 'fanuc-gcode', params: {} };

const fake = vi.hoisted(() => {
  const subscribers = new Set<(value: unknown) => void>();
  let list: unknown[] = [];
  return {
    setList(next: unknown[]): void {
      list = next;
      for (const run of subscribers) run(next);
    },
    getList: (): unknown[] => list,
    listStore: {
      subscribe(run: (value: unknown) => void) {
        subscribers.add(run);
        run(list);
        return (): void => void subscribers.delete(run);
      },
    },
    blocked: { value: false },
    readOnly: { value: false },
    problems: { value: [] as MachineProblem[] },
    defaults: { value: {} as Record<string, string> },
    add: vi.fn(async (_machine: unknown): Promise<string> => 'new-id'),
    update: vi.fn(async (): Promise<void> => {}),
    duplicate: vi.fn(async (): Promise<string> => 'copy-id'),
    remove: vi.fn(async (): Promise<void> => {}),
    setDefault: vi.fn(async (): Promise<void> => {}),
    openFile: vi.fn(async (): Promise<void> => {}),
    replaceWithEmpty: vi.fn(async (): Promise<string | null> => 'machines.json.bak'),
    confirm: vi.fn(async (_o: unknown): Promise<boolean> => true),
    shown: [] as { text: string; error: boolean }[],
  };
});

vi.mock('$lib/app/status', () => ({
  status: {
    show: (text: string, o?: { error?: boolean }) =>
      fake.shown.push({ text, error: o?.error === true }),
  },
}));

vi.mock('$lib/app/dialogs', () => ({
  dialogs: {
    confirm: (o: unknown) => fake.confirm(o),
    exclusive: async (op: () => Promise<unknown>) => op(),
  },
}));

vi.mock('$lib/stores/machines', async () => {
  const { writable } = await import('svelte/store');
  const { noMachine } = await import('$lib/core/machines/effective');
  const { profiles } = await import('$lib/stores/profiles');
  const { docs } = await import('$lib/stores/documents');
  return {
    machines: {
      list: fake.listStore,
      revision: writable(0),
      load: (): void => {},
      reloadFromDisk: async (): Promise<void> => {},
      isMachinesDocument: () => false,
      problems: () => fake.problems.value,
      blocked: () => fake.blocked.value,
      readOnly: () => fake.readOnly.value,
      replaceWithEmpty: fake.replaceWithEmpty,
      get: (id: string) => (fake.getList() as MachineConfig[]).find((m) => m.id === id),
      compatibleWith: () => fake.getList() as MachineConfig[],
      defaultFor: (profileId: string) => fake.defaults.value[profileId] ?? null,
      add: fake.add,
      update: fake.update,
      duplicate: fake.duplicate,
      remove: fake.remove,
      setDefault: fake.setDefault,
      openFile: fake.openFile,
      effective: (id: DocId): EffectiveProfile =>
        ({
          machine: noMachine(profiles.profile(docs.get(id)?.profileId ?? 'fanuc-gcode')),
        }) as unknown as EffectiveProfile,
      setForDoc: (): void => {},
    },
  };
});

const MachinesPage = (await import('./MachinesPage.svelte')).default;
const {
  FIELD_PROFILE,
  addDraft,
  axesOf,
  channelErrors,
  channelProblemsOf,
  codeDbFor,
  draftErrors,
  duplicateDraft,
  editDraft,
  extraErrorsOf,
  fieldsFor,
  fileProblems,
  formReadable,
  hasChannelsStep,
  motionErrors,
  motionProblemsOf,
  openMachinesFile,
  profileChoices,
  profileField,
  removeRow,
  replaceMachinesFile,
  rowsOf,
  submitDraft,
  toggleDefault,
  usersOf,
} = await import('./MachinesPage.svelte');
const { machines } = await import('$lib/stores/machines');
const { codes } = await import('$lib/stores/codes');
const { profiles } = await import('$lib/stores/profiles');
const { docs } = await import('$lib/stores/documents');
const { dialogs } = await import('$lib/app/dialogs');
const { status } = await import('$lib/app/status');
const { t } = await import('$lib/i18n');
const {
  FIELD_BUILDER_CODES,
  FIELD_DIAMETER,
  FIELD_EXTRA_AXES,
  FIELD_NAME,
  FIELD_NOTES,
  FIELD_NUMBER_INPUT,
  FIELD_POINTLESS_FEEDS,
  FIELD_UNITS,
  modalFieldId,
  variantFieldId,
} = await import('$lib/core/machines/fields');
const { initialValues } = await import('$lib/core/forms/values');
const { MV } = await import('$lib/core/machines/motion');
const { ReportedError } = await import('$lib/core/machines/types');

const deps = { machines, profiles, codes, docs, dialogs, status, t };

const page = (): string => render(MachinesPage).body;

/** The `data-action`s the page offers, with `!` on the ones it disabled. */
function actions(html: string): string[] {
  return [...html.matchAll(/data-action="([a-z-]+)"[^>]*data-disabled="([01])"/g)].map(
    ([, action, disabled]) => (disabled === '1' ? `${action}!` : action),
  );
}

function addDoc(profileId: string, machineId?: string | null): DocId {
  const meta: NewDocMeta = {
    path: `/nc/${profileId}.nc`,
    untitledIndex: null,
    profileId,
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly: false,
    readOnlyReason: null,
  };
  const id = docs.add(meta);
  if (machineId !== undefined) docs.update(id, { machineId });
  return id;
}

beforeEach(() => {
  fake.setList([]);
  fake.blocked.value = false;
  fake.readOnly.value = false;
  fake.problems.value = [];
  fake.defaults.value = {};
  fake.shown.length = 0;
  fake.confirm.mockClear().mockResolvedValue(true);
  for (const spy of [
    fake.add,
    fake.update,
    fake.duplicate,
    fake.remove,
    fake.setDefault,
    fake.openFile,
    fake.replaceWithEmpty,
  ]) {
    spy.mockClear();
  }
});

afterEach(() => {
  for (const doc of docs.all()) docs.remove(doc.id);
});

describe('the list', () => {
  it('says what "no machine" means instead of showing an empty box', () => {
    const html = page();
    expect(html).toContain('data-testid="settings-machines"');
    expect(html).toContain(t('machines.page.empty'));
    expect(actions(html)).toEqual(['add', 'import', 'export', 'open-file']);
  });

  it('shows one row per machine with its dialect and its default marker', () => {
    fake.setList([LATHE_2, MILL_1]);
    fake.defaults.value = { 'fanuc-lathe': 'lathe-2' };
    const rows = rowsOf([LATHE_2, MILL_1], deps);
    expect(rows.map((row) => [row.id, row.profileName, row.isDefault])).toEqual([
      // `ProfileInfo.name` is the dialect's own display name, the one the dialect picker
      // shows as well (P1 §7.2).
      ['lathe-2', 'Fanuc lathe G-Code', true],
      ['mill-1', 'Fanuc G-Code', false],
    ]);
    const html = page();
    expect(html).toContain('data-machine-id="lathe-2"');
    expect(html).toContain('data-profile-id="fanuc-lathe"');
    expect(html).toContain('data-default="1"');
    expect(html).toContain('Lathe 2');
    expect(actions(html)).toEqual([
      'edit',
      'duplicate',
      'default',
      'remove',
      'edit',
      'duplicate',
      'default',
      'remove',
      'add',
      'import',
      'export',
      'open-file',
    ]);
  });

  it('keeps a record it could not read as a row of its own, with its problems', () => {
    fake.problems.value = [
      { machineId: 'broken', path: 'machines[2].params.units', message: 'unknown value "metric"' },
      { machineId: 'broken', path: 'machines[2].name', message: 'is empty' },
      { machineId: null, path: '$version', message: 'is newer than this build' },
    ];
    const rows = rowsOf([LATHE_2], deps);
    expect(rows.map((row) => [row.id, row.usable, row.problems.length])).toEqual([
      ['lathe-2', true, 0],
      ['broken', false, 2],
    ]);
    // A problem about the file itself is not a machine's problem.
    expect(fileProblems(deps)).toEqual([
      t('machines.page.problem', { path: '$version', message: 'is newer than this build' }),
    ]);

    fake.setList([LATHE_2]);
    const html = page();
    expect(html).toContain('data-problems="2"');
    expect(html).toContain('is newer than this build');
    // A record gEdit cannot read is not editable here; the file is the way to fix it.
    expect(actions(html)).toEqual([
      'edit',
      'duplicate',
      'default',
      'remove',
      'edit!',
      'duplicate!',
      'default!',
      'remove!',
      'add',
      'import',
      'export',
      'open-file',
    ]);
  });
});

describe('while the machines file could not be read', () => {
  beforeEach(() => {
    fake.blocked.value = true;
  });

  it('disables every write and offers the two ways out (AD-31)', () => {
    const html = page();
    expect(html).toContain(t('machines.page.blocked'));
    expect(actions(html)).toEqual(['add!', 'import!', 'export', 'open-file', 'replace-file']);
    // M13: Import adds to the file, so it waits for a usable one; a copy can always be saved.
  });

  it('refuses a save, a remove and a default, and writes nothing', async () => {
    const draft = addDraft('fanuc-lathe', deps);
    expect(await submitDraft({ ...draft, values: { ...draft.values, name: 'Lathe 2' } }, deps)).toBe(false);
    expect(await removeRow(rowsOf([LATHE_2], deps)[0], deps)).toBe(false);
    await toggleDefault(rowsOf([LATHE_2], deps)[0], deps);
    expect(fake.add).not.toHaveBeenCalled();
    expect(fake.remove).not.toHaveBeenCalled();
    expect(fake.setDefault).not.toHaveBeenCalled();
    expect(fake.confirm).not.toHaveBeenCalled();
    expect(fake.shown.map((entry) => entry.text)).toEqual([
      t('machines.page.blockedAction'),
      t('machines.page.blockedAction'),
      t('machines.page.blockedAction'),
    ]);
  });

  it('still opens the file and still replaces it', async () => {
    await openMachinesFile(deps);
    expect(fake.openFile).toHaveBeenCalledTimes(1);
    expect(await replaceMachinesFile(deps)).toBe(true);
    expect(fake.replaceWithEmpty).toHaveBeenCalledTimes(1);
    // The message names the backup the old file was kept as (B1 A4).
    expect(fake.shown.at(-1)?.text).toBe(t('machines.page.replaced', { name: 'machines.json.bak' }));
    expect(fake.shown.at(-1)?.text).toContain('machines.json.bak');
  });

  it('does not offer Replace for a file a newer gEdit wrote (B1 A4)', () => {
    fake.readOnly.value = true;
    const html = page();
    expect(actions(html)).toEqual(['add!', 'import!', 'export', 'open-file']);
    expect(html).toContain(t('machines.page.blockedNewer'));
    expect(html).not.toContain(t('machines.page.blocked'));
  });

  it('says a failed replace once: the store has already told (B1 A4)', async () => {
    fake.replaceWithEmpty.mockRejectedValueOnce(new ReportedError('a copy could not be kept'));
    expect(await replaceMachinesFile(deps)).toBe(false);
    expect(fake.shown).toEqual([]);
  });

  it('still says a failure the store did not report (B1 A4)', async () => {
    fake.replaceWithEmpty.mockRejectedValueOnce(new Error('weird'));
    expect(await replaceMachinesFile(deps)).toBe(false);
    expect(fake.shown.at(-1)).toEqual({ text: t('machines.page.saveFailed'), error: true });
  });

  it('replaces nothing when the confirmation is declined', async () => {
    fake.confirm.mockResolvedValueOnce(false);
    expect(await replaceMachinesFile(deps)).toBe(false);
    expect(fake.replaceWithEmpty).not.toHaveBeenCalled();
  });
});

describe('Add', () => {
  it('offers exactly the dialects that declare machine parameters', () => {
    const choices = profileChoices(deps);
    expect(choices.map((choice) => choice.value)).toEqual([
      'fanuc-gcode',
      'fanuc-lathe',
      'okuma-osp',
      'sinumerik',
      'sinumerik-mill',
    ]);
    const field = profileField(deps)[0];
    expect(field.id).toBe(FIELD_PROFILE);
    expect(field.type).toBe('choice');
    expect(field.required).toBe(true);
  });

  it('builds the parameter form of the dialect that was picked', () => {
    const draft = addDraft('fanuc-lathe', deps);
    const ids = fieldsFor(draft, deps).map((field) => field.id);
    expect(ids).toEqual([
      FIELD_NAME,
      FIELD_NUMBER_INPUT,
      // T084: the point-less feeds option of the Fanuc profiles, right after the preset.
      FIELD_POINTLESS_FEEDS,
      FIELD_UNITS,
      FIELD_DIAMETER,
      variantFieldId('gcodeSystem'),
      // M9 (R6): the two machine choices come with the form for free, from the declaration.
      variantFieldId('incrementalAddresses'),
      variantFieldId('toolWord'),
      // Manual-check fix D3-4a: the lathe's tool change, turret or tool changer.
      variantFieldId('toolChange'),
      // Review round D5-7: the counter spindle, Y turns with Z (default) or stays.
      variantFieldId('counterSpindleY'),
      modalFieldId('feedmode'),
      modalFieldId('spindlemode'),
      modalFieldId('plane'),
      FIELD_NOTES,
    ]);
    // The mill has no diameter parameter and no G-code system (its one variant, since D3-4c, is
    // what a T on the M6 line is).
    const mill = fieldsFor(addDraft('fanuc-gcode', deps), deps).map((field) => field.id);
    expect(mill).not.toContain(FIELD_DIAMETER);
    expect(mill).not.toContain(variantFieldId('gcodeSystem'));
    expect(mill).toContain(variantFieldId('toolOnChangeLine'));
    // M12.5 decision 5: the Siemens mill offers its tool-change mode; since the manual-check fix
    // D3-4b the turning profile does too (T, or M6 after machine data 22550).
    expect(fieldsFor(addDraft('sinumerik-mill', deps), deps).map((field) => field.id)).toContain(variantFieldId('toolChange'));
    expect(fieldsFor(addDraft('sinumerik', deps), deps).map((field) => field.id)).toContain(variantFieldId('toolChange'));
  });

  it('saves what the form holds, under the dialect it was built for', async () => {
    const draft = addDraft('fanuc-lathe', deps);
    const values = { ...draft.values, [FIELD_NAME]: ' Lathe 2 ', [FIELD_NOTES]: 'turret 1' };
    expect(await submitDraft({ ...draft, values }, deps)).toBe(true);
    expect(fake.add).toHaveBeenCalledTimes(1);
    const saved = fake.add.mock.calls[0][0] as unknown as MachineConfig;
    expect(saved.name).toBe('Lathe 2');
    expect(saved.profile).toBe('fanuc-lathe');
    expect(saved.notes).toBe('turret 1');
    // The preset's whole rule set is stored, not its id (§7.15).
    expect(saved.params.numberInput).toMatchObject({ mode: expect.any(String) });
    expect(saved.params.variants).toEqual({ gcodeSystem: 'A', incrementalAddresses: 'uw', toolWord: 'byLength', toolChange: 'turret', counterSpindleY: 'turns' });
    expect(fake.shown.at(-1)?.text).toBe(t('machines.page.added', { name: 'Lathe 2' }));
  });

  it('keeps the form open and says why when the file cannot be written', async () => {
    fake.add.mockRejectedValueOnce(new Error('disk full'));
    const draft = addDraft('fanuc-lathe', deps);
    const values = { ...draft.values, [FIELD_NAME]: 'Lathe 2' };
    expect(await submitDraft({ ...draft, values }, deps)).toBe(false);
    expect(fake.shown.at(-1)).toEqual({ text: t('machines.page.saveFailed'), error: true });
  });

  it('shows one message, not two, when the store has already reported the failed save (B1 A4)', async () => {
    fake.add.mockRejectedValueOnce(new ReportedError('disk full'));
    const draft = addDraft('fanuc-lathe', deps);
    const values = { ...draft.values, [FIELD_NAME]: 'Lathe 2' };
    expect(await submitDraft({ ...draft, values }, deps)).toBe(false);
    expect(fake.shown).toEqual([]);
  });
});

describe('Edit', () => {
  it('starts from what the record holds', () => {
    fake.setList([LATHE_2]);
    const draft = editDraft(LATHE_2, deps);
    expect(draft.kind).toBe('edit');
    expect(draft.values[FIELD_NAME]).toBe('Lathe 2');
    expect(draft.values[variantFieldId('gcodeSystem')]).toBe('B');
    expect(draft.values[FIELD_DIAMETER]).toBe(true);
  });

  it('sends only the record’s own members to the service', async () => {
    fake.setList([LATHE_2]);
    const draft = editDraft(LATHE_2, deps);
    const values = { ...draft.values, [FIELD_NAME]: 'Lathe 2a' };
    expect(await submitDraft({ ...draft, values }, deps)).toBe(true);
    expect(fake.update).toHaveBeenCalledWith('lathe-2', {
      name: 'Lathe 2a',
      params: expect.objectContaining({
        // D5-3: the record stores no U/W choice, so system B's default (none, G91 only) is saved.
        variants: { gcodeSystem: 'B', incrementalAddresses: 'none', toolWord: 'byLength', toolChange: 'turret', counterSpindleY: 'turns' },
        diameter: 'on',
      }),
      notes: '',
    });
  });

  it('re-offers the power-on codes of the G-code system the form now names', () => {
    fake.setList([LATHE_2]);
    const draft = editDraft(LATHE_2, deps);
    const inB = fieldsFor(draft, deps).find((field) => field.id === modalFieldId('feedmode'));
    const inA = fieldsFor(
      { ...draft, values: { ...draft.values, [variantFieldId('gcodeSystem')]: 'A' } },
      deps,
    ).find((field) => field.id === modalFieldId('feedmode'));
    expect(inB?.choices?.map((choice) => choice.value)).toContain('G95');
    expect(inB?.choices?.map((choice) => choice.value)).not.toContain('G99');
    expect(inA?.choices?.map((choice) => choice.value)).toContain('G99');
  });

  it('reads the power-on codes out of the database the chosen variant names', () => {
    expect(codeDbFor('fanuc-lathe', { variants: { gcodeSystem: 'B' } }, deps).dialect).toBe(
      'fanuc-lathe-b',
    );
    expect(codeDbFor('fanuc-lathe', { variants: { gcodeSystem: 'A' } }, deps).dialect).toBe(
      'fanuc-lathe',
    );
    // Nothing chosen: the variant's own default decides, as `applyMachine` does.
    expect(codeDbFor('fanuc-lathe', undefined, deps).dialect).toBe('fanuc-lathe');
    expect(codeDbFor('fanuc-gcode', undefined, deps).dialect).toBe('fanuc');
  });
});

describe('a name', () => {
  const lathe = () => addDraft('fanuc-lathe', deps);

  it('is required, and the form says so before anything is written', () => {
    const draft = lathe();
    expect(draftErrors(fieldsFor(draft, deps), draft, [])[FIELD_NAME]).toEqual({
      key: 'forms.errors.required',
    });
  });

  it('may not be another machine’s, ignoring case', () => {
    const draft = { ...lathe(), values: { ...lathe().values, [FIELD_NAME]: 'lathe 2' } };
    expect(draftErrors(fieldsFor(draft, deps), draft, [LATHE_2])[FIELD_NAME]).toEqual({
      key: 'machines.page.nameTaken',
    });
  });

  it('may stay its own while the record is edited', () => {
    fake.setList([LATHE_2]);
    const draft = editDraft(LATHE_2, deps);
    expect(draftErrors(fieldsFor(draft, deps), draft, [LATHE_2])[FIELD_NAME]).toBeUndefined();
  });

  it('may not be longer than the file allows', () => {
    const draft = { ...lathe(), values: { ...lathe().values, [FIELD_NAME]: 'x'.repeat(65) } };
    expect(draftErrors(fieldsFor(draft, deps), draft, [])[FIELD_NAME]).toEqual({
      key: 'forms.errors.tooLong',
      params: { count: 64 },
    });
    // Exactly the limit passes.
    const ok = { ...lathe(), values: { ...lathe().values, [FIELD_NAME]: 'x'.repeat(64) } };
    expect(draftErrors(fieldsFor(ok, deps), ok, [])[FIELD_NAME]).toBeUndefined();
  });

  it('may not carry notes the file would refuse (B1 A4)', () => {
    const draft = { ...lathe(), values: { ...lathe().values, [FIELD_NOTES]: 'n'.repeat(501) } };
    expect(draftErrors(fieldsFor(draft, deps), draft, [])[FIELD_NOTES]).toEqual({
      key: 'forms.errors.tooLong',
      params: { count: 500 },
    });
    const ok = { ...lathe(), values: { ...lathe().values, [FIELD_NOTES]: 'n'.repeat(500) } };
    expect(draftErrors(fieldsFor(ok, deps), ok, [])[FIELD_NOTES]).toBeUndefined();
  });

  it('may not give a duplicate a name the file would refuse (B1 A4)', () => {
    const draft = duplicateDraft(LATHE_2, deps);
    draft.values[FIELD_NAME] = 'x'.repeat(65);
    expect(draftErrors(fieldsFor(draft, deps), draft, [LATHE_2])[FIELD_NAME]).toEqual({
      key: 'forms.errors.tooLong',
      params: { count: 64 },
    });
  });
});

describe('Duplicate', () => {
  it('asks for one thing, the new name, and proposes one', () => {
    const draft = duplicateDraft(LATHE_2, deps);
    const fields = fieldsFor(draft, deps);
    expect(fields.map((field) => field.id)).toEqual([FIELD_NAME]);
    expect(draft.values[FIELD_NAME]).toBe(t('machines.page.duplicateName', { name: 'Lathe 2' }));
  });

  it('copies the record through the service, so everything in it comes along', async () => {
    const draft = duplicateDraft(LATHE_2, deps);
    expect(await submitDraft(draft, deps)).toBe(true);
    expect(fake.duplicate).toHaveBeenCalledWith('lathe-2', 'Lathe 2 copy');
    expect(fake.add).not.toHaveBeenCalled();
  });
});

describe('Remove', () => {
  it('names the open documents that use the machine before it goes', async () => {
    fake.setList([LATHE_2]);
    addDoc('fanuc-lathe', 'lathe-2');
    addDoc('fanuc-lathe', 'lathe-2');
    addDoc('fanuc-lathe', null);
    expect(usersOf('lathe-2', deps)).toBe(2);
    expect(await removeRow(rowsOf([LATHE_2], deps)[0], deps)).toBe(true);
    expect((fake.confirm.mock.calls[0][0] as unknown as { title: string }).title).toBe(
      t('machines.page.removeInUse', { name: 'Lathe 2', count: 2 }),
    );
    expect(fake.remove).toHaveBeenCalledWith('lathe-2');
    expect(fake.shown.at(-1)?.text).toBe(t('machines.page.removed', { name: 'Lathe 2' }));
  });

  it('asks plainly when no open document uses it, and removes nothing on a No', async () => {
    fake.setList([LATHE_2]);
    fake.confirm.mockResolvedValueOnce(false);
    expect(await removeRow(rowsOf([LATHE_2], deps)[0], deps)).toBe(false);
    expect((fake.confirm.mock.calls[0][0] as unknown as { title: string }).title).toBe(
      t('machines.page.removeTitle', { name: 'Lathe 2' }),
    );
    expect(fake.remove).not.toHaveBeenCalled();
  });
});

describe('Default for its dialect', () => {
  it('sets the default, and the same button takes it away again', async () => {
    fake.setList([LATHE_2]);
    await toggleDefault(rowsOf([LATHE_2], deps)[0], deps);
    expect(fake.setDefault).toHaveBeenCalledWith('fanuc-lathe', 'lathe-2');

    fake.defaults.value = { 'fanuc-lathe': 'lathe-2' };
    await toggleDefault(rowsOf([LATHE_2], deps)[0], deps);
    expect(fake.setDefault).toHaveBeenLastCalledWith('fanuc-lathe', null);
    expect(fake.shown.at(-1)?.text).toBe(
      t('machines.page.defaultCleared', { profile: 'Fanuc lathe G-Code' }),
    );
  });

  it('reports a refused write instead of pretending it worked', async () => {
    fake.setList([LATHE_2]);
    fake.setDefault.mockRejectedValueOnce(new Error('read-only volume'));
    await toggleDefault(rowsOf([LATHE_2], deps)[0], deps);
    expect(fake.shown.at(-1)).toEqual({ text: t('machines.page.saveFailed'), error: true });
  });
});

describe('the form values a draft starts from', () => {
  it('are the fields’ own defaults, which is what the renderer seeds itself with', () => {
    const draft = addDraft('fanuc-lathe', deps);
    expect(draft.values).toEqual(initialValues(fieldsFor(draft, deps)));
  });
});

describe('the Channels step (M12)', () => {
  const preset = () =>
    structuredClone(
      profiles.profile('fanuc-lathe').machineParams!.channels!.presets.find((p) => p.id === 'fanuc-2path')!.value,
    );

  it('is offered for a dialect that declares channels, never for Duplicate', () => {
    expect(hasChannelsStep(addDraft('fanuc-lathe', deps), deps)).toBe(true);
    expect(hasChannelsStep(addDraft('fanuc-gcode', deps), deps)).toBe(false);
    expect(hasChannelsStep(duplicateDraft(LATHE_2, deps), deps)).toBe(false);
  });

  it('carries the draft’s block into the saved record', async () => {
    const draft = addDraft('fanuc-lathe', deps);
    const values = { ...draft.values, [FIELD_NAME]: 'Two paths' };
    expect(await submitDraft({ ...draft, values, channels: preset() }, deps)).toBe(true);
    const saved = fake.add.mock.calls[0][0] as unknown as MachineConfig;
    expect(saved.params.channels).toEqual(preset());
  });

  it('removes the stored block when the step says "No channels"', async () => {
    const stored = { ...LATHE_2, params: { ...LATHE_2.params, channels: preset() } };
    fake.setList([stored]);
    const draft = editDraft(stored, deps);
    expect(draft.channels).toEqual(preset());
    expect(await submitDraft({ ...draft, channels: undefined }, deps)).toBe(true);
    const sent = fake.update.mock.calls[0] as unknown as [string, { params: Record<string, unknown> }];
    expect(sent[1].params).not.toHaveProperty('channels');
  });

  it('keeps a stored block it was not asked to change', async () => {
    const stored = { ...LATHE_2, params: { ...LATHE_2.params, channels: preset() } };
    fake.setList([stored]);
    const draft = editDraft(stored, deps);
    await submitDraft({ ...draft, values: { ...draft.values, [FIELD_NAME]: 'Renamed' } }, deps);
    const sent = fake.update.mock.calls[0] as unknown as [string, { params: { channels?: unknown } }];
    expect(sent[1].params.channels).toEqual(preset());
  });

  it('refuses to save a block with problems, and lists them', async () => {
    const bad = { ...preset(), sectionStart: undefined, layout: 'single-file' as const };
    const draft = { ...addDraft('fanuc-lathe', deps), channels: bad };
    expect(channelErrors(draft, deps).length).toBeGreaterThan(0);
    const values = { ...draft.values, [FIELD_NAME]: 'Broken' };
    expect(await submitDraft({ ...draft, values }, deps)).toBe(false);
    expect(fake.add).not.toHaveBeenCalled();
  });

  it('lists the problems of a stored broken block on its row, with the machine still usable', () => {
    const stored = { ...LATHE_2, params: { ...LATHE_2.params, channels: { ...preset(), layout: 'sideways' } } };
    fake.setList([stored]);
    const [row] = rowsOf([stored as unknown as MachineConfig], deps);
    expect(row.usable).toBe(true);
    expect(row.problems.length).toBeGreaterThan(0);
    expect(row.problems[0]).toContain('machines[0].params.channels');
  });

  it('shows only the problems of a block that is not even a list of channels', () => {
    expect(formReadable(preset())).toBe(true);
    expect(formReadable(5)).toBe(false);
    expect(formReadable({ layout: 'multi-file' })).toBe(false);
  });

  it('reads a block without syncMarks, and opens it for editing with an empty list of rules (CODE-2)', () => {
    const { syncMarks: _omit, ...bare } = preset();
    void _omit;
    expect(formReadable(bare)).toBe(true);
    const stored = { ...LATHE_2, params: { ...LATHE_2.params, channels: bare } } as unknown as MachineConfig;
    expect(editDraft(stored, deps).channels?.syncMarks).toEqual([]);
    expect(stored.params.channels).not.toHaveProperty('syncMarks'); // the stored record is left alone
  });

  it('does not hand a rule without match or partners to the form (CODE-2)', () => {
    expect(formReadable({ ...preset(), syncMarks: [{ id: 'w', label: 'W' }] })).toBe(false);
    expect(formReadable({ ...preset(), syncMarks: ['x'] })).toBe(false);
    expect(formReadable({ ...preset(), list: ['x'] })).toBe(false);
  });
});

describe('the Motion and limits page (P4.8, plan §6.4 rule 4)', () => {
  const MOTION = { units: 'mm', rapid: { X: 30_000, C: 12_000 }, rapidKind: 'per-axis', maxFeed: 9000, toolChange: 4.5, peckRetract: 0.5 };
  const LIMITS = { units: 'mm', spindle: { main: 6000, S2: 3000 }, travel: { X: { min: -300, max: 300 } } };
  const withBlocks = (params: Record<string, unknown> = {}): MachineConfig =>
    ({ ...MILL_1, params: { ...MILL_1.params, ...params } }) as MachineConfig;
  const sent = (n = 0): { params: Record<string, unknown> } => (fake.update.mock.calls[n] as unknown as [string, { params: Record<string, unknown> }])[1];
  const touch = (draft: ReturnType<typeof editDraft>, values: Record<string, unknown>) =>
    ({ ...draft, motion: { values: { ...draft.motion!.values, ...values }, touched: true } });

  it('reads the axes of the machine’s dialect', () => {
    expect(axesOf('fanuc-gcode', deps).axes).toEqual(['X', 'Y', 'Z', 'A', 'B', 'C', 'U', 'V', 'W']);
    expect(axesOf('fanuc-gcode', deps).angular).toEqual(['A', 'B', 'C']);
    expect(axesOf('fanuc-lathe', deps).axes).toContain('Z');
    expect(axesOf('fanuc-lathe', deps).diameter).toContain('X'); // the lathe's X travel is a diameter
    expect(axesOf('fanuc-gcode', deps).diameter).toEqual([]);
  });

  it('is empty for Add and for a machine without blocks, and is never offered to Duplicate', () => {
    expect(addDraft('fanuc-gcode', deps).motion).toEqual({ values: expect.objectContaining({ units: '' }), touched: false });
    expect(duplicateDraft(MILL_1, deps).motion).toBeUndefined();
    const draft = editDraft(withBlocks(), deps);
    expect(draft.motion?.touched).toBe(false);
    expect(draft.motion?.values.maxFeed).toBeUndefined();
  });

  it('opens the stored blocks in the fields', () => {
    const draft = editDraft(withBlocks({ motion: MOTION, limits: LIMITS }), deps);
    expect(draft.motion?.values).toMatchObject({
      units: 'mm',
      'rapid.X': 30_000,
      'rapid.C': 12_000,
      rapidKind: 'per-axis',
      maxFeed: 9000,
      toolChange: 4.5,
      peckRetract: 0.5,
      'spindle.main': 6000,
      'spindle.others': 'S2=3000',
      'travel.X.min': -300,
      'travel.X.max': 300,
    });
  });

  it('saves a machine whose page was not touched with both blocks exactly as stored, valid or not', async () => {
    for (const params of [{ motion: MOTION, limits: LIMITS }, { motion: { maxFeed: 'fast', unknownMember: { a: 1 } }, limits: 'junk' }]) {
      fake.update.mockClear();
      const stored = withBlocks(params);
      fake.setList([stored]);
      const draft = editDraft(stored, deps);
      expect(await submitDraft({ ...draft, values: { ...draft.values, [FIELD_NAME]: 'Renamed' } }, deps)).toBe(true);
      expect(sent().params.motion).toEqual(params.motion);
      expect(sent().params.limits).toEqual(params.limits);
    }
  });

  it('writes the page into the record: a field changed, a field emptied, the units shared by both blocks', async () => {
    const stored = withBlocks({ motion: MOTION, limits: LIMITS });
    fake.setList([stored]);
    const draft = touch(editDraft(stored, deps), { maxFeed: 300, toolChange: undefined, [MV.rapid('X')]: undefined, [MV.units]: 'inch', [MV.travelMax('X')]: 25 });
    expect(motionErrors(draft, deps)).toEqual([]);
    expect(await submitDraft(draft, deps)).toBe(true);
    expect(sent().params.motion).toEqual({ units: 'inch', rapid: { C: 12_000 }, rapidKind: 'per-axis', maxFeed: 300, peckRetract: 0.5 });
    expect(sent().params.limits).toEqual({ units: 'inch', spindle: { main: 6000, S2: 3000 }, travel: { X: { min: -300, max: 25 } } });
  });

  it('removes the member of an empty field and the block of an empty page; the other parameters stay', async () => {
    const stored = withBlocks({ units: 'mm', motion: MOTION, limits: LIMITS });
    fake.setList([stored]);
    const draft = editDraft(stored, deps);
    const empty = { ...draft, motion: { values: motionToValuesEmpty(), touched: true } };
    expect(await submitDraft(empty, deps)).toBe(true);
    expect(sent().params).not.toHaveProperty('motion');
    expect(sent().params).not.toHaveProperty('limits');
    expect(sent().params.units).toBe('mm');
  });

  it('removes a block that was broken once the page is started again', async () => {
    const stored = withBlocks({ motion: { maxFeed: -1, units: 'mm' } });
    fake.setList([stored]);
    const draft = editDraft(stored, deps);
    expect(await submitDraft({ ...draft, motion: { values: motionToValuesEmpty(), touched: true } }, deps)).toBe(true);
    expect(sent().params).not.toHaveProperty('motion');
  });

  it('adds a machine with a block, and one without when the page is left alone', async () => {
    const draft = addDraft('fanuc-gcode', deps);
    const values = { ...draft.values, [FIELD_NAME]: 'Fresh mill' };
    expect(await submitDraft({ ...draft, values }, deps)).toBe(true);
    expect((fake.add.mock.calls[0][0] as unknown as MachineConfig).params).not.toHaveProperty('motion');
    const filled = { ...draft, values, motion: { values: { ...draft.motion!.values, units: 'mm', maxFeed: 5000 }, touched: true } };
    expect(await submitDraft(filled, deps)).toBe(true);
    expect((fake.add.mock.calls[1][0] as unknown as MachineConfig).params.motion).toEqual({ units: 'mm', maxFeed: 5000 });
  });

  it('refuses to save a page with a negative or absurd value, and says what to fix', async () => {
    const stored = withBlocks();
    fake.setList([stored]);
    for (const bad of [{ maxFeed: -3, units: 'mm' }, { maxFeed: 200_001, units: 'mm' }, { maxFeed: 5000 }, { toolChange: 601 }, { [MV.spindleMain]: 0 }]) {
      const draft = touch(editDraft(stored, deps), bad);
      expect(motionErrors(draft, deps).length).toBeGreaterThan(0);
      expect(await submitDraft(draft, deps)).toBe(false);
    }
    expect(fake.update).not.toHaveBeenCalled();
    expect(fake.shown.at(-1)).toEqual({ text: t('machines.motion.title'), error: true });
  });

  it('checks nothing on a page the user has not touched, so a broken block never blocks the other settings', () => {
    const stored = withBlocks({ motion: { maxFeed: -1, units: 'mm' } });
    expect(motionErrors(editDraft(stored, deps), deps)).toEqual([]);
  });

  it('lists the problems of a stored broken block on its row, with the machine still usable', () => {
    const stored = withBlocks({ motion: { units: 'mm', maxFeed: -1 }, limits: { travel: { X: { min: 5, max: 1 } } } });
    fake.setList([stored]);
    const [row] = rowsOf([stored], deps);
    expect(row.usable).toBe(true);
    expect(row.problems).toHaveLength(3);
    expect(row.problems[0]).toContain('machines[0].params.motion.maxFeed');
    expect(row.problems.some((p) => p.includes('machines[0].params.limits.travel.X'))).toBe(true);
    expect(row.problems.some((p) => p.includes('machines[0].params.limits.units'))).toBe(true);
    expect(motionProblemsOf(withBlocks({ motion: MOTION, limits: LIMITS }), 0, deps)).toEqual([]);
    expect(motionProblemsOf(withBlocks(), 0, deps)).toEqual([]);
  });

  it('judges the blocks against the machine’s own dialect', () => {
    // C is an axis of the Fanuc lathe, A is not
    const lathe = (rapid: Record<string, number>) => ({ ...LATHE_2, params: { ...LATHE_2.params, motion: { units: 'mm', rapid } } }) as MachineConfig;
    expect(motionProblemsOf(lathe({ X: 5000, C: 1000 }), 0, deps)).toEqual([]);
    expect(motionProblemsOf(lathe({ A: 5000 }), 0, deps)).toHaveLength(1);
  });
});

function motionToValuesEmpty(): Record<string, unknown> {
  return { units: '' };
}

describe('problem paths name the record in the file, not in the list shown (H4B-2)', () => {
  // The list shown is sorted by name; the file keeps its own order, and an unreadable record
  // before it also moves the index. The path has to be the line the user would open.
  async function stored(): Promise<MachineConfig[]> {
    const preset = () =>
      structuredClone(profiles.profile('fanuc-lathe').machineParams!.channels!.presets.find((p) => p.id === 'fanuc-2path')!.value);
    const { parseMachinesFile } = await import('$lib/core/machines/file');
    const file = parseMachinesFile({
      machines: [
        { nonsense: true },
        { ...LATHE_2, params: { ...LATHE_2.params, channels: { ...preset(), layout: 'sideways' } } },
        { ...MILL_1, params: { motion: { units: 'mm', maxFeed: -1 } } },
      ],
      defaults: {},
    });
    return file.machines;
  }

  it('motionProblemsOf and channelProblemsOf use the position in the file', async () => {
    const [lathe, mill] = await stored();
    expect(motionProblemsOf(mill, 0, deps)[0]).toContain('machines[2].params.motion.maxFeed');
    expect(channelProblemsOf(lathe, 5, deps)[0]).toContain('machines[1].params.channels');
  });

  it('rowsOf takes it from the record, whatever its place in the sorted list', async () => {
    const [lathe, mill] = await stored();
    const rows = rowsOf([mill, lathe], deps);
    expect(rows[0].problems.some((p) => p.includes('machines[2].params.motion.maxFeed'))).toBe(true);
    expect(rows[1].problems.some((p) => p.includes('machines[1].params.channels'))).toBe(true);
    expect(rows.flatMap((r) => r.problems).some((p) => p.includes('machines[0].params'))).toBe(false);
  });

  it('falls back to the index for a record added in this session', () => {
    const added = { ...MILL_1, params: { motion: { units: 'mm', maxFeed: -1 } } } as unknown as MachineConfig;
    expect(motionProblemsOf(added, 4, deps)[0]).toContain('machines[4].params.motion.maxFeed');
  });
});

// P4h (plan §6.10 rules 13, 14; T123): the two fields of a Siemens machine on the page.
describe('extra axes and builder codes (P4.43b)', () => {
  const siemens = (values: Record<string, unknown>): ReturnType<typeof addDraft> => {
    const draft = addDraft('sinumerik', deps);
    return { ...draft, values: { ...draft.values, [FIELD_NAME]: 'Turn 5', ...values } };
  };

  it('offers them on a Siemens machine and not on a Fanuc one', () => {
    expect(fieldsFor(addDraft('sinumerik', deps), deps).map((field) => field.id)).toEqual(expect.arrayContaining([FIELD_EXTRA_AXES, FIELD_BUILDER_CODES]));
    expect(fieldsFor(addDraft('fanuc-gcode', deps), deps).map((field) => field.id)).not.toContain(FIELD_EXTRA_AXES);
    expect(extraErrorsOf(addDraft('fanuc-gcode', deps), deps)).toEqual({});
  });

  it('tells the programmer how a Siemens control writes such an axis, and that AA90 alone is a program name (NC-1)', () => {
    const help = fieldsFor(addDraft('sinumerik', deps), deps).find((field) => field.id === FIELD_EXTRA_AXES)?.help ?? '';
    expect(help).toContain('A Siemens control writes them with an equals sign (AA=90); some machines also take AA90.');
    expect(help).toContain('Translate, Rotate and Mirror leave that axis as written.');
    expect(help).toContain('On a standard Siemens control AA90 alone is the name of a program, so list a name only if your machine reads it as an axis.');
    expect(help).not.toContain('reads with the value written straight behind them');
  });

  it('shows a name the profile already reads and a code gEdit knows at their fields', () => {
    const errors = extraErrorsOf(siemens({ [FIELD_EXTRA_AXES]: 'AA, SF rotary', [FIELD_BUILDER_CODES]: 'G17' }), deps);
    expect(errors[FIELD_EXTRA_AXES]).toEqual({ key: 'machines.extra.problem', params: { message: '"SF" is already a rotary axis of this profile' } });
    expect(errors[FIELD_BUILDER_CODES]?.params?.message).toBe('G17 is a code gEdit already knows, not a code of the machine builder');
    expect(extraErrorsOf(siemens({ [FIELD_EXTRA_AXES]: 'AA, QQ rotary', [FIELD_BUILDER_CODES]: 'G810-G829' }), deps)).toEqual({});
  });

  it('saves the axes and the codes the user typed', async () => {
    const draft = siemens({ [FIELD_EXTRA_AXES]: 'aa, QQ rotary', [FIELD_BUILDER_CODES]: 'G810-G829' });
    expect(await submitDraft(draft, deps)).toBe(true);
    const saved = fake.add.mock.calls.at(-1)?.[0] as unknown as MachineConfig;
    expect(saved.params.extraAxes).toEqual([{ name: 'AA', kind: 'linear' }, { name: 'QQ', kind: 'rotary' }]);
    expect(saved.params.builderCodes).toBe('G810-G829');
  });

  it('refuses to save a list it cannot read, and says why', async () => {
    const calls = fake.add.mock.calls.length;
    expect(await submitDraft(siemens({ [FIELD_EXTRA_AXES]: 'A1' }), deps)).toBe(false);
    expect(fake.add.mock.calls.length).toBe(calls);
    expect(fake.shown.at(-1)).toEqual({ text: t('machines.extra.notAxis', { item: 'A1' }), error: true });
  });
});
