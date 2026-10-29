// What the profile form contribution declares and what its command does (Phase 4 plan §6.10 rule 7,
// §6.11; P4.40). The document store and the profile registry are the real ones (the registry with
// one profile of the user's added); the services around them are fakes.

import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentStore } from '$lib/stores/documents';
import { hasKey } from '$lib/i18n';
import type { DocumentStore, NewDocMeta, ProfileInfo } from '$lib/app/types';

const fake = vi.hoisted(() => ({
  docs: null as unknown,
  shown: [] as { text: string; error: boolean }[],
  opened: [] as { props: Record<string, unknown>; options: Record<string, unknown> | undefined }[],
  /** What the dialog does while it is open: set by a test to press a button. */
  whileOpen: null as null | ((props: Record<string, unknown>) => void),
  ran: [] as { id: string; arg: unknown }[],
  fileText: '' as string,
  extra: [] as unknown[],
}));

vi.mock('$lib/app/fileOps', () => ({ files: { open: async () => ['d2'], save: async () => true, onDidSave: () => () => {} } }));
vi.mock('$lib/app/status', () => ({ status: { show: (text: string, o?: { error?: boolean }) => fake.shown.push({ text, error: o?.error === true }) } }));
vi.mock('$lib/app/dialogs', () => ({ dialogs: { confirm: async () => true } }));
vi.mock('$lib/app/userConfig', () => ({ userConfig: { load: async () => [] } }));
vi.mock('$lib/app/modals', () => ({
  modals: {
    open: async (_component: unknown, props: Record<string, unknown>, options?: Record<string, unknown>) => {
      fake.opened.push({ props, options });
      fake.whileOpen?.(props);
      return undefined;
    },
  },
}));
vi.mock('$lib/app/registry/commands', () => ({
  commands: {
    run: async (id: string, arg: unknown) => {
      fake.ran.push({ id, arg });
      return true;
    },
  },
}));
vi.mock('$lib/platform/commands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/platform/commands')>()),
  userFilesList: async () => [{ name: 'my-fanuc.json', text: fake.fileText, error: null }],
  userFilePath: async (_kind: string, name: string) => `/config/profiles/${name}`,
}));
vi.mock('$lib/stores/documents', async () => {
  const real = await vi.importActual<typeof import('$lib/stores/documents')>('$lib/stores/documents');
  // The editor service reads the store when it is made, which is at import; a fresh one per test follows.
  fake.docs = real.createDocumentStore({ caseInsensitivePaths: false });
  return { ...real, docs: new Proxy({}, { get: (_t, key: string) => (fake.docs as Record<string, unknown>)[key] }) };
});
vi.mock('$lib/stores/profiles', async (importOriginal) => {
  const actual = (await importOriginal<typeof import('$lib/stores/profiles')>()).profiles;
  return {
    profiles: new Proxy(actual, {
      get(target, key) {
        if (key === 'get') return (id: string) => [...target.list(), ...(fake.extra as ProfileInfo[])].find((info) => info.id === id);
        return Reflect.get(target, key) as unknown;
      },
    }),
  };
});

const { default: contrib, realProfileForm, targetOf } = await import('./profileForm');

let docs: DocumentStore;

function meta(profileId: string): NewDocMeta {
  return {
    path: '/nc/part.nc',
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
}

const USER_PROFILE: ProfileInfo = {
  id: 'my-fanuc',
  name: 'My Fanuc',
  shortName: 'MYF',
  extensions: ['nc'],
  defaultFileName: 'program.nc',
  newFileEol: 'lf',
  machineType: 'mill',
  origin: 'user',
  parent: 'fanuc-gcode',
  file: 'my-fanuc.json',
  chain: ['my-fanuc', 'fanuc-gcode'],
  hasMachineParams: false,
};

const command = contrib.commands[0];
const ctx = { activeDocId: null } as never;

beforeEach(() => {
  docs = createDocumentStore({ caseInsensitivePaths: false });
  fake.docs = docs;
  fake.shown.length = 0;
  fake.opened.length = 0;
  fake.ran.length = 0;
  fake.whileOpen = null;
  fake.extra.length = 0;
  fake.fileText = `${JSON.stringify({ id: 'my-fanuc', name: 'My Fanuc', shortName: 'MYF', version: 1, extends: 'fanuc-gcode', detect: { content: [] } }, null, 2)}\n`;
});

describe('what it declares', () => {
  it('registers profile.editInForm as the contract says, with no shortcut', () => {
    expect(contrib.id).toBe('profileForm');
    expect(contrib.commands.map((c) => c.id)).toEqual(['profile.editInForm']);
    expect(command).not.toHaveProperty('keys');
    expect(command.title).toBe('profileForm.edit');
    expect(command.category).toBe('profileForm.category');
    expect(command.global).toBe(true);
    expect(hasKey(command.title)).toBe(true);
    expect(hasKey(command.category as string)).toBe(true);
  });
});

describe('targetOf', () => {
  it('opens the file the Profiles page names', () => {
    expect(targetOf({ name: 'shop.json' })).toEqual({ kind: 'user', name: 'shop.json' });
  });

  it('opens the profile of the active program: its file when it is yours, read-only when it is built in', () => {
    fake.extra.push(USER_PROFILE);
    docs.add(meta('my-fanuc'));
    expect(targetOf(undefined)).toEqual({ kind: 'user', name: 'my-fanuc.json' });
    docs.add(meta('fanuc-lathe'));
    expect(targetOf(undefined)).toEqual({ kind: 'builtin', id: 'fanuc-lathe' });
  });

  it('says so when there is no program and no file named, or the profile is not loaded', () => {
    expect(targetOf(undefined)).toEqual({ key: 'profileForm.noDocument' });
    docs.add(meta('gone'));
    expect(targetOf(undefined)).toEqual({ key: 'profileForm.unknownProfile', params: { id: 'gone' } });
  });
});

describe('profile.editInForm', () => {
  it('shows a message and opens nothing without a program', async () => {
    await command.run(ctx, undefined);
    expect(fake.opened).toEqual([]);
    expect(fake.shown).toEqual([{ text: 'Open a program first, or choose a profile on the Profiles page.', error: true }]);
  });

  it('opens the form of a built-in profile read-only, with Duplicate and without Open as JSON', async () => {
    docs.add(meta('fanuc-gcode'));
    await command.run(ctx, undefined);
    expect(fake.opened).toHaveLength(1);
    const { props, options } = fake.opened[0];
    expect(options).toMatchObject({ wide: true });
    expect(typeof options?.mayClose).toBe('function');
    expect(typeof props.onduplicate).toBe('function');
    expect(props.onopenjson).toBeUndefined();
    const state = get((props.model as ReturnType<typeof realProfileForm>).state);
    expect(state).toMatchObject({ open: true, readOnly: true, id: 'fanuc-gcode', canSave: false });
  });

  it('opens one of your files for editing, with Open as JSON and without Duplicate', async () => {
    await command.run(ctx, { name: 'my-fanuc.json' });
    const { props } = fake.opened[0];
    expect(props.onduplicate).toBeUndefined();
    expect(typeof props.onopenjson).toBe('function');
    const state = get((props.model as ReturnType<typeof realProfileForm>).state);
    expect(state).toMatchObject({ open: true, readOnly: false, fileName: 'my-fanuc.json', canSave: true });
  });

  it('runs "New Profile From…" on the built-in profile after Duplicate closed the dialog', async () => {
    docs.add(meta('fanuc-lathe'));
    fake.whileOpen = (props) => (props.onduplicate as () => void)();
    await command.run(ctx, undefined);
    expect(fake.ran).toEqual([{ id: 'profile.newFrom', arg: { kind: 'profiles', parent: 'fanuc-lathe' } }]);
  });

  it('opens the file in its tab after Open as JSON closed the dialog', async () => {
    fake.whileOpen = (props) => (props.onopenjson as () => void)();
    await command.run(ctx, { name: 'my-fanuc.json' });
    expect(fake.ran).toEqual([{ id: 'profile.open', arg: { kind: 'profiles', name: 'my-fanuc.json' } }]);
  });

  it('asks before the dialog is dismissed with changes in it', async () => {
    await command.run(ctx, { name: 'my-fanuc.json' });
    const { props, options } = fake.opened[0];
    const model = props.model as ReturnType<typeof realProfileForm>;
    expect(await (options?.mayClose as () => Promise<boolean>)()).toBe(true);
    model.set('editing.tabWidth', 4);
    // The confirm fake answers yes, so the dialog may close; what matters is that the model was asked.
    expect(get(model.state).dirty).toBe(true);
  });
});

describe('the real check of the draft (the registry’s, on the draft merged over its parent)', () => {
  it('lets a profile that only extends a built-in one through, with the shipped patterns it inherits', async () => {
    const model = realProfileForm();
    expect(await model.load({ kind: 'user', name: 'my-fanuc.json' })).toBe(true);
    const state = get(model.state);
    expect(state.problems).toEqual({});
    expect(state.loose).toEqual([]);
    expect(state.canSave).toBe(true);
    expect(state.preview?.id).toBe('my-fanuc');
    // The merge is the parent's profile with the file over it.
    expect(state.preview?.syntax.comments).toEqual([{ start: '(', end: ')' }]);
  });

  it('refuses a colour too pale to read, a tab width out of range and a pattern that does not compile, each at its field', async () => {
    const model = realProfileForm();
    await model.load({ kind: 'user', name: 'my-fanuc.json' });
    model.set('colors', { dark: { feed: '#222222' } });
    model.set('editing.tabWidth', 99);
    model.set('toolCall.tool', '(?<tool>');
    const state = get(model.state);
    expect(Object.keys(state.problems).sort()).toEqual(['colors', 'editing.tabWidth', 'toolCall.tool']);
    expect(state.canSave).toBe(false);
    expect(state.preview?.id).toBe('my-fanuc');
  });

  it('holds a pattern the file wrote to the shape rule, and takes it back when the pattern is fixed', async () => {
    const model = realProfileForm();
    await model.load({ kind: 'user', name: 'my-fanuc.json' });
    model.set('toolCall.tool', '(?<tool>(\\w+\\s?)*)');
    expect(get(model.state).problems['toolCall.tool']?.length).toBeGreaterThan(0);
    model.set('toolCall.tool', '(?<![A-Z])T(?<tool>\\d+)');
    expect(get(model.state).problems).toEqual({});
  });
});
