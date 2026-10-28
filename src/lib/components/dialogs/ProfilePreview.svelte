<!--
  The live preview of the profile form (Phase 4 plan §6.10 rule 8; P4.40): a small read-only
  editor with a sample program for the draft's grammar and machine type, coloured by the draft.

  The draft is registered as the language `_profile-preview` (which no profile id can be) with its
  grammar, and its own colours are theme rules `<role>._profile-preview`; no real profile's
  documents are touched. The preview is brought up to date at most every 300 ms while the user
  types, and a draft that does not validate keeps the last good preview with the problem above it.
  The editor is made with the options every editor shares and without a `theme` option (F118): the
  themes are global, and defining them again repaints this editor as it does the others.
  Leaving the dialog disposes the editor and defines the themes again without the preview rules.

  The controller below is plain code over an injected Monaco, so the unit test drives it with a
  fake; the markup only hosts it.
-->
<script module lang="ts">
  import { generateGrammar } from '$lib/core/grammar';
  import { languageConfiguration, defineThemes, unionCodeDb, variantDialects } from '$lib/monaco/languages';
  import { SHARED_EDITOR_OPTIONS } from '$lib/monaco/instanceOptions';
  import { PREVIEW_LANGUAGE_ID, sampleProgram } from '$lib/app/profileForm';
  import type { CodeDb } from '$lib/core/codes/types';
  import type { Profile, ProfileColors } from '$lib/core/profiles/types';
  import type { Monaco } from '$lib/monaco/setup';

  /** The least time between two updates of the preview while the draft changes. */
  export const PREVIEW_INTERVAL_MS = 300;

  /** What the preview reaches besides Monaco. */
  export interface PreviewSources {
    /** Every registered profile, for the themes (the preview rules are added to these). */
    profiles(): Profile[];
    /** The user's role colours (`appearance.roleColors`). */
    userColors(): ProfileColors;
    /** The code database the grammar of `profile` is built over (the union of its variants'). */
    codeDb(profile: Profile): CodeDb;
  }

  /** The preview's editor and language, driven by `update(draft)` and ended by `dispose()`. */
  export interface PreviewController {
    update(profile: Profile): void;
    dispose(): void;
    /** True once the sample has been given to the editor and the grammar is in place. */
    readonly ready: boolean;
  }

  /** The draft as the preview language: the same profile under the id no profile can have. */
  export function previewProfile(profile: Profile): Profile {
    return { ...profile, id: PREVIEW_LANGUAGE_ID };
  }

  /** Languages registered once per Monaco instance: Monaco cannot unregister an id. */
  const registeredLanguage = new WeakSet<object>();

  export function createPreviewController(
    monaco: Monaco,
    host: HTMLElement,
    sources: PreviewSources,
    onReady: (ready: boolean) => void = () => {},
  ): PreviewController {
    const editor = monaco.editor.create(host, {
      ...SHARED_EDITOR_OPTIONS,
      value: '',
      language: PREVIEW_LANGUAGE_ID,
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: 'off',
      folding: false,
      glyphMargin: false,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      contextmenu: false,
      hover: { enabled: false },
      occurrencesHighlight: 'off',
      selectionHighlight: false,
      overviewRulerLanes: 0,
      scrollbar: { vertical: 'auto', horizontal: 'auto' },
      fontSize: 13,
    });
    let ready = false;
    let disposed = false;
    let lastText = '';

    const controller: PreviewController = {
      get ready() {
        return ready;
      },
      update(profile) {
        if (disposed) return;
        const draft = previewProfile(profile);
        if (!registeredLanguage.has(monaco)) {
          monaco.languages.register({ id: PREVIEW_LANGUAGE_ID });
          registeredLanguage.add(monaco);
        }
        monaco.languages.setLanguageConfiguration(
          PREVIEW_LANGUAGE_ID,
          languageConfiguration(draft) as Parameters<typeof monaco.languages.setLanguageConfiguration>[1],
        );
        monaco.languages.setMonarchTokensProvider(
          PREVIEW_LANGUAGE_ID,
          generateGrammar(draft, sources.codeDb(profile)) as Parameters<typeof monaco.languages.setMonarchTokensProvider>[1],
        );
        // The draft's own colours are the rules `<role>._profile-preview` of the two themes.
        defineThemes(monaco, [...sources.profiles(), draft], sources.userColors());
        const text = sampleProgram(profile);
        if (text !== lastText) {
          editor.setValue(text);
          lastText = text;
        }
        if (!ready) {
          ready = true;
          onReady(true);
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        const model = editor.getModel();
        editor.dispose();
        model?.dispose();
        // The preview rules leave the themes with the preview.
        try {
          defineThemes(monaco, sources.profiles(), sources.userColors());
        } catch (error) {
          console.error('The themes could not be defined again after the preview', error);
        }
        onReady(false);
      },
    };
    return controller;
  }

  /**
   * Runs `run` with the newest value, at most once in `interval` ms: the first value at once,
   * later ones after the interval since the last run. `cancel` drops a value that is waiting.
   */
  export function throttled<T>(run: (value: T) => void, interval = PREVIEW_INTERVAL_MS): { push(value: T): void; cancel(): void } {
    let last = Number.NEGATIVE_INFINITY;
    let waiting: { value: T } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = (): void => {
      timer = null;
      if (waiting === null) return;
      const { value } = waiting;
      waiting = null;
      last = Date.now();
      run(value);
    };
    return {
      push(value) {
        waiting = { value };
        if (timer !== null) return;
        const wait = Math.max(0, last + interval - Date.now());
        if (wait === 0) fire();
        else timer = setTimeout(fire, wait);
      },
      cancel() {
        waiting = null;
        if (timer !== null) clearTimeout(timer);
        timer = null;
      },
    };
  }
</script>

<script lang="ts">
  import { codes } from '$lib/stores/codes';
  import { profiles } from '$lib/stores/profiles';
  import { settings } from '$lib/stores/settings';
  import { getMonaco } from '$lib/monaco/setup';
  import { t } from '$lib/i18n';

  interface Props {
    /** The draft as a profile (valid), or null before there is one. */
    profile: Profile | null;
    /** Why the preview is not the draft, in words; null when it is. */
    problem?: string | null;
    /** Tests hand over their own Monaco and sources. */
    load?: () => Promise<Monaco>;
    sources?: PreviewSources;
  }

  let { profile, problem = null, load = getMonaco, sources }: Props = $props();

  const realSources: PreviewSources = {
    profiles: () => profiles.list().map((info) => profiles.profile(info.id)),
    userColors: () => settings.get('appearance.roleColors'),
    codeDb: (draft) => {
      try {
        return unionCodeDb(variantDialects(draft).map((id) => codes.byId(id)));
      } catch {
        return { dialect: '', version: 0, addresses: {}, codes: [] };
      }
    },
  };

  let host = $state<HTMLElement | undefined>(undefined);
  let ready = $state(false);
  let failed = $state(false);
  let controller: PreviewController | null = null;
  const feed = throttled<Profile>((draft) => controller?.update(draft));

  // The editor lives as long as the host element does.
  $effect(() => {
    const el = host;
    if (!el) return;
    let cancelled = false;
    void load().then(
      (monaco) => {
        if (cancelled) return;
        controller = createPreviewController(monaco, el, sources ?? realSources, (value) => (ready = value));
        if (profile !== null) controller.update(profile);
      },
      () => {
        if (!cancelled) failed = true;
      },
    );
    return () => {
      cancelled = true;
      feed.cancel();
      controller?.dispose();
      controller = null;
    };
  });

  // Every new draft goes to the editor, at most every 300 ms.
  $effect(() => {
    if (profile !== null) feed.push(profile);
  });
</script>

<div class="preview" data-testid="profile-preview-box">
  <p class="caption">{t('profileForm.preview.title')}</p>
  {#if problem !== null}
    <p class="problem" data-testid="profile-preview-problem">{t('profileForm.preview.stale', { problem })}</p>
  {/if}
  {#if failed}
    <p class="problem">{t('profileForm.preview.failed')}</p>
  {/if}
  <div
    class="editor"
    bind:this={host}
    data-testid="profile-preview"
    data-ready={ready ? '1' : '0'}
    data-language={PREVIEW_LANGUAGE_ID}
  ></div>
</div>

<style>
  .preview {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .caption {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .problem {
    margin: 0;
    color: var(--danger-text);
    font-size: 12px;
  }

  .editor {
    height: 280px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    overflow: hidden;
  }
</style>
