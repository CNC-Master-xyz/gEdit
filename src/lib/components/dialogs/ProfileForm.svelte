<!--
  The profile form (Phase 4 plan §6.10 rule 7; AD-57; P4.40): the fields of one profile file,
  generated from `schemas/profile.schema.json` by `app/profileForm.ts`, with the live preview
  beside them. This is the body; `ProfileFormDialog.svelte` puts it in a dialog (the palette
  command) and the Profiles page hosts it inline (the Settings dialog is the open modal, and a
  modal cannot open over it).

  What it keeps to:

   1. **The file's members, not the resolved profile.** A field shows what the file writes; where
      the file writes none and the profile extends another, the parent's value is shown beside it,
      and "Use the parent's value" takes the member out of the file again.
   2. **A problem sits at its field.** The model checks the draft as the registry would at load;
      Save stays off while one is open (and while a colour is too pale to read).
   3. **Nothing is lost silently.** A built-in profile is shown read-only. Names, patterns and
      every value are data and shown as text, never as markup.
   4. **Members the form cannot make plain stay as written**: they are shown as JSON, with "Open
      as JSON" next to them.
-->
<script module lang="ts">
  import type { ProfileFormField, ProfileFormSection } from '$lib/app/profileForm';

  /** The fields of a section that are shown at once, and the ones behind "More". */
  export function splitAdvanced(section: ProfileFormSection): { basic: ProfileFormField[]; more: ProfileFormField[] } {
    return { basic: section.fields.filter((f) => !f.advanced), more: section.fields.filter((f) => f.advanced) };
  }

  /** A section whose only field is the member itself (`name`, `grammar`): shown without a heading of its own. */
  export function isScalarSection(section: ProfileFormSection): boolean {
    return section.fields.length === 1 && section.fields[0].path === section.id;
  }

  /** The value a `<select>` shows for a choice field: the file's value as text, or '' when the file writes none. */
  export function choiceValue(field: ProfileFormField): string {
    return field.own === undefined ? '' : String(field.own);
  }

  /** The value a choice field writes for the text selected; '' is "not set". */
  export function choiceFrom(field: ProfileFormField, selected: string): unknown {
    if (selected === '') return undefined;
    return field.numericChoices === true && /^-?\d+$/.test(selected) ? Number(selected) : selected;
  }

  /** What a table cell writes for the text typed. */
  export function cellFrom(column: ProfileFormField, typed: string): unknown {
    if (column.kind === 'number' || column.kind === 'integer') return typed.trim() === '' || Number.isNaN(Number(typed)) ? 0 : Number(typed);
    if (column.nullable === true && typed === '') return null;
    return typed;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import RoleColorRows from '$lib/components/dialogs/RoleColorRows.svelte';
  import ProfilePreview from '$lib/components/dialogs/ProfilePreview.svelte';
  import { effectiveTheme } from '$lib/app/theme';
  import {
    PATTERN_GROUPS,
    blankRow,
    colorsOf,
    describeValue,
    listText,
    longestBlock,
    withRuler,
    parseList,
    parseWeights,
    patternAnswer,
    weightsText,
    type ProfileFormModel,
  } from '$lib/app/profileForm';
  import { settings } from '$lib/stores/settings';
  import { t } from '$lib/i18n';
  import type { Msg } from '$lib/app/types';
  import type { ProfileColors } from '$lib/core/profiles/types';

  interface Props {
    model: ProfileFormModel;
    /** Shows Save and Cancel under the form. The dialog has its own footer and turns this off. */
    buttons?: boolean;
    /** Save and Cancel are done (inline host): leave the form. */
    onclose?: () => void;
    /** "Open as JSON": the file in its own tab. */
    onopenjson?: () => void;
    /** "Duplicate as a user profile" (a built-in profile). */
    onduplicate?: () => void;
  }

  let { model, buttons = true, onclose, onopenjson, onduplicate }: Props = $props();

  // The model is made by the opener and does not change while the dialog is open.
  // svelte-ignore state_referenced_locally
  const ms = model.state;
  const words = (msg: Msg): string => t(msg.key, msg.params);

  /** Text typed into a list or table field, kept while it cannot be written yet. */
  let drafts = $state<Record<string, { text: string; bad: number | null }>>({});
  /** Sections whose "More" is open. */
  let opened = $state<Record<string, boolean>>({});

  const userColors = $derived<ProfileColors>(settings.get('appearance.roleColors'));

  function typedList(path: string, itemKind: 'text' | 'integer', text: string): void {
    const parsed = parseList(text, itemKind);
    drafts = { ...drafts, [path]: { text, bad: parsed.ok ? null : parsed.line } };
    if (parsed.ok) model.set(path, parsed.value);
  }

  function typedWeights(path: string, text: string): void {
    const parsed = parseWeights(text);
    drafts = { ...drafts, [path]: { text, bad: parsed.ok ? null : parsed.line } };
    if (parsed.ok) model.set(path, parsed.value);
  }

  function leaveField(path: string): void {
    const { [path]: _gone, ...rest } = drafts;
    drafts = rest;
  }

  function typedNumber(path: string, typed: string): void {
    if (typed.trim() === '') model.set(path, undefined);
    else if (!Number.isNaN(Number(typed))) model.set(path, Number(typed));
  }

  function setRow(path: string, rows: unknown[], index: number, column: string, value: unknown): void {
    const next = rows.map((row, i) => (i === index && typeof row === 'object' && row !== null ? { ...row, [column]: value } : row));
    model.set(path, next);
  }

  const rowsOf = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);

  const cellText = (row: Record<string, unknown>, column: string): string => {
    const value = row[column];
    return value === null || value === undefined ? '' : String(value);
  };

  /** The form's own answer to Save: the model writes through the file's document. */
  async function save(): Promise<void> {
    if (await model.save()) onclose?.();
  }

  async function cancel(): Promise<void> {
    if (await model.leave()) onclose?.();
  }
</script>

<div
  class="form"
  data-testid="profile-form"
  data-profile={$ms.id}
  data-readonly={$ms.readOnly ? 'true' : 'false'}
  data-dirty={$ms.dirty ? 'true' : 'false'}
>
  {#if $ms.refusal !== null}
    <p class="refusal" data-testid="profile-form-refusal">{words($ms.refusal)}</p>
  {:else if $ms.open}
    <div class="head">
      <span class="id">{$ms.fileName ?? $ms.id}</span>
      {#if $ms.parent !== null}<span class="meta">{t('userConfig.page.extends', { parent: $ms.parent })}</span>{/if}
    </div>
    {#if $ms.readOnly}
      <p class="note" data-testid="profile-form-readonly">{t('profileForm.readOnlyNote')}</p>
      {#if onduplicate}
        <p><button type="button" class="action" data-testid="profile-form-duplicate" onclick={onduplicate}>{t('profileForm.duplicate')}</button></p>
      {/if}
    {/if}
    {#if $ms.message !== null}
      <p class={$ms.message.error ? 'refusal' : 'note'} data-testid="profile-form-message">{words($ms.message.msg)}</p>
    {/if}
    {#if $ms.loose.length > 0}
      <ul class="loose" data-testid="profile-form-problems">
        {#each $ms.loose as line, k (k)}<li>{line}</li>{/each}
      </ul>
    {/if}

    <div class="columns">
      <div class="sections">
        {#each $ms.sections as section (section.id)}
          {@const scalar = isScalarSection(section)}
          {@const split = splitAdvanced(section)}
          <section class="section" data-testid="profile-form-section" data-section={section.id}>
            {#if !scalar}
              <h3 class="section-title">{section.title}</h3>
              {#if section.help !== ''}<p class="help">{section.help}</p>{/if}
            {/if}
            {#each split.basic as field (field.path)}{@render fieldView(field)}{/each}
            {#if split.more.length > 0}
              <button type="button" class="more" data-testid="profile-form-more" aria-expanded={opened[section.id] === true} onclick={() => (opened = { ...opened, [section.id]: opened[section.id] !== true })}>
                {opened[section.id] === true ? t('profileForm.less') : t('profileForm.more', { count: split.more.length })}
              </button>
              {#if opened[section.id] === true}
                {#each split.more as field (field.path)}{@render fieldView(field)}{/each}
              {/if}
            {/if}
          </section>
        {/each}
      </div>
      <div class="side">
        <ProfilePreview profile={$ms.preview} problem={$ms.previewProblem} />
      </div>
    </div>

  {:else}
    <p class="note">{t('profileForm.loading')}</p>
  {/if}
  {#if buttons}
    <div class="actions">
      <button
        type="button"
        class="action primary"
        data-testid="profile-form-save"
        disabled={!$ms.open || $ms.readOnly || !$ms.canSave || !$ms.dirty || $ms.busy}
        onclick={() => void save()}>{t('profileForm.save')}</button
      >
      <button type="button" class="action" data-testid="profile-form-cancel" onclick={() => void cancel()}>{t('profileForm.cancel')}</button>
    </div>
  {/if}
</div>

{#snippet fieldView(field: ProfileFormField)}
  {@const problems = $ms.problems[field.path] ?? []}
  {@const draft = drafts[field.path]}
  <div
    class="field"
    class:bad={problems.length > 0}
    data-testid="profile-form-field"
    data-path={field.path}
    data-kind={field.kind}
    data-inherited={field.own === undefined ? 'true' : 'false'}
    data-problem={problems[0] ?? ''}
  >
    <div class="label-row">
      <span class="label">{field.title}</span>
      {#if field.own !== undefined && !field.readOnly}
        <button type="button" class="link" data-testid="profile-form-use-parent" onclick={() => model.reset(field.path)}>
          {$ms.parent !== null ? t('profileForm.useParent') : t('profileForm.leaveOut')}
        </button>
      {/if}
    </div>
    {#if field.help !== ''}<p class="help">{field.help}</p>{/if}

    {#if field.kind === 'text' || field.kind === 'pattern'}
      {@const answer = field.kind === 'pattern' && typeof field.own === 'string' && field.own !== '' ? patternAnswer(field.own, PATTERN_GROUPS[field.path]) : null}
      <input
        type="text"
        aria-label={field.title}
        class:mono={field.kind === 'pattern'}
        value={typeof field.own === 'string' ? field.own : ''}
        placeholder={field.inherited === undefined ? '' : describeValue(field.inherited)}
        disabled={field.readOnly}
        oninput={(e) => model.set(field.path, e.currentTarget.value === '' ? undefined : e.currentTarget.value)}
      />
      {#if answer !== null}
        <p class={answer.ok ? 'tester ok' : 'tester'} data-testid="profile-form-pattern">{answer.ok ? t('profileForm.pattern.ok') : answer.reason}</p>
      {/if}
    {:else if field.kind === 'integer' || field.kind === 'number'}
      <input
        type="number"
        aria-label={field.title}
        min={field.min}
        max={field.max}
        step={field.kind === 'integer' ? 1 : 'any'}
        value={typeof field.own === 'number' ? field.own : ''}
        placeholder={field.inherited === undefined ? '' : describeValue(field.inherited)}
        disabled={field.readOnly}
        oninput={(e) => typedNumber(field.path, e.currentTarget.value)}
      />
    {:else if field.kind === 'bool'}
      <select
        aria-label={field.title}
        value={field.own === undefined ? '' : String(field.own)}
        disabled={field.readOnly}
        onchange={(e) => model.set(field.path, e.currentTarget.value === '' ? undefined : e.currentTarget.value === 'true')}
      >
        <option value="">{field.inherited === undefined ? t('profileForm.notSet') : t('profileForm.inherited', { parent: $ms.parent ?? '', value: describeValue(field.inherited) })}</option>
        <option value="true">{t('profileForm.yes')}</option>
        <option value="false">{t('profileForm.no')}</option>
      </select>
    {:else if field.kind === 'choice'}
      <select
        aria-label={field.title}
        value={choiceValue(field)}
        disabled={field.readOnly}
        onchange={(e) => model.set(field.path, choiceFrom(field, e.currentTarget.value))}
      >
        <option value="">{field.inherited === undefined ? t('profileForm.notSet') : t('profileForm.inherited', { parent: $ms.parent ?? '', value: describeValue(field.inherited) })}</option>
        {#each field.choices ?? [] as choice (choice)}<option value={choice}>{choice}</option>{/each}
      </select>
    {:else if field.kind === 'text-list' || field.kind === 'pattern-list'}
      <textarea
        aria-label={field.title}
        rows={Math.min(8, Math.max(2, (Array.isArray(field.own) ? field.own.length : 1) + 1))}
        class:mono={field.kind === 'pattern-list'}
        placeholder={field.inherited === undefined ? t('profileForm.listHint') : describeValue(field.inherited)}
        disabled={field.readOnly}
        value={draft?.text ?? listText(field.own)}
        oninput={(e) => typedList(field.path, field.itemKind ?? 'text', e.currentTarget.value)}
        onblur={() => leaveField(field.path)}
      ></textarea>
      {#if draft?.bad != null}<p class="tester">{t('profileForm.badLine', { line: draft.bad })}</p>{/if}
      {#if field.path === 'editing.rulers' && !field.readOnly}
        {@const longest = longestBlock($ms.file, $ms.preview)}
        {@const withIt = longest === null ? null : withRuler(field.own ?? field.inherited, longest)}
        {#if longest !== null && withIt !== null}
          <button
            type="button"
            class="link"
            data-testid="profile-form-ruler-longest"
            data-column={longest}
            onclick={() => {
              model.set(field.path, withIt);
              leaveField(field.path);
            }}>{t('profileForm.rulerAtLongest', { count: longest })}</button
          >
        {/if}
      {/if}
      {#if field.kind === 'pattern-list' && Array.isArray(field.own)}
        {#each field.own as entry, k (k)}
          {@const answer = typeof entry === 'string' ? patternAnswer(entry, PATTERN_GROUPS[field.path]) : null}
          {#if answer !== null && !answer.ok}<p class="tester" data-testid="profile-form-pattern">{t('profileForm.pattern.entry', { line: k + 1, reason: answer.reason })}</p>{/if}
        {/each}
      {/if}
    {:else if field.kind === 'weights'}
      <textarea
        aria-label={field.title}
        rows={Math.min(6, Math.max(2, Object.keys((field.own as object | undefined) ?? {}).length + 1))}
        placeholder={field.inherited === undefined ? t('profileForm.weightsHint') : describeValue(field.inherited)}
        disabled={field.readOnly}
        value={draft?.text ?? weightsText(field.own)}
        oninput={(e) => typedWeights(field.path, e.currentTarget.value)}
        onblur={() => leaveField(field.path)}
      ></textarea>
      {#if draft?.bad != null}<p class="tester">{t('profileForm.badLine', { line: draft.bad })}</p>{/if}
    {:else if field.kind === 'rows'}
      {@const rows = rowsOf(field.own)}
      <table class="rows">
        <thead>
          <tr>
            {#each field.columns ?? [] as column (column.path)}<th>{column.title}</th>{/each}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row, i (i)}
            <tr data-testid="profile-form-row">
              {#each field.columns ?? [] as column (column.path)}
                <td>
                  {#if column.kind === 'choice'}
                    <select
                      value={cellText(row, column.path)}
                      disabled={field.readOnly}
                      aria-label={column.title}
                      onchange={(e) => setRow(field.path, rows, i, column.path, e.currentTarget.value)}
                    >
                      {#each column.choices ?? [] as choice (choice)}<option value={choice}>{choice}</option>{/each}
                    </select>
                  {:else}
                    <input
                      type={column.kind === 'number' || column.kind === 'integer' ? 'number' : 'text'}
                      class:mono={column.kind === 'pattern'}
                      value={cellText(row, column.path)}
                      disabled={field.readOnly}
                      aria-label={column.title}
                      oninput={(e) => setRow(field.path, rows, i, column.path, cellFrom(column, e.currentTarget.value))}
                    />
                  {/if}
                </td>
              {/each}
              <td>
                {#if !field.readOnly}
                  <button type="button" class="link" data-testid="profile-form-row-remove" onclick={() => model.set(field.path, rows.filter((_, k) => k !== i))}>{t('profileForm.removeRow')}</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if field.own === undefined && field.inherited !== undefined}
        <p class="inherited">{t('profileForm.inherited', { parent: $ms.parent ?? '', value: describeValue(field.inherited) })}</p>
      {/if}
      {#if !field.readOnly && (field.maxItems === undefined || rows.length < field.maxItems)}
        <button type="button" class="link" data-testid="profile-form-row-add" onclick={() => model.set(field.path, [...rows, blankRow(field.columns ?? [])])}>{t('profileForm.addRow')}</button>
      {/if}
    {:else if field.kind === 'colors' && !field.readOnly}
      <RoleColorRows
        layer="profile"
        below={userColors}
        heading={false}
        firstMode={$effectiveTheme}
        colors={colorsOf($ms.file)}
        onchange={(next) => model.set('colors', Object.keys(next).length === 0 ? undefined : next)}
        onvalid={(valid) => model.setColorsValid(valid)}
      />
    {:else}
      <pre class="json" data-testid="profile-form-json">{JSON.stringify(field.own ?? field.inherited ?? null, null, 2)}</pre>
      <p class="help">{t('profileForm.jsonNote')}</p>
      {#if onopenjson && !$ms.readOnly}
        <button type="button" class="link" data-testid="profile-form-open-json" onclick={onopenjson}>{t('profileForm.openJson')}</button>
      {/if}
    {/if}

    {#if field.own === undefined && field.inherited !== undefined && field.kind !== 'rows' && field.kind !== 'bool' && field.kind !== 'choice' && field.kind !== 'json'}
      <p class="inherited" data-testid="profile-form-inherited">{t('profileForm.inherited', { parent: $ms.parent ?? '', value: describeValue(field.inherited) })}</p>
    {/if}
    {#each problems as problem, k (k)}<p class="problem" data-testid="profile-form-problem">{problem}</p>{/each}
  </div>
{/snippet}

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .head {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }

  .id {
    font-family: var(--font-mono, monospace);
    font-size: 13px;
  }

  .meta,
  .help,
  .note,
  .inherited {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .refusal,
  .problem,
  .tester {
    margin: 0;
    color: var(--danger-text);
    font-size: 12px;
  }

  .tester.ok {
    color: var(--text-muted);
  }

  .loose {
    margin: 0;
    padding: 0 0 0 16px;
    color: var(--danger-text);
    font-size: 12px;
  }

  .columns {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 16px;
    align-items: start;
  }

  .side {
    position: sticky;
    top: 0;
  }

  .sections {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-title {
    margin: 4px 0 0;
    font-size: 13px;
    font-weight: 600;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 4px 6px;
    border: 1px solid transparent;
    border-radius: 3px;
  }

  .field.bad {
    border-color: var(--danger-text);
  }

  .label-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    justify-content: space-between;
  }

  .label {
    color: var(--text-main);
    font-size: 13px;
  }

  input,
  select,
  textarea {
    min-width: 0;
    padding: 3px 6px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
  }

  .mono {
    font-family: var(--font-mono, monospace);
  }

  textarea {
    resize: vertical;
  }

  .rows {
    width: 100%;
    border-collapse: collapse;
  }

  .rows th {
    padding: 2px 4px;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 400;
    text-align: left;
  }

  .rows td {
    padding: 2px 4px;
  }

  .rows td input,
  .rows td select {
    width: 100%;
    box-sizing: border-box;
  }

  .json {
    margin: 0;
    padding: 6px;
    max-height: 160px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    font-size: 12px;
    overflow: auto;
  }

  .link,
  .more {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .actions {
    display: flex;
    gap: 6px;
  }

  .action {
    padding: 4px 12px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-ribbon);
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .action:disabled {
    color: var(--text-disabled);
    cursor: default;
  }

  .action.primary:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--text-on-accent);
  }
</style>
