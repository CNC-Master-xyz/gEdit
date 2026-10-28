<!--
  The machine form's table "Numbers" (Phase 4 plan §6.10 rule 12; P4.43a): how this machine
  reads a number of each kind (length, angle, feed per minute, feed per revolution, dwell).

  The page owns the draft: it passes the rows (`numberRows` of the machine's whole number input,
  `core/machines/numberForm.ts`) and takes every change from `onChange`, and on Save it writes
  `numberInputFromRows` as the machine's whole `numberInput`. Each row is the app's one form
  engine, `FormRenderer`: a reading to choose, the increment, and for the kinds that follow the
  program's units the increment of an inch program. The problems come from the check of the
  machines file (`numberRowProblems`) and show at their row; a problem of the rules as a whole
  shows under the table. Rendered inline, never a nested modal (the Settings dialog is the open
  modal).
-->
<script module lang="ts">
  import { NUMBER_FORM_READINGS, followsUnits, problemClass, sameDecimal, type NumberClassRow } from '$lib/core/machines/numberForm';
  import type { MachineProblem, NumberClass, NumberReading } from '$lib/core/machines/types';
  import type { FieldSpec } from '$lib/core/forms/types';
  import type { Msg } from '$lib/app/types';
  import { t } from '$lib/i18n';

  /** The field ids of one row: `<class>.mode`, `<class>.increment`, `<class>.incrementInch`. */
  export const fieldIdOf = (cls: NumberClass, member: 'mode' | 'increment' | 'incrementInch'): string => `${cls}.${member}`;

  /** The fields of one row, labelled in plain words, units beside the increments. */
  export function numberFieldsOf(row: NumberClassRow): FieldSpec[] {
    const fields: FieldSpec[] = [
      {
        id: fieldIdOf(row.cls, 'mode'),
        type: 'choice',
        label: t('machineNumbers.readingLabel'),
        choices: NUMBER_FORM_READINGS.map((reading) => ({ label: t(`machineNumbers.reading.${reading}`), value: reading })),
        default: row.mode,
      },
      {
        id: fieldIdOf(row.cls, 'increment'),
        type: 'text',
        label: t('machineNumbers.increment'),
        help: t(row.cls === 'length' ? 'machineNumbers.incrementHelpLength' : 'machineNumbers.incrementHelp'),
        unit: t(`machineNumbers.unit.${row.cls}`),
        default: row.increment,
      },
    ];
    if (followsUnits(row.cls)) {
      fields.push({
        id: fieldIdOf(row.cls, 'incrementInch'),
        type: 'text',
        label: t('machineNumbers.incrementInch'),
        help: t(row.cls === 'length' ? 'machineNumbers.inchEmpty' : 'machineNumbers.inchFeed'),
        unit: t(`machineNumbers.unitInch.${row.cls}`),
        default: row.incrementInch ?? '',
      });
    }
    return fields;
  }

  /** The values `FormRenderer` shows for one row. */
  export function numberValuesOf(row: NumberClassRow): Record<string, unknown> {
    return {
      [fieldIdOf(row.cls, 'mode')]: row.mode,
      [fieldIdOf(row.cls, 'increment')]: row.increment,
      ...(followsUnits(row.cls) ? { [fieldIdOf(row.cls, 'incrementInch')]: row.incrementInch ?? '' } : {}),
    };
  }

  /**
   * The row after the field `id` changed to `value`. An emptied inch field means "the reader's own
   * inch step". A new metric step clears the inch step beside it (NC-5): the old one belonged to
   * the old metric step, and the page asks for the new one before the row can be saved.
   */
  export function changedRow(row: NumberClassRow, id: string, value: unknown): NumberClassRow {
    const text = typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value);
    if (id === fieldIdOf(row.cls, 'mode')) {
      return NUMBER_FORM_READINGS.includes(text as NumberReading) ? { ...row, mode: text as NumberReading } : row;
    }
    if (id === fieldIdOf(row.cls, 'increment')) {
      const same = sameDecimal(row.increment, text);
      return { ...row, increment: text, incrementInch: same ? row.incrementInch : null };
    }
    if (id === fieldIdOf(row.cls, 'incrementInch') && followsUnits(row.cls)) return { ...row, incrementInch: text === '' ? null : text };
    return row;
  }

  /**
   * The problems at their fields (`FormRenderer` errors by field id) and the ones of the rules
   * as a whole, under the table. `path` is where the page checks the number input.
   */
  export function numberErrors(problems: readonly MachineProblem[], path: string): { byField: Record<string, Msg>; general: string[] } {
    const byField: Record<string, Msg> = {};
    const general: string[] = [];
    for (const problem of problems) {
      const cls = problemClass(problem, path);
      const member = cls === null ? '' : problem.path.slice(`${path}.classes.${cls}`.length + 1);
      const field = cls !== null && (member === 'mode' || member === 'increment' || member === 'incrementInch') ? fieldIdOf(cls, member) : null;
      if (field !== null && byField[field] === undefined) byField[field] = { key: 'machineNumbers.problem', params: { message: problem.message } };
      else if (field === null) general.push(problem.message);
    }
    return { byField, general };
  }
</script>

<script lang="ts">
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';

  interface Props {
    /** The five rows (`numberRows`), in the table's order. */
    rows: readonly NumberClassRow[];
    onChange: (rows: NumberClassRow[]) => void;
    /** `numberRowProblems` of the rows, under `path`. */
    problems?: readonly MachineProblem[];
    path?: string;
    /** The machine's id, empty while adding. */
    machineId?: string;
    /** The rules match no number input of the list, so the choice above shows "Custom". */
    custom?: boolean;
    /** Pass true while the machines file cannot be written. */
    disabled?: boolean;
  }

  let { rows, onChange, problems = [], path = 'params.numberInput', machineId = '', custom = false, disabled = false }: Props = $props();

  const errors = $derived(numberErrors(problems, path));

  function change(cls: NumberClass, id: string, value: unknown): void {
    if (disabled) return;
    onChange(rows.map((row) => (row.cls === cls ? changedRow(row, id, value) : row)));
  }
</script>

<div class="numbers" data-testid="machine-number-form" data-machine={machineId} aria-disabled={disabled ? 'true' : undefined}>
  <h3 class="title">{t('machineNumbers.title')}</h3>
  <p class="note">{t('machineNumbers.note')}</p>
  {#if custom}
    <p class="note" data-testid="machine-number-custom">{t('machineNumbers.custom')}</p>
  {/if}

  {#each rows as row (row.cls)}
    <section
      class="row"
      data-testid="machine-number-row"
      data-class={row.cls}
      data-mode={row.mode}
      data-from-base={row.fromBase ? 'true' : 'false'}
    >
      <h4 class="kind">
        {t(`machineNumbers.class.${row.cls}`)}
        {#if !row.fromBase}<span class="own">{t('machineNumbers.ownRule')}</span>{/if}
      </h4>
      <div class="grid">
        <FormRenderer
          fields={numberFieldsOf(row)}
          values={numberValuesOf(row)}
          errors={errors.byField}
          idPrefix={`numbers-${row.cls}-`}
          onChange={(id, value) => change(row.cls, id, value)}
        />
      </div>
    </section>
  {/each}

  {#if errors.general.length > 0}
    <div class="broken" data-testid="machine-number-problems">
      <p class="broken-title">{t('machineNumbers.problemsTitle')}</p>
      <ul class="problem-list">
        {#each errors.general as problem, k (k)}
          <li>{problem}</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .numbers {
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: var(--text-main);
    font-size: 13px;
  }

  .title {
    margin: 0;
    font-size: 14px;
  }

  .note {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .row {
    padding-top: 6px;
    border-top: 1px solid var(--border-color);
  }

  .kind {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin: 0 0 4px;
    font-size: 13px;
    font-weight: 600;
  }

  .own {
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 400;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    column-gap: 12px;
  }

  .broken {
    padding: 6px 8px;
    border: 1px solid var(--danger-text);
    border-radius: 3px;
    background: var(--danger-surface);
  }

  .broken-title {
    margin: 0;
    color: var(--danger-text);
    font-weight: 600;
  }

  .problem-list {
    margin: 0;
    padding: 0 0 0 14px;
    color: var(--danger-text);
    font-size: 12px;
  }
</style>
