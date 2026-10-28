// The live preview of the profile form (Phase 4 plan §6.10 rule 8; P4.40). The controller is
// plain code over an injected Monaco, tested here with a fake as in `editorService.test.ts`:
// what the preview registers, what it gives Monaco and what it leaves behind. The markup is
// rendered with `svelte/server`.

import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { sampleProgram, PREVIEW_LANGUAGE_ID } from '$lib/app/profileForm';
import { SHARED_EDITOR_OPTIONS } from '$lib/monaco/instanceOptions';
import type { Profile } from '$lib/core/profiles/types';
import type { Monaco } from '$lib/monaco/setup';
import ProfilePreview, {
  PREVIEW_INTERVAL_MS,
  createPreviewController,
  previewProfile,
  throttled,
  type PreviewSources,
} from './ProfilePreview.svelte';

const base = (BUILTIN_PROFILE_JSON as unknown as Profile[]).find((p) => p.id === 'fanuc-gcode') as Profile;

interface ThemeData {
  rules: { token: string; foreground?: string }[];
}

function fakeMonaco() {
  const model = { dispose: vi.fn() };
  const editor = { setValue: vi.fn(), getModel: () => model, dispose: vi.fn() };
  const monaco = {
    editor: { create: vi.fn((_host: unknown, _options: Record<string, unknown>) => editor), defineTheme: vi.fn((_id: string, _data: ThemeData) => {}) },
    languages: {
      register: vi.fn(),
      setLanguageConfiguration: vi.fn(),
      setMonarchTokensProvider: vi.fn(),
    },
  };
  return { monaco: monaco as unknown as Monaco, raw: monaco, editor, model };
}

const sources: PreviewSources = {
  profiles: () => [base],
  userColors: () => ({}),
  codeDb: () => ({ dialect: '', version: 0, addresses: {}, codes: [] }),
};

const host = {} as HTMLElement;
const themeRules = (raw: ReturnType<typeof fakeMonaco>['raw'], call: number): string[] => (raw.editor.defineTheme.mock.calls[call][1] as ThemeData).rules.map((r) => r.token);
const withColors = { ...base, colors: { dark: { feed: '#ffaa00' }, light: { feed: '#7a3d00' } } } as Profile;

describe('previewProfile', () => {
  it('is the same profile under the id no profile can have', () => {
    const draft = previewProfile(base);
    expect(draft.id).toBe(PREVIEW_LANGUAGE_ID);
    expect(draft.syntax).toBe(base.syntax);
    expect(base.id).toBe('fanuc-gcode');
  });
});

describe('createPreviewController', () => {
  it('makes a read-only editor with the options every editor shares, and without a theme option', () => {
    const { monaco, raw } = fakeMonaco();
    createPreviewController(monaco, host, sources);
    expect(raw.editor.create).toHaveBeenCalledTimes(1);
    const options = raw.editor.create.mock.calls[0][1];
    expect(options).toMatchObject({ ...SHARED_EDITOR_OPTIONS, readOnly: true, language: PREVIEW_LANGUAGE_ID });
    expect('theme' in options).toBe(false);
  });

  it('registers the preview language once per Monaco, gives it the draft’s grammar and shows the sample program', () => {
    const { monaco, raw, editor } = fakeMonaco();
    const controller = createPreviewController(monaco, host, sources);
    expect(controller.ready).toBe(false);
    controller.update(base);
    expect(controller.ready).toBe(true);
    expect(raw.languages.register).toHaveBeenCalledWith({ id: PREVIEW_LANGUAGE_ID });
    expect(raw.languages.setLanguageConfiguration).toHaveBeenCalledWith(PREVIEW_LANGUAGE_ID, expect.anything());
    expect(raw.languages.setMonarchTokensProvider).toHaveBeenCalledWith(PREVIEW_LANGUAGE_ID, expect.objectContaining({ tokenizer: expect.anything() }));
    expect(editor.setValue).toHaveBeenCalledWith(sampleProgram(base));

    controller.update({ ...base, shortName: 'OTHER' } as Profile);
    controller.dispose();
    const second = createPreviewController(monaco, host, sources);
    second.update(base);
    // An id is registered once, whatever the number of previews.
    expect(raw.languages.register).toHaveBeenCalledTimes(1);
  });

  it('defines the themes with the draft’s colours as rules of the preview language, next to the real profiles', () => {
    const { monaco, raw } = fakeMonaco();
    const controller = createPreviewController(monaco, host, sources);
    controller.update(withColors);
    const ids = raw.editor.defineTheme.mock.calls.map((c) => c[0]);
    expect(ids).toEqual(['gedit-dark', 'gedit-light']);
    expect(themeRules(raw, 0)).toContain('feed._profile-preview');
    expect(themeRules(raw, 1)).toContain('feed._profile-preview');
    // The role rules of the built-in palette stay, and nothing is written for a profile without colours.
    expect(themeRules(raw, 0)).toContain('feed');
    expect(themeRules(raw, 0).filter((token) => token.endsWith('.fanuc-gcode'))).toEqual([]);
  });

  // CODE-4: each theme definition rebuilds Monaco's colour map and repaints every open editor.
  it('defines the themes only when the draft’s or the user’s colours changed, not for every keystroke', () => {
    const { monaco, raw } = fakeMonaco();
    let user = {};
    const controller = createPreviewController(monaco, host, { ...sources, userColors: () => user });
    controller.update(withColors);
    expect(raw.editor.defineTheme).toHaveBeenCalledTimes(2);
    controller.update({ ...withColors, name: 'Renamed' } as Profile);
    controller.update({ ...withColors, name: 'Renamed again' } as Profile);
    expect(raw.editor.defineTheme).toHaveBeenCalledTimes(2);
    controller.update({ ...withColors, colors: { dark: { feed: '#ffbb00' } } } as Profile);
    expect(raw.editor.defineTheme).toHaveBeenCalledTimes(4);
    user = { dark: { feed: '#00ccff' } };
    controller.update({ ...withColors, colors: { dark: { feed: '#ffbb00' } } } as Profile);
    expect(raw.editor.defineTheme).toHaveBeenCalledTimes(6);
  });

  it('gives the editor a new sample only when the program differs, so a typed draft does not reset the view', () => {
    const { monaco, editor } = fakeMonaco();
    const controller = createPreviewController(monaco, host, sources);
    controller.update(base);
    controller.update({ ...base, name: 'Renamed' } as Profile);
    expect(editor.setValue).toHaveBeenCalledTimes(1);
    controller.update({ ...base, syntax: { ...base.syntax, comments: [{ start: ';', end: null }] } } as Profile);
    expect(editor.setValue).toHaveBeenCalledTimes(2);
  });

  it('on dispose ends the editor and its model, and defines the themes again without the preview rules', () => {
    const { monaco, raw, editor, model } = fakeMonaco();
    const states: boolean[] = [];
    const controller = createPreviewController(monaco, host, sources, (ready) => states.push(ready));
    controller.update(withColors);
    raw.editor.defineTheme.mockClear();
    controller.dispose();
    expect(editor.dispose).toHaveBeenCalledTimes(1);
    expect(model.dispose).toHaveBeenCalledTimes(1);
    expect(raw.editor.defineTheme).toHaveBeenCalledTimes(2);
    expect(themeRules(raw, 0).some((token) => token.includes('_profile-preview'))).toBe(false);
    expect(states).toEqual([true, false]);
    // Nothing after the end: an update that arrives late is ignored, and a second dispose does nothing.
    controller.update(withColors);
    controller.dispose();
    expect(raw.editor.defineTheme).toHaveBeenCalledTimes(2);
    expect(editor.setValue).toHaveBeenCalledTimes(1);
  });
});

describe('throttled', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the first value at once and then at most once in 300 ms with the newest value', () => {
    const run = vi.fn();
    const feed = throttled<number>(run);
    expect(PREVIEW_INTERVAL_MS).toBe(300);
    feed.push(1);
    expect(run).toHaveBeenCalledTimes(1);
    feed.push(2);
    feed.push(3);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(299);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(3);
    // A quiet time later, the next value goes at once again.
    vi.advanceTimersByTime(1000);
    feed.push(4);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('drops a value that is waiting when it is cancelled', () => {
    const run = vi.fn();
    const feed = throttled<number>(run);
    feed.push(1);
    feed.push(2);
    feed.cancel();
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('the markup', () => {
  it('marks the preview editor with its language and says it is not ready before Monaco is up', () => {
    const html = render(ProfilePreview, { props: { profile: base, load: () => new Promise<Monaco>(() => {}) } }).body;
    expect(html).toContain('data-testid="profile-preview"');
    expect(html).toContain('data-language="_profile-preview"');
    expect(html).toContain('data-ready="0"');
    expect(html).not.toContain('profile-preview-problem');
  });

  it('puts the problem above the preview when the draft is not the one shown', () => {
    const html = render(ProfilePreview, { props: { profile: base, problem: 'editing.tabWidth: too big', load: () => new Promise<Monaco>(() => {}) } }).body;
    expect(html).toContain('data-testid="profile-preview-problem"');
    expect(html).toContain('editing.tabWidth: too big');
  });
});
