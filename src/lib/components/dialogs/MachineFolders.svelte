<!--
  The Folders section of a machine on Settings ▸ Machines (Phase 4 plan 6.8.4, P4.30a).

  A programmer lists the folders whose programs a machine runs (its DNC folder); a program
  saved in one of them uses that machine unless the program has a machine of its own. The
  rules (longest folder wins, two machines on one folder choose nothing, nothing is read from
  the folder) are `core/machines/folderRules.ts`; this section only edits the list.

  Every change is written at once, like the other buttons of a row of the list (default,
  remove): the section sits in the list, not in the machine form, so it needs no Save. While
  the machines file cannot be written (`disabled`) nothing here writes. A list written by hand
  that cannot be used is shown with its problems and kept in the file until the user starts
  the list again.
-->
<script module lang="ts">
  import {
    MAX_FOLDER_CHARS,
    MAX_FOLDERS,
    folderConflicts,
    foldersOf,
    normalizeFolderPath,
    platformIsCaseInsensitive,
    type FolderRuleProblem,
  } from '$lib/core/machines/folderRules';
  import { wasReported, type MachineConfig, type MachineFolder } from '$lib/core/machines/types';
  import type { MachineService, StatusService, Translate } from '$lib/app/types';

  /** What the section needs from the outside world, so every action is testable with a fake. */
  export interface FolderDeps {
    machines: Pick<MachineService, 'get' | 'update' | 'blocked'>;
    status: Pick<StatusService, 'show'>;
    t: Translate;
    /** The picker of the system; null when there is none (a plain browser). */
    pickFolder?: (o: { title: string }) => Promise<string | null>;
    caseInsensitive?: boolean;
  }

  /** What the section shows for one machine. */
  export interface FolderView {
    /** The valid folders (none when the stored list cannot be used). */
    folders: MachineFolder[];
    /** Problems of the stored list, each with its JSON path. */
    problems: FolderRuleProblem[];
    /** Folders this machine shares with another one, worded for the page. */
    conflicts: string[];
  }

  /** The section's content for `machineId` among `all` (file order). */
  export function folderView(machineId: string, all: readonly MachineConfig[], caseInsensitive: boolean): FolderView {
    const at = all.findIndex((m) => m.id === machineId);
    if (at < 0) return { folders: [], problems: [], conflicts: [] };
    const read = foldersOf(all[at], `machines[${at}]`);
    const conflicts = read.folders.length === 0 ? [] : folderConflicts(all, { caseInsensitive });
    return {
      folders: read.folders,
      problems: read.problems,
      conflicts: conflicts.filter((problem) => problem.machineIds?.includes(machineId)).map((problem) => problem.message),
    };
  }

  /** The one write of every action: the whole list in place of the old one (none left = no member). */
  async function write(machineId: string, next: MachineFolder[], deps: FolderDeps): Promise<boolean> {
    if (deps.machines.blocked()) {
      deps.status.show(deps.t('machineFolders.blocked'), { error: true });
      return false;
    }
    try {
      await deps.machines.update(machineId, { folders: next.length === 0 ? undefined : next });
    } catch (err) {
      if (!wasReported(err)) {
        deps.status.show(deps.t('machineFolders.saveFailed'), {
          error: true,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      return false;
    }
    return true;
  }

  /**
   * The machine's usable list, or null (with a sentence) when the stored list is broken: every
   * action would write a list made from nothing over the user's own entries, so the user starts
   * the list again first ("Start the list again").
   */
  function usableList(machine: MachineConfig, deps: FolderDeps): MachineFolder[] | null {
    const read = foldersOf(machine, '');
    if (read.problems.length === 0) return read.folders;
    deps.status.show(deps.t('machineFolders.brokenList'), { error: true });
    return null;
  }

  /** Adds a typed or picked folder. Refuses (and says why) what the rule would not read. */
  export async function addFolder(machineId: string, text: string, deps: FolderDeps): Promise<boolean> {
    const machine = deps.machines.get(machineId);
    if (machine === undefined) return false;
    const path = text.trim();
    const ci = deps.caseInsensitive ?? platformIsCaseInsensitive();
    const current = usableList(machine, deps);
    if (current === null) return false;
    if (path.length > MAX_FOLDER_CHARS) {
      deps.status.show(deps.t('machineFolders.tooLong', { max: MAX_FOLDER_CHARS }), { error: true });
      return false;
    }
    const key = normalizeFolderPath(path, ci);
    if (key === null) {
      deps.status.show(deps.t('machineFolders.notAbsolute'), { error: true });
      return false;
    }
    if (current.length >= MAX_FOLDERS) {
      deps.status.show(deps.t('machineFolders.tooMany', { max: MAX_FOLDERS }), { error: true });
      return false;
    }
    if (current.some((folder) => normalizeFolderPath(folder.path, ci) === key)) {
      deps.status.show(deps.t('machineFolders.already'), { error: true });
      return false;
    }
    return write(machineId, [...current, { path }], deps);
  }

  /** "Choose folder…": the system's picker, then the same checks as typing. */
  export async function pickAndAdd(machineId: string, deps: FolderDeps): Promise<boolean> {
    if (deps.pickFolder === undefined) return false;
    const picked = await deps.pickFolder({ title: deps.t('machineFolders.pickTitle') });
    return picked === null ? false : addFolder(machineId, picked, deps);
  }

  export async function removeFolder(machineId: string, index: number, deps: FolderDeps): Promise<boolean> {
    const machine = deps.machines.get(machineId);
    if (machine === undefined) return false;
    const current = usableList(machine, deps);
    if (current === null || index < 0 || index >= current.length) return false;
    return write(machineId, current.filter((_, k) => k !== index), deps);
  }

  export async function setSubfolders(machineId: string, index: number, on: boolean, deps: FolderDeps): Promise<boolean> {
    const machine = deps.machines.get(machineId);
    if (machine === undefined) return false;
    const current = usableList(machine, deps);
    if (current === null || index < 0 || index >= current.length) return false;
    return write(
      machineId,
      current.map((folder, k) => (k === index ? { path: folder.path, ...(on ? {} : { subfolders: false }) } : folder)),
      deps,
    );
  }

  /** "Start the list again" for a stored list that cannot be used: the member is removed. */
  export async function clearFolders(machineId: string, deps: FolderDeps): Promise<boolean> {
    return write(machineId, [], deps);
  }
</script>

<script lang="ts">
  import { dialogs } from '$lib/app/dialogs';
  import { status } from '$lib/app/status';
  import { machines } from '$lib/stores/machines';
  import { t } from '$lib/i18n';

  interface Props {
    machineId: string;
    /** True while the machines file cannot be written. */
    disabled?: boolean;
  }

  let { machineId, disabled = false }: Props = $props();

  const list = machines.list;
  const view = $derived(folderView(machineId, $list, platformIsCaseInsensitive()));
  const deps: FolderDeps = {
    machines,
    status,
    t,
    pickFolder: (o) => dialogs.pickFolder(o),
  };

  let typed = $state('');
  let busy = $state(false);

  async function run(action: () => Promise<boolean>): Promise<boolean> {
    if (busy || disabled) return false;
    busy = true;
    try {
      return await action();
    } finally {
      busy = false;
    }
  }

  async function add(): Promise<void> {
    if (await run(() => addFolder(machineId, typed, deps))) typed = '';
  }
</script>

<details class="folders" data-testid="machine-folders" data-machine-id={machineId} data-count={view.folders.length}>
  <summary class="summary">{t('machineFolders.title', { count: view.folders.length })}</summary>
  <p class="note">{t('machineFolders.intro')}</p>
  <p class="note" data-testid="folder-help">{t('machineFolders.help')}</p>

  {#if view.problems.length > 0}
    <div class="broken" data-testid="folder-problems">
      <p class="broken-title">{t('machineFolders.brokenTitle')}</p>
      <ul class="problem-list">
        {#each view.problems as problem, k (k)}
          <li class="problem">{problem.path}: {problem.message}</li>
        {/each}
      </ul>
      <button
        type="button"
        class="action"
        data-testid="folder-action"
        data-action="start-again"
        disabled={disabled || busy}
        onclick={() => void run(() => clearFolders(machineId, deps))}>{t('machineFolders.startAgain')}</button
      >
    </div>
  {:else}
    {#if view.folders.length === 0}
      <p class="note" data-testid="folder-empty">{t('machineFolders.empty')}</p>
    {:else}
      <ul class="rows">
        {#each view.folders as folder, index (index)}
          <li class="folder" data-testid="folder-row" data-path={folder.path}>
            <span class="path">{folder.path}</span>
            <label class="check">
              <input
                type="checkbox"
                data-testid="folder-subfolders"
                checked={folder.subfolders !== false}
                disabled={disabled || busy}
                onchange={(event) => void run(() => setSubfolders(machineId, index, event.currentTarget.checked, deps))}
              />
              {t('machineFolders.subfolders')}
            </label>
            <button
              type="button"
              class="action"
              data-testid="folder-action"
              data-action="remove"
              title={t('machineFolders.removeTip')}
              disabled={disabled || busy}
              onclick={() => void run(() => removeFolder(machineId, index, deps))}>{t('machineFolders.remove')}</button
            >
          </li>
        {/each}
      </ul>
    {/if}
    {#each view.conflicts as message, k (k)}
      <p class="problem" data-testid="folder-conflict">{t('machineFolders.conflict')}: {message}</p>
    {/each}
    <div class="add">
      <input
        class="control"
        type="text"
        data-testid="folder-add-path"
        aria-label={t('machineFolders.pathLabel')}
        placeholder={t('machineFolders.pathPlaceholder')}
        bind:value={typed}
        disabled={disabled || busy}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void add();
          }
        }}
      />
      <button
        type="button"
        class="action"
        data-testid="folder-action"
        data-action="add"
        disabled={disabled || busy || typed.trim() === ''}
        onclick={() => void add()}>{t('machineFolders.add')}</button
      >
      <button
        type="button"
        class="action"
        data-testid="folder-action"
        data-action="pick"
        disabled={disabled || busy}
        onclick={() => void run(() => pickAndAdd(machineId, deps))}>{t('machineFolders.pick')}</button
      >
    </div>
  {/if}
</details>

<style>
  .folders {
    flex: 1 1 100%;
    margin: 4px 0 0;
    color: var(--text-main);
    font-size: 12px;
  }
  .summary {
    cursor: pointer;
    color: var(--text-muted);
  }
  .note {
    margin: 4px 0;
    color: var(--text-muted);
    font-size: 12px;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 4px 0;
    padding: 0;
    list-style: none;
  }
  .folder {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .path {
    flex: 1 1 240px;
    overflow-wrap: anywhere;
    font-family: var(--font-mono, monospace);
  }
  .check {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    white-space: nowrap;
  }
  .add {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin-top: 6px;
  }
  .control {
    box-sizing: border-box;
    flex: 1 1 240px;
    padding: 4px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
  }
  .control:focus {
    border-color: var(--accent-text);
    outline: none;
  }
  .broken {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
    margin-top: 4px;
    padding: 6px 8px;
    border: 1px solid var(--danger-text);
    border-radius: 3px;
    background: var(--danger-surface);
  }
  .broken-title {
    margin: 0;
    font-weight: 600;
  }
  .problem-list {
    margin: 0;
    padding: 0 0 0 14px;
  }
  .problem {
    margin: 2px 0;
    color: var(--danger-text);
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
    opacity: 0.5;
    cursor: default;
  }
</style>
