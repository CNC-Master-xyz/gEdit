<!--
  Settings ▸ Keyboard (Phase 4 plan §6.9 rules 1–6, AD-55). Owner: P4.34.

  Every registered command (scripts included) with the key it has now, its built-in key and the
  marks "changed", "not available" and "used twice", a search box, "Press a key" to capture a
  key, "Remove key" and "Reset" per command and "Reset all". The edits go through the service
  (`app/keys/userKeys.ts`), which writes `keybindings.json` and puts the key in force at once.
  Keep the root element and its test id: the dialog's tests and the runtime harness find the page by it.

  `keyboardRows` and `conflictLines` are pure and live in the module script, so the rows, the
  marks and the conflict texts are unit tested without a DOM (KeyboardPage.test.ts).
-->
<script module lang="ts">
  import { formatKey } from '$lib/core/keys/keySpec';
  import {
    bindingOf,
    noticeOf,
    valueFor,
    type KeyConflict,
    type KeyNotice,
    type KeyPlatform,
    type MergedKeys,
    type UserBindings,
  } from '$lib/core/keys/userKeys';
  import type { CommandDef, KeySpec } from '$lib/app/types';

  /** One line of the list. `title` and `category` are i18n keys (a script's title is its own name, which `t` returns as it is). */
  export interface KeyboardRow {
    id: string;
    title: string;
    category?: string;
    /** The key in force on this platform, as the user would write it. */
    keyNow?: KeySpec;
    /** The key the command was registered with, on this platform. */
    keyDefault?: KeySpec;
    /** `user` when a user entry says something about this platform. */
    source: 'default' | 'user';
    /** A user entry exists for this platform (the "changed" mark). */
    changed: boolean;
    /** The entry names a command that is not registered now. */
    unused: boolean;
    /** `winner` has the key and took it; `lost` had it by default; `hold` is a user key waiting for the other to move. */
    conflict: 'none' | 'user-over-default' | 'user-user';
    role?: 'winner' | 'lost' | 'hold';
    /** Who the conflict is with (command ids). */
    with: string[];
    notice: KeyNotice | null;
  }

  /**
   * The rows of the page: every command, then the entries of commands that are not registered
   * ("not available"). `defs` carry the DECLARED keys (`commands.defaultKeys`); `merged` is the
   * merge for this platform. Sorted by category key and then command id; the unused ones last.
   */
  export function keyboardRows(
    defs: readonly CommandDef[],
    bindings: UserBindings,
    merged: MergedKeys,
    declared: (id: string) => KeySpec | undefined,
  ): KeyboardRow[] {
    const platform = merged.platform;
    const conflictOf = new Map<string, { kind: KeyConflict['kind']; role: 'winner' | 'lost' | 'hold'; with: string[] }>();
    for (const c of merged.conflicts) {
      if (c.winner !== null) conflictOf.set(c.winner, { kind: c.kind, role: 'winner', with: c.others });
      for (const other of c.others) {
        if (conflictOf.has(other)) continue;
        conflictOf.set(other, {
          kind: c.kind,
          role: c.kind === 'user-user' && bindingOf(bindings, other) !== undefined ? 'hold' : 'lost',
          with: c.winner !== null ? [c.winner] : c.others.filter((o) => o !== other),
        });
      }
    }
    const known = new Set(defs.map((d) => d.id));
    const rows: KeyboardRow[] = defs.map((def) => {
      const entry = bindingOf(bindings, def.id);
      const own = entry === undefined ? undefined : valueFor(entry, platform);
      const keyNow = merged.keys.get(def.id);
      const c = conflictOf.get(def.id);
      const row: KeyboardRow = {
        id: def.id,
        title: def.title,
        source: own === undefined ? 'default' : 'user',
        changed: own !== undefined,
        unused: false,
        conflict: c?.kind ?? 'none',
        with: c?.with ?? [],
        notice: keyNow ? noticeOf(keyNow, platform) : null,
      };
      if (def.category) row.category = def.category;
      if (keyNow) row.keyNow = keyNow;
      const keyDefault = declared(def.id);
      if (keyDefault) row.keyDefault = keyDefault;
      if (c) row.role = c.role;
      return row;
    });
    rows.sort((a, b) => compareStrings(a.category ?? '￿', b.category ?? '￿') || compareStrings(a.id, b.id));
    const unused: KeyboardRow[] = [];
    for (const id of Object.keys(bindings)) {
      if (known.has(id)) continue;
      const own = valueFor(bindings[id], platform);
      const row: KeyboardRow = {
        id,
        title: id,
        source: 'user',
        changed: own !== undefined,
        unused: true,
        conflict: 'none',
        with: [],
        notice: own ? noticeOf(own, platform) : null,
      };
      if (own) row.keyNow = own;
      unused.push(row);
    }
    unused.sort((a, b) => compareStrings(a.id, b.id));
    return rows.concat(unused);
  }

  function compareStrings(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /** The words for the key: '⌘K' on a Mac, 'Ctrl+K' elsewhere; a spec that does not parse as it is. */
  export function labelOf(spec: KeySpec | undefined, platform: KeyPlatform): string | undefined {
    if (!spec) return undefined;
    try {
      return formatKey(spec, platform === 'mac');
    } catch {
      return spec;
    }
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { commands } from '$lib/app/registry/commands';
  import { dialogs } from '$lib/app/dialogs';
  import { userKeys } from '$lib/app/keys/userKeys';
  import { captureKey, type KeyRefusal } from '$lib/core/keys/userKeys';
  import { t } from '$lib/i18n';

  const platform: KeyPlatform = userKeys.platform;
  const keyState = userKeys.state;
  const changed = commands.changed;

  let query = $state('');
  /** The command whose key is being captured. */
  let capturing = $state<string | null>(null);
  /** A refusal under one row: the command and the plain text. */
  let refused = $state<{ id: string; text: string } | null>(null);

  const defs = $derived.by(() => {
    void $changed;
    return commands.list();
  });
  const titles = $derived(new Map(defs.map((def) => [def.id, def.title])));
  /** The keys in force on both platforms for the saved bindings, over the declared keys. */
  const analysed = $derived.by(() => {
    void $changed;
    return userKeys.analyse($keyState.bindings);
  });
  const declared = (id: string): KeySpec | undefined => {
    const keys = commands.defaultKeys(id);
    if (!keys) return undefined;
    return typeof keys === 'string' ? keys : keys[platform];
  };
  const rows = $derived(keyboardRows(defs, $keyState.bindings, analysed[platform], declared));

  function nameOf(id: string): string {
    return t(titles.get(id) ?? id);
  }

  function haystack(row: KeyboardRow): string {
    const group = row.category ? t(row.category) : '';
    return `${group}\n${nameOf(row.id)}\n${row.id}\n${labelOf(row.keyNow, platform) ?? ''}\n${labelOf(row.keyDefault, platform) ?? ''}`.toLowerCase();
  }

  const needle = $derived(query.trim().toLowerCase());
  const shown = $derived(needle ? rows.filter((row) => haystack(row).includes(needle)) : rows);
  const conflicts = $derived([...analysed.mac.conflicts, ...analysed.other.conflicts]);
  const anyChange = $derived(Object.keys($keyState.bindings).length > 0);

  function platformName(p: KeyPlatform): string {
    return t(p === 'mac' ? 'keyboardPage.platformMac' : 'keyboardPage.platformOther');
  }

  function conflictText(c: KeyConflict): string {
    const others = c.others.map(nameOf).join(', ');
    return c.kind === 'user-over-default'
      ? t('keyboardPage.conflictUserOverDefault', { key: c.key, platform: platformName(c.platform), winner: nameOf(c.winner ?? ''), others })
      : t('keyboardPage.conflictUserUser', { key: c.key, platform: platformName(c.platform), others });
  }

  function refusalText(reason: KeyRefusal | 'altGraph'): string {
    return reason === 'altGraph' ? t('keyboardPage.altGraphRefused') : t(`keyboardPage.refusal.${reason}`);
  }

  // --- capturing a key ---------------------------------------------------------

  function stopCapture(): void {
    capturing = null;
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onCaptureKey, true);
  }

  function onCaptureKey(e: KeyboardEvent): void {
    // In the capture phase, so the dialog never sees the key and Esc cancels the capture only.
    e.preventDefault();
    e.stopPropagation();
    const id = capturing;
    if (id === null) return;
    if (e.code === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      stopCapture();
      return;
    }
    const result = captureKey(e, platform);
    if (result === null) return;
    if ('spec' in result) {
      stopCapture();
      refused = null;
      void userKeys.setKey(id, result.spec);
    } else {
      refused = { id, text: refusalText(result.refusal) };
    }
  }

  function startCapture(id: string): void {
    stopCapture();
    refused = null;
    capturing = id;
    window.addEventListener('keydown', onCaptureKey, true);
  }

  onDestroy(stopCapture);

  function clearKey(id: string): void {
    stopCapture();
    refused = null;
    void userKeys.setKey(id, null);
  }

  function resetKey(id: string): void {
    stopCapture();
    refused = null;
    void userKeys.reset(id);
  }

  async function resetAll(): Promise<void> {
    stopCapture();
    refused = null;
    const ok = await dialogs.confirm({
      title: t('keyboardPage.resetAll'),
      message: t('keyboardPage.resetAllConfirm'),
      ok: t('keyboardPage.resetAll'),
      kind: 'warning',
    });
    if (ok) await userKeys.resetAll();
  }
</script>

<section class="keyboard" data-testid="settings-keyboard" aria-label={t('keyboardPage.title')}>
  <h3>{t('keyboardPage.title')}</h3>
  <p class="form-help">{t('keyboardPage.intro')}</p>
  <p class="form-help">{t('keyboardPage.yourSystem', { platform: platformName(platform) })}</p>

  {#if $keyState.readOnly}
    <p class="notice" data-testid="keyboard-readonly">{t('keyboardPage.readOnly')}</p>
  {:else if $keyState.error}
    <p class="notice" data-testid="keyboard-error">{t('keyboardPage.loadFailed')} {$keyState.error}</p>
  {/if}
  {#if $keyState.problems.length > 0}
    <ul class="problems" data-testid="keyboard-problems">
      {#each $keyState.problems as problem (problem.path + problem.reason)}
        <li>{problem.path}: {problem.message}</li>
      {/each}
    </ul>
  {/if}

  {#if conflicts.length > 0}
    <div class="conflicts" data-testid="keyboard-conflicts">
      <h4>{t('keyboardPage.conflictsTitle')}</h4>
      <ul>
        {#each conflicts as c (c.platform + c.key + c.kind)}
          <li data-testid="keyboard-conflict" data-platform={c.platform} data-kind={c.kind}>{conflictText(c)}</li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="toolbar">
    <label for="keyboard-search">{t('keyboardPage.search')}</label>
    <input
      id="keyboard-search"
      class="search"
      data-testid="keyboard-search"
      type="text"
      autocomplete="off"
      spellcheck="false"
      placeholder={t('keyboardPage.searchPlaceholder')}
      bind:value={query}
    />
    <span class="meta" data-testid="keyboard-count">{t('keyboardPage.count', { count: shown.length })}</span>
    <button
      type="button"
      class="action"
      data-testid="keyboard-reset-all"
      disabled={!anyChange || $keyState.readOnly}
      onclick={() => void resetAll()}
    >
      {t('keyboardPage.resetAll')}
    </button>
  </div>

  <ul class="list">
    {#each shown as row (row.id)}
      {@const nowLabel = labelOf(row.keyNow, platform)}
      {@const defaultLabel = labelOf(row.keyDefault, platform)}
      <li
        class="row"
        class:changed={row.changed}
        class:conflict={row.conflict !== 'none'}
        data-testid="keyboard-row"
        data-command={row.id}
        data-source={row.source}
        data-conflict={row.conflict}
      >
        <div class="name">
          <span class="title">{nameOf(row.id)}</span>
          {#if row.category}<span class="meta">{t(row.category)}</span>{/if}
          {#if row.changed}<span class="mark" data-testid="keyboard-mark-changed">{t('keyboardPage.changed')}</span>{/if}
          {#if row.unused}<span class="mark warn" data-testid="keyboard-mark-unused" title={t('keyboardPage.unusedHelp')}>{t('keyboardPage.unused')}</span>{/if}
        </div>
        <div class="keys">
          {#if capturing === row.id}
            <span class="hint" data-testid="keyboard-capturing">{t('keyboardPage.capturing')}</span>
          {:else if nowLabel}
            <kbd data-testid="keyboard-key">{nowLabel}</kbd>
          {:else}
            <span class="none" data-testid="keyboard-key">{t('keyboardPage.none')}</span>
          {/if}
          {#if defaultLabel && row.changed}
            <span class="meta" data-testid="keyboard-default">{t('keyboardPage.columnDefault')}: <kbd>{defaultLabel}</kbd></span>
          {/if}
        </div>
        <div class="row-actions">
          {#if !row.unused}
            <button
              type="button"
              class="action"
              data-testid="keyboard-capture"
              disabled={$keyState.readOnly}
              onclick={() => startCapture(row.id)}
            >
              {t('keyboardPage.capture')}
            </button>
            {#if row.keyNow}
              <button type="button" class="action" data-testid="keyboard-clear" disabled={$keyState.readOnly} onclick={() => clearKey(row.id)}>
                {t('keyboardPage.clear')}
              </button>
            {/if}
          {/if}
          <button
            type="button"
            class="action"
            data-testid="keyboard-reset"
            disabled={!row.changed || $keyState.readOnly}
            onclick={() => resetKey(row.id)}
          >
            {t('keyboardPage.reset')}
          </button>
        </div>
        {#if row.role === 'lost'}
          <p class="note warn" data-testid="keyboard-lost">{t('keyboardPage.lostKey', { winner: row.with.map(nameOf).join(', ') })}</p>
        {:else if row.role === 'hold'}
          <p class="note warn" data-testid="keyboard-hold">{t('keyboardPage.onHold')}</p>
        {/if}
        {#if row.notice}
          <p class="note" data-testid="keyboard-notice" data-notice={row.notice}>{t(`keyboardPage.notice.${row.notice}`)}</p>
        {/if}
        {#if refused?.id === row.id}
          <p class="note warn" data-testid="keyboard-refused">{refused.text}</p>
        {/if}
      </li>
    {/each}
  </ul>
  {#if shown.length === 0}
    <p class="meta" data-testid="keyboard-empty">{t('keyboardPage.empty')}</p>
  {/if}
</section>

<style>
  .keyboard {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  h3,
  h4 {
    margin: 0;
  }

  h4 {
    font-size: 13px;
    font-weight: 600;
  }

  .form-help,
  .meta,
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .notice {
    margin: 0;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--danger-text);
    font-size: 12px;
  }

  .problems,
  .conflicts ul {
    margin: 0;
    padding: 0 0 0 16px;
    color: var(--danger-text);
    font-size: 12px;
  }

  .conflicts {
    padding: 6px 8px;
    border: 1px solid var(--danger-text);
    border-radius: 3px;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    font-size: 12px;
  }

  .search {
    flex: 1 1 160px;
    min-width: 0;
    padding: 4px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
  }

  .search:focus {
    border-color: var(--accent-text);
    outline: none;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 46vh;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
    padding: 3px 6px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    font-size: 13px;
  }

  .row.changed {
    border-left: 3px solid var(--accent-text);
  }

  .row.conflict {
    border-color: var(--danger-text);
  }

  .name {
    display: flex;
    flex: 1 1 200px;
    flex-wrap: wrap;
    gap: 2px 8px;
    align-items: baseline;
    min-width: 0;
    color: var(--text-main);
  }

  .keys {
    display: flex;
    flex: 0 1 220px;
    flex-wrap: wrap;
    gap: 2px 8px;
    align-items: baseline;
  }

  .row-actions {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
  }

  .mark {
    padding: 0 5px;
    border: 1px solid var(--accent-text);
    border-radius: 8px;
    color: var(--accent-text);
    font-size: 11px;
  }

  .mark.warn {
    border-color: var(--danger-text);
    color: var(--danger-text);
  }

  .note {
    flex: 1 1 100%;
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .note.warn {
    color: var(--danger-text);
  }

  kbd {
    padding: 1px 5px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    white-space: nowrap;
  }

  .none {
    color: var(--text-disabled);
  }

  .action {
    padding: 3px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-ribbon);
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
  }

  .action:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .action:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
</style>
