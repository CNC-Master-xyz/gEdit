<!--
  The page "Motion and limits" of the machine form (plan §6.4 rule 4, AD-46). Owner: P4.8.

  The user is an NC programmer, not a software engineer, so the page is plain: the unit
  choice first (mm or inch), then fields with their units in the label, every one optional
  and empty by default, and a note that every value comes from the machine's documentation
  and that gEdit assumes none (Q4-10). The two peck values say they only prefill the
  expansion and statistics forms.

  The component edits a flat `values` record and nothing else: the page owns the draft,
  passes `values` and takes each change from `onChange`. The record is read from and turned
  back into the two stored blocks by `core/machines/motion.ts` (`motionToValues`,
  `blocksFromValues`, `blockIssues`), so there is no machine-shaped control here, only the
  app's one form engine, `FormRenderer`. It renders inline, never a nested modal: the
  Settings dialog is itself the open modal (`app/modals.ts`).

  A block from a hand edit that cannot be used is listed with its problems (`problems`, each
  with its JSON path, already worded by the page) and is kept in the file until a field is
  changed or "Start this page again" is pressed. Axis letters and the field order come from
  the dialect's own `addresses.axes`; a rotary axis (`addresses.angular`) is in degrees.
-->
<script module lang="ts">
  import { MV, blockIssues, type AxisSets } from '$lib/core/machines/motion';
  import type { FieldSpec } from '$lib/core/forms/types';
  import type { Msg } from '$lib/app/types';
  import { t } from '$lib/i18n';

  /** The fields of one group of the page. The labels carry the unit of the units currently chosen. */
  export interface MotionFieldGroups {
    units: FieldSpec[];
    rapid: FieldSpec[];
    motion: FieldSpec[];
    spindle: FieldSpec[];
    travel: FieldSpec[];
  }

  const num = (id: string, label: string, help?: string): FieldSpec => ({ id, type: 'number', label, ...(help === undefined ? {} : { help }) });

  /**
   * The page's fields for the units now chosen in `values`: `mm/min` or `inch/min` in a
   * rate's label, `degrees/min` for a rotary axis, "chosen unit" while none is picked.
   */
  export function motionFieldGroups(values: Record<string, unknown>, o: AxisSets & { diameter?: readonly string[] }): MotionFieldGroups {
    const units = values[MV.units];
    const length = units === 'mm' ? 'mm' : units === 'inch' ? 'inch' : t('machines.motion.chosenUnit');
    const rate = units === 'mm' || units === 'inch' ? `${units}/min` : t('machines.motion.perMinute');
    const rotaryRate = t('machines.motion.degreesPerMinute');
    const degrees = t('machines.motion.degrees');
    const rotary = (axis: string): boolean => o.angular.includes(axis);
    return {
      units: [
        {
          id: MV.units,
          type: 'choice',
          label: t('machines.motion.units'),
          help: t('machines.motion.unitsHelp'),
          choices: [
            { label: t('machines.motion.unitsNotSet'), value: '' },
            { label: t('machines.motion.unitMm'), value: 'mm' },
            { label: t('machines.motion.unitInch'), value: 'inch' },
          ],
          default: '',
        },
      ],
      rapid: o.axes.map((axis) => num(MV.rapid(axis), t('machines.motion.rapid', { axis, unit: rotary(axis) ? rotaryRate : rate }))),
      motion: [
        {
          id: MV.rapidKind,
          type: 'choice',
          label: t('machines.motion.rapidKind'),
          help: t('machines.motion.rapidKindHelp'),
          choices: [
            { label: t('machines.motion.kindNotSet'), value: '' },
            { label: t('machines.motion.kindStraight'), value: 'straight' },
            { label: t('machines.motion.kindPerAxis'), value: 'per-axis' },
          ],
          default: '',
        },
        num(MV.maxFeed, t('machines.motion.maxFeed', { unit: rate }), t('machines.motion.maxFeedHelp')),
        num(MV.toolChange, t('machines.motion.toolChange')),
        num(MV.peckRetract, t('machines.motion.peckRetract', { unit: length }), t('machines.motion.peckHelp')),
        num(MV.peckClearance, t('machines.motion.peckClearance', { unit: length }), t('machines.motion.peckHelp')),
      ],
      spindle: [
        num(MV.spindleMain, t('machines.motion.spindleMain'), t('machines.motion.spindleMainHelp')),
        { id: MV.spindleOthers, type: 'text', label: t('machines.motion.spindleOthers'), help: t('machines.motion.spindleOthersHelp'), default: '' },
      ],
      travel: o.axes.flatMap((axis) => {
        const unit = rotary(axis) ? degrees : length;
        // A lathe's X is written as a diameter and the travel check compares it as one.
        if (!rotary(axis) && (o.diameter ?? []).includes(axis)) {
          const help = t('machines.motion.travelDiameterHelp', { axis });
          return [
            num(MV.travelMin(axis), t('machines.motion.travelMinDiameter', { axis, unit }), help),
            num(MV.travelMax(axis), t('machines.motion.travelMaxDiameter', { axis, unit }), help),
          ];
        }
        return [
          num(MV.travelMin(axis), t('machines.motion.travelMin', { axis, unit })),
          num(MV.travelMax(axis), t('machines.motion.travelMax', { axis, unit })),
        ];
      }),
    };
  }

  /** The messages of `blockIssues` in the shape `FormRenderer` shows. */
  export function motionErrors(values: Record<string, unknown>, o: AxisSets): Record<string, Msg> {
    return blockIssues(values, o);
  }
</script>

<script lang="ts">
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';

  interface Props {
    /** One entry per field id (`motionToValues`). */
    values: Record<string, unknown>;
    onChange: (id: string, value: unknown) => void;
    /** The dialect's `addresses.axes` and `addresses.angular`. */
    axes: readonly string[];
    angular?: readonly string[];
    /** The dialect's `addresses.diameter`: the axes written as diameters (a lathe's `X`); their travel is a diameter. */
    diameter?: readonly string[];
    /** Problems of the stored blocks, already worded with their JSON paths; empty for a usable or missing block. */
    problems?: readonly string[];
    /** "Start this page again": clears every field; shown beside the problems. */
    onStartAgain?: () => void;
    /** Pass true while the machines file cannot be written. */
    disabled?: boolean;
  }

  let { values, onChange, axes, angular = [], diameter = [], problems = [], onStartAgain, disabled = false }: Props = $props();

  const sets = $derived({ axes, angular, diameter });
  const groups = $derived(motionFieldGroups(values, sets));
  const errors = $derived(motionErrors(values, sets));
  const change = (id: string, value: unknown): void => {
    if (!disabled) onChange(id, value);
  };
</script>

<div class="motion" data-testid="machine-motion-form" aria-disabled={disabled ? 'true' : undefined}>
  <h3 class="title">{t('machines.motion.title')}</h3>
  <p class="note" data-testid="motion-note">{t('machines.motion.note')}</p>

  {#if problems.length > 0}
    <div class="broken" data-testid="motion-problems">
      <p class="broken-title">{t('machines.motion.problemsTitle')}</p>
      <ul class="problem-list">
        {#each problems as problem, k (k)}
          <li class="problem">{problem}</li>
        {/each}
      </ul>
      <p class="note">{t('machines.motion.problemsHelp')}</p>
      {#if onStartAgain}
        <button type="button" class="action" data-testid="motion-start-again" {disabled} onclick={onStartAgain}>{t('machines.motion.startAgain')}</button>
      {/if}
    </div>
  {/if}

  <div class="group" data-testid="motion-units">
    <FormRenderer fields={groups.units} {values} {errors} onChange={change} idPrefix="motion-" />
  </div>

  <section class="group" data-testid="motion-section" data-section="motion">
    <h4 class="section">{t('machines.motion.motionTitle')}</h4>
    <h5 class="sub">{t('machines.motion.rapidTitle')}</h5>
    <div class="grid" data-testid="motion-rapid">
      <FormRenderer fields={groups.rapid} {values} {errors} onChange={change} idPrefix="motion-" />
    </div>
    <FormRenderer fields={groups.motion} {values} {errors} onChange={change} idPrefix="motion-" />
  </section>

  <section class="group" data-testid="motion-section" data-section="limits">
    <h4 class="section">{t('machines.motion.limitsTitle')}</h4>
    <h5 class="sub">{t('machines.motion.spindleTitle')}</h5>
    <FormRenderer fields={groups.spindle} {values} {errors} onChange={change} idPrefix="motion-" />
    <h5 class="sub">{t('machines.motion.travelTitle')}</h5>
    <div class="grid" data-testid="motion-travel">
      <FormRenderer fields={groups.travel} {values} {errors} onChange={change} idPrefix="motion-" />
    </div>
  </section>
</div>

<style>
  .motion {
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

  .section {
    margin: 4px 0 0;
    padding-top: 8px;
    border-top: 1px solid var(--border-color);
    font-size: 13px;
    font-weight: 600;
  }

  .sub {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
  }

  .note {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    column-gap: 12px;
  }

  .broken {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
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

  .problem {
    margin: 0;
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
