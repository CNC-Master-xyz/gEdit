<!--
  Settings ▸ Packages (Phase 4 plan §6.9 rules 7–15, AD-56). Owner: P4.35.

  The script packages in `<config>/packages`: one row each, with the name from its
  `package.json`, the counts of its scripts, profiles and code files, whether it is switched on
  and what is wrong with it. Rules this page keeps:

   1. **A switch acts at once.** The page saves `packages.disabled`, then rescans the scripts and
      loads the profiles and code files again, so no restart is needed (rule 12). The dialog's
      own Save does not hold it back.
   2. **A folder that cannot be used is a row, not a missing one**: a link, a bad name, the 33rd
      folder are listed with the reason (rule 8).
   3. **No installer** (rule 15): the page shows where to copy a package to, and nothing more.
   4. **Names are data** and stay as they are; everything around them is translated.
   5. **A list is bounded**: at most 32 packages, and a row lists at most [`MAX_ROW_LINES`] lines.
-->
<script module lang="ts">
  import { isPackageDisabled, withPackageEnabled } from '$lib/core/packages/packages';
  import type { ProfileProblem } from '$lib/core/profiles/types';
  import type { PackageInfo, PackageList } from '$lib/platform/commands';
  import type { StatusService, Translate } from '$lib/app/types';

  /** What the page needs from the outside world, so every action is testable with a fake. */
  export interface PackagesDeps {
    /** `packages_list`. */
    list(): Promise<PackageList>;
    /** The value of `packages.disabled` now. */
    disabled(): string[];
    /** Writes `packages.disabled` (`settings.save`). */
    saveDisabled(names: string[]): Promise<void>;
    /** `scripts.rescan()`. */
    rescan(): Promise<void>;
    /** `userConfig.load()`. */
    load(): Promise<unknown>;
    status: Pick<StatusService, 'show'>;
    t: Translate;
  }

  /** The most problems one row lists. */
  export const MAX_ROW_LINES = 20;

  /** One row of the list. */
  export interface PackageRow {
    name: string;
    title: string;
    version: string;
    description: string;
    enabled: boolean;
    scripts: number;
    profiles: number;
    codes: number;
    /** Why the folder is not a usable package; null when it is one. */
    error: string | null;
    /** The manifest's problems and notes, bounded. */
    lines: string[];
  }

  /** The rows of a listing, in the order Rust gave them (by folder name). */
  export function rowsOf(list: PackageList, t: Translate): PackageRow[] {
    return list.packages.map((info: PackageInfo) => ({
      name: info.name,
      title: info.title === '' ? info.name : info.title,
      version: info.version,
      description: info.description,
      enabled: info.enabled,
      scripts: info.scripts,
      profiles: info.profiles,
      codes: info.codes,
      error: info.error,
      lines:
        info.problems.length <= MAX_ROW_LINES
          ? info.problems
          : [...info.problems.slice(0, MAX_ROW_LINES), t('userConfig.load.more', { count: info.problems.length - MAX_ROW_LINES })],
    }));
  }

  /** The problems and notes of the last load that belong to a package, one line each. */
  export function loadLines(problems: readonly ProfileProblem[], t: Translate): string[] {
    const lines = problems
      .filter((p) => p.package !== undefined)
      .map((p) => {
        const where = t('packagesPage.problemFile', { package: p.package ?? '', file: p.file ?? '' });
        return `${where}${p.path === '' ? '' : ` (${p.path})`}: ${p.message}`;
      });
    return lines.length <= MAX_ROW_LINES * 2
      ? lines
      : [...lines.slice(0, MAX_ROW_LINES * 2), t('userConfig.load.more', { count: lines.length - MAX_ROW_LINES * 2 })];
  }

  /** The detail of an error, for the status line. */
  function detailOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Switches package `name` on or off (rule 12): saves the setting, rescans the scripts and loads
   * the profiles and code files again. False, with a message, when the setting could not be
   * saved (nothing else is done then). The reload runs even when the rescan fails.
   */
  export async function switchPackage(name: string, enabled: boolean, deps: PackagesDeps): Promise<boolean> {
    const before = deps.disabled();
    if (isPackageDisabled(before, name) === !enabled) return true;
    try {
      await deps.saveDisabled(withPackageEnabled(before, name, enabled));
    } catch (error) {
      deps.status.show(deps.t('packagesPage.switchFailed', { name }), { error: true, detail: detailOf(error) });
      return false;
    }
    await followSwitch(deps);
    deps.status.show(deps.t(enabled ? 'packagesPage.switchedOn' : 'packagesPage.switchedOffStatus', { name }));
    return true;
  }

  /** Rescans the scripts and loads the files again; each step on its own, so one failing does not skip the other. */
  async function followSwitch(deps: PackagesDeps): Promise<void> {
    for (const step of [deps.rescan, deps.load]) {
      try {
        await step();
      } catch (error) {
        console.error('A package change could not be followed', error);
      }
    }
  }

  /** The "Reload" button: the same two steps, for a folder that was copied in or changed. */
  export async function reloadPackages(deps: PackagesDeps): Promise<void> {
    await followSwitch(deps);
    deps.status.show(deps.t('packagesPage.reloaded'));
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { scripts } from '$lib/app/scripts';
  import { status } from '$lib/app/status';
  import { userConfig } from '$lib/app/userConfig';
  import { packagesList } from '$lib/platform/commands';
  import { settings } from '$lib/stores/settings';
  import { isTauriRuntime } from '$lib/utils/platform';
  import { t } from '$lib/i18n';

  const deps: PackagesDeps = {
    list: packagesList,
    disabled: () => settings.get('packages.disabled'),
    saveDisabled: (names) => settings.save({ 'packages.disabled': names }),
    rescan: () => scripts.rescan(),
    load: () => userConfig.load(),
    status,
    t,
  };

  const loadProblems = userConfig.problems;

  /** `initial` is the list to show before the first read answers; a test hands one over. */
  let { initial = null }: { initial?: PackageList | null } = $props();

  // svelte-ignore state_referenced_locally
  let listing = $state<PackageList | null>(initial);
  let unreadable = $state<string | null>(null);
  let busy = $state(false);

  const rows = $derived(listing === null ? [] : rowsOf(listing, t));
  const notes = $derived(loadLines($loadProblems, t));

  async function refresh(): Promise<void> {
    if (!isTauriRuntime()) return;
    try {
      listing = await deps.list();
      unreadable = null;
    } catch (error) {
      unreadable = detailOf(error);
    }
  }

  async function work(action: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await action();
    } finally {
      await refresh();
      busy = false;
    }
  }

  onMount(() => {
    void refresh();
  });
</script>

<section class="packages" data-testid="settings-packages" aria-label={t('packagesPage.title')}>
  <h3>{t('packagesPage.title')}</h3>
  <p class="help">{t('packagesPage.intro')}</p>
  <p class="help" data-testid="packages-trust">{t('packagesPage.trust')}</p>

  {#if listing !== null}
    <p class="help folder">
      {t('packagesPage.folder')} <span class="mono" data-testid="packages-folder">{listing.folder}</span>
    </p>
  {/if}

  <div class="actions">
    <button
      type="button"
      class="action"
      data-testid="package-reload"
      disabled={busy}
      onclick={() => void work(() => reloadPackages(deps))}>{t('packagesPage.reload')}</button
    >
  </div>

  {#if unreadable !== null}
    <p class="notice">{t('packagesPage.unreadable', { detail: unreadable })}</p>
  {:else if listing === null}
    <p class="help">{t('packagesPage.loading')}</p>
  {:else if rows.length === 0}
    <p class="help">{t('packagesPage.none')}</p>
  {/if}

  {#if listing !== null && listing.problems.length > 0}
    <ul class="problems">
      {#each listing.problems as problem, k (k)}<li>{problem}</li>{/each}
    </ul>
  {/if}

  <ul class="list">
    {#each rows as row (row.name)}
      <li
        class="row"
        class:broken={row.error !== null}
        data-testid="package-row"
        data-package={row.name}
        data-enabled={row.enabled ? '1' : '0'}
      >
        <label class="switch">
          <input
            type="checkbox"
            data-testid="package-toggle"
            checked={row.enabled}
            disabled={busy || row.error !== null}
            aria-label={t('packagesPage.switchLabel', { name: row.title })}
            onchange={(event) => void work(() => switchPackage(row.name, event.currentTarget.checked, deps))}
          />
          <span class="name">{row.title}</span>
        </label>
        <span class="meta">{row.enabled ? t('packagesPage.on') : t('packagesPage.off')}</span>
        {#if row.version !== ''}<span class="meta">{t('packagesPage.version', { version: row.version })}</span>{/if}
        {#if row.title !== row.name}<span class="meta mono">{t('packagesPage.folderName', { name: row.name })}</span>{/if}
        {#if row.description !== ''}<p class="description line">{row.description}</p>{/if}
        {#if row.error !== null}
          <p class="problem line">{t('packagesPage.notUsable', { reason: row.error })}</p>
        {:else if !row.enabled}
          <p class="meta line">{t('packagesPage.switchedOff')}</p>
        {:else}
          <p class="meta line">{t('packagesPage.counts', { scripts: row.scripts, profiles: row.profiles, codes: row.codes })}</p>
        {/if}
        {#if row.lines.length > 0}
          <ul class="notes line" data-testid="package-notes">
            {#each row.lines as line, k (k)}<li>{line}</li>{/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>

  {#if notes.length > 0}
    <h4 class="section">{t('packagesPage.loadProblems')}</h4>
    <ul class="notes" data-testid="package-load-problems">
      {#each notes as line, k (k)}<li>{line}</li>{/each}
    </ul>
  {/if}
</section>

<style>
  .packages {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  h3,
  .section {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }

  .help,
  .meta {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .mono {
    font-family: var(--font-mono, monospace);
    word-break: break-all;
  }

  .notice,
  .problem {
    margin: 0;
    color: var(--danger-text);
    font-size: 12px;
  }

  .list,
  .problems,
  .notes {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .problems,
  .notes {
    padding-left: 14px;
    font-size: 12px;
  }
  .problems {
    color: var(--danger-text);
  }
  .notes {
    color: var(--text-muted);
    list-style: disc;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 8px;
    align-items: center;
    padding: 4px 6px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
  }
  .row.broken {
    border-color: var(--danger-text);
  }
  .row > .line {
    flex: 1 1 100%;
  }

  .switch {
    display: flex;
    flex: 1 1 auto;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }

  .name {
    overflow: hidden;
    color: var(--text-main);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .description {
    margin: 0;
    color: var(--text-main);
    font-size: 12px;
  }

  .actions {
    display: flex;
    gap: 4px;
  }

  .action {
    padding: 3px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-ribbon);
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
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
