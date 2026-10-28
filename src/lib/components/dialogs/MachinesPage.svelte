<!--
  Settings ▸ Machines (plan §7.15, AD-31 "Management"). Owner: WP6.10.

  A page of its own rather than a group of settings keys because machine configurations are
  records, not settings: `pagesOf` only builds pages from `SETTING_FIELDS` (F47), and no
  machine data lives in `settings.json` (D50).

  Four rules this page exists to keep:

   1. **While the machines file could not be read, nothing may be written.** Every write
      action is disabled and only "Open machines file" and "Replace with an empty file" are
      offered, so a broken hand edit is never overwritten behind the user's back (AD-31).
   2. **A record the form cannot express is kept.** Number rules written by hand that match
      no preset show as "Custom" and survive an edit of the name; so does anything a later
      version adds (`core/machines/fields.ts`). P4h (plan §6.10 rule 12): the table
      "Numbers" (`MachineNumberForm.svelte`) shows those rules per kind of number and edits
      them; a rule set that is not edited is saved as it was.
   3. **Nothing is corrected in silence.** Switching the G-code system re-offers the
      power-on codes of the database that system actually uses, and a code the new system
      does not have is dropped **with a message saying so**.
   4. **The form is the app's one form engine.** `FormRenderer` over a generated
      `FieldSpec[]` (F46, §7.5), with no machine-shaped control anywhere.

  Why the form is rendered *in the page* rather than through `modals.form`: the settings
  dialog is itself the open modal, and `app/modals.ts` allows one at a time — a nested
  `modals.form()` resolves `undefined` instead of opening. §7.15 offers `FormRenderer` as
  the other half of that sentence, and rendering here buys the thing a one-shot dialog
  could not do at all: the fields follow the variant while the user edits it.

  Machine names, dialect names, preset labels and code labels are data and are not
  translated (AD-14).
-->
<script module lang="ts">
  import {
    CUSTOM_PRESET,
    FIELD_NAME,
    FIELD_NUMBER_INPUT,
    FIELD_POINTLESS_FEEDS,
    pointlessFeedsIdOf,
    presetIdOf,
    withPointlessFeeds,
    machineFields,
    machineFromValues,
    pruneModalValues,
    followVariantDefaults,
    variantIdOf,
    extraFieldErrors,
  } from '$lib/core/machines/fields';
  import { initialValues } from '$lib/core/forms/values';
  import { validateFields } from '$lib/core/forms/validate';
  import { channelBlock, MAX_NAME_LENGTH, validateChannels, validateMachine } from '$lib/core/machines/validate';
  import { positionOf } from '$lib/core/machines/file';
  import {
    blockIssues,
    blocksFromValues,
    limitsBlock,
    motionBlock,
    motionToValues,
    validateLimits,
    validateMotion,
    type AxisSets,
  } from '$lib/core/machines/motion';
  import { inputReadingAs, numberInputFromRows, numberRowProblems, numberRows, type NumberClassRow } from '$lib/core/machines/numberForm';
  import type { ChannelParams } from '$lib/core/channels/types';
  import type { CodeDb } from '$lib/core/codes/types';
  import type { FieldChoice, FieldSpec } from '$lib/core/forms/types';
  import {
    wasReported,
    type MachineConfig,
    type MachineLimits,
    type MachineMotion,
    type MachineParams,
    type MachineProblem,
    type NumberInput,
  } from '$lib/core/machines/types';
  import type {
    CodeDbService,
    DocumentStore,
    MachineService,
    Msg,
    NativeDialogs,
    ProfileRegistry,
    StatusService,
    Translate,
  } from '$lib/app/types';

  /** What the page needs from the outside world, so every action is testable with a fake. */
  export interface MachinesDeps {
    machines: MachineService;
    profiles: Pick<ProfileRegistry, 'list' | 'get' | 'profile'>;
    codes: Pick<CodeDbService, 'byId'>;
    docs: Pick<DocumentStore, 'all'>;
    dialogs: Pick<NativeDialogs, 'confirm'>;
    status: Pick<StatusService, 'show'>;
    t: Translate;
  }

  /** What the page tells the dialog around it: whether a machine form is open (B1 A4). */
  export interface MachinesModel {
    hasDraft: () => boolean;
  }

  /** One row of the list. An entry with problems is one the file kept but gEdit cannot use. */
  export interface MachineRow {
    id: string;
    /** The machine's own name, or its id while only its problems are known. */
    name: string;
    profileId: string;
    profileName: string;
    isDefault: boolean;
    /** Already formatted, one per problem of this record. */
    problems: string[];
    /** False for a record that failed validation: it is kept in the file, not editable here. */
    usable: boolean;
  }

  export type DraftKind = 'add' | 'edit' | 'duplicate';

  /** The machine being added or edited, as the form holds it. */
  export interface Draft {
    kind: DraftKind;
    /** The record being edited or duplicated; null while adding. */
    id: string | null;
    profileId: string;
    values: Record<string, unknown>;
    /**
     * The Channels step's block (M12). It is not a `FieldSpec` value: the step edits a block
     * of its own. `undefined` = "No channels". For "edit" it starts as the stored block, valid
     * or not (a broken one is listed and has to be fixed or removed before Save).
     */
    channels?: ChannelParams;
    /**
     * The "Motion and limits" page (P4.8, plan §6.4 rule 4): the page's values and whether the
     * user has changed anything of it. A block that is not touched is **never rewritten**: the
     * stored `params.motion` and `params.limits` go back to the file as they were, usable or
     * not, so a broken hand edit stays until the user changes it.
     */
    motion?: MotionDraft;
    /**
     * P4h (plan §6.10 rule 12): the table "Numbers" once the user changed a row of it: the
     * number input the rows started from and the rows. Absent, the number input is what the
     * preset choice (or the stored record) gives, and it is saved as it was.
     */
    numbers?: NumberDraft;
  }

  /** The table "Numbers" of a draft (P4.43a). */
  export interface NumberDraft {
    base: NumberInput;
    rows: NumberClassRow[];
  }

  /** The Motion and limits page of a draft. */
  export interface MotionDraft {
    values: Record<string, unknown>;
    touched: boolean;
  }

  /** The field of the first Add step: which dialect this machine runs. */
  export const FIELD_PROFILE = 'profile';

  const problemText = (deps: MachinesDeps, problem: MachineProblem): string =>
    deps.t('machines.page.problem', { path: problem.path, message: problem.message });

  /** The dialects a machine can be built for: the ones that declare machine parameters. */
  export function profileChoices(deps: MachinesDeps): FieldChoice[] {
    return deps.profiles
      .list()
      .filter((info) => info.hasMachineParams)
      // Dialect names are data.
      .map((info) => ({ label: info.name, value: info.id }));
  }

  export function profileField(deps: MachinesDeps): FieldSpec[] {
    const choices = profileChoices(deps);
    return [
      {
        id: FIELD_PROFILE,
        type: 'choice',
        label: deps.t('machines.param.profile'),
        help: deps.t('machines.param.profileHelp'),
        required: true,
        choices,
        default: choices[0]?.value,
      },
    ];
  }

  /**
   * The JSON path of a record **in the file**: the list shown is sorted by name, so its
   * index is not the line the user would open (`positionOf`, as `validateMachine` does).
   * `index` is the fallback for a record that was added in this session.
   */
  function pathOfRecord(machine: MachineConfig, index: number): string {
    return `machines[${positionOf(machine) ?? index}]`;
  }

  /**
   * A stored `channels` block that cannot be used (X12 d): the machine stays usable, only its
   * channels are off, and each problem is listed with its JSON path.
   */
  export function channelProblemsOf(machine: MachineConfig, index: number, deps: MachinesDeps): string[] {
    const waitLetters = deps.profiles.profile(machine.profile)?.machineParams?.channels?.waitLetters;
    const block = channelBlock(machine, pathOfRecord(machine, index), { waitLetters });
    return block.state === 'invalid' ? block.problems.map((p) => problemText(deps, p)) : [];
  }

  /** What stops the Channels step from being saved: the block's problems, in plain words. */
  export function channelErrors(draft: Draft, deps: MachinesDeps): string[] {
    if (draft.channels === undefined || draft.kind === 'duplicate') return [];
    const waitLetters = deps.profiles.profile(draft.profileId)?.machineParams?.channels?.waitLetters;
    return validateChannels(draft.channels, 'channels', null, { waitLetters }).map((p) => problemText(deps, p));
  }

  /** The dialect's axis letters and which of them are rotary: what a rate or a travel may name. */
  export function axesOf(profileId: string, deps: MachinesDeps): AxisSets & { diameter: readonly string[] } {
    const addresses = deps.profiles.profile(profileId)?.addresses;
    return { axes: addresses?.axes ?? [], angular: addresses?.angular ?? [], diameter: addresses?.diameter ?? [] };
  }

  /**
   * Stored `motion` or `limits` blocks that cannot be used (plan §6.4 rule 3): the machine
   * stays usable and its other parameters stay in use, only the block is off, and each
   * problem is listed with its JSON path.
   */
  export function motionProblemsOf(machine: MachineConfig, index: number, deps: MachinesDeps): string[] {
    const sets = axesOf(machine.profile, deps);
    const path = pathOfRecord(machine, index);
    const motion = motionBlock(machine, path, sets);
    const limits = limitsBlock(machine, path, sets);
    return [
      ...(motion.state === 'invalid' ? motion.problems : []),
      ...(limits.state === 'invalid' ? limits.problems : []),
    ].map((p) => problemText(deps, p));
  }

  /** What stops the Motion and limits page from being saved: only a page the user has changed is checked. */
  export function motionErrors(draft: Draft, deps: MachinesDeps): string[] {
    if (draft.motion === undefined || !draft.motion.touched || draft.kind === 'duplicate') return [];
    const sets = axesOf(draft.profileId, deps);
    const fields = Object.keys(blockIssues(draft.motion.values, sets));
    if (fields.length > 0) return fields;
    // The field messages are the validators' own rules; this is the belt for anything they do not name.
    const made = blocksFromValues(draft.motion.values, sets);
    return [
      ...(made.motion === undefined ? [] : validateMotion(made.motion, 'motion', null, sets)),
      ...(made.limits === undefined ? [] : validateLimits(made.limits, 'limits', null, sets)),
    ].map((p) => p.path);
  }

  /** The Channels step is offered for dialects that declare `machineParams.channels`. */
  export function hasChannelsStep(draft: Draft, deps: MachinesDeps): boolean {
    return draft.kind !== 'duplicate' && deps.profiles.profile(draft.profileId).machineParams?.channels !== undefined;
  }

  /**
   * The block is safe to hand to the form: the shape the form reads. Anything else (a stored
   * block that is not even a list of channels) is only listed, with a way to remove it.
   */
  export function formReadable(block: unknown): block is ChannelParams {
    if (typeof block !== 'object' || block === null) return false;
    const b = block as Record<string, unknown>;
    const record = (x: unknown): boolean => typeof x === 'object' && x !== null && !Array.isArray(x);
    if (!Array.isArray(b.list) || !b.list.every(record)) return false;
    if (b.syncMarks === undefined) return true;
    return Array.isArray(b.syncMarks) && b.syncMarks.every((r) => record(r) && record((r as Record<string, unknown>).match) && record((r as Record<string, unknown>).partners));
  }

  /**
   * The rows: every usable record, then every record the file kept but gEdit could not
   * read. A problem that names no record belongs to the file itself and is shown above the
   * list instead (`fileProblems`).
   */
  export function rowsOf(list: readonly MachineConfig[], deps: MachinesDeps): MachineRow[] {
    const problems = deps.machines.problems();
    const rows: MachineRow[] = list.map((machine, index) => ({
      id: machine.id,
      name: machine.name,
      profileId: machine.profile,
      profileName: deps.profiles.get(machine.profile)?.name ?? machine.profile,
      isDefault: deps.machines.defaultFor(machine.profile) === machine.id,
      problems: [
        ...problems.filter((p) => p.machineId === machine.id).map((p) => problemText(deps, p)),
        ...channelProblemsOf(machine, index, deps),
        ...motionProblemsOf(machine, index, deps),
      ],
      usable: true,
    }));
    const known = new Set(rows.map((row) => row.id));
    for (const problem of problems) {
      const id = problem.machineId;
      if (id === null || known.has(id)) continue;
      const existing = rows.find((row) => row.id === id && !row.usable);
      if (existing) {
        existing.problems.push(problemText(deps, problem));
        continue;
      }
      rows.push({
        id,
        name: id,
        profileId: '',
        profileName: '',
        isDefault: false,
        problems: [problemText(deps, problem)],
        usable: false,
      });
    }
    return rows;
  }

  /** Problems of the file itself (a parse error, a version from the future). */
  export function fileProblems(deps: MachinesDeps): string[] {
    return deps.machines
      .problems()
      .filter((problem) => problem.machineId === null)
      .map((problem) => problemText(deps, problem));
  }

  /**
   * The code database the form's power-on codes come from: the one the **chosen** variant
   * names, exactly as `applyMachine` picks it. A system-B machine is offered `G94`/`G95`
   * as feed modes, a system-A machine `G98`/`G99` — offering both would let a machine
   * power up in a mode no code of its own database can produce.
   */
  export function codeDbFor(
    profileId: string,
    params: Partial<MachineParams> | undefined,
    deps: MachinesDeps,
  ): CodeDb {
    const profile = deps.profiles.profile(profileId);
    let dialect = typeof profile.codes === 'string' ? profile.codes : '';
    for (const variant of profile.machineParams?.variants ?? []) {
      const value = params?.variants?.[variant.id] ?? variant.default;
      const choice = (variant.choices ?? []).find((entry) => entry.value === value);
      if (typeof choice?.codes === 'string' && choice.codes !== '') dialect = choice.codes;
    }
    return deps.codes.byId(dialect);
  }

  /** The record a draft edits, or undefined while adding. */
  export function currentOf(draft: Draft, deps: MachinesDeps): MachineConfig | undefined {
    return draft.kind === 'edit' && draft.id !== null ? deps.machines.get(draft.id) : undefined;
  }

  /** Where the page checks the table's number input (the problems name this path). */
  export const NUMBERS_PATH = 'params.numberInput';

  /** The number input the table starts from: the chosen preset with its point-less feeds, or the stored rules. */
  export function numberBaseOf(draft: Draft, deps: MachinesDeps): NumberInput | null {
    const decl = deps.profiles.profile(draft.profileId).machineParams;
    if (decl?.numberInput === undefined || draft.kind === 'duplicate') return null;
    const input = machineFromValues(decl, draft.values, currentOf(draft, deps)).params.numberInput;
    return input !== null && typeof input === 'object' && !Array.isArray(input) ? input : null;
  }

  /** The table's rows, or null when the dialect declares no number input. */
  export function numberRowsOf(draft: Draft, deps: MachinesDeps): NumberClassRow[] | null {
    if (draft.numbers !== undefined) return draft.numbers.rows;
    const base = numberBaseOf(draft, deps);
    return base === null ? null : numberRows(base);
  }

  /** The number input a changed table saves, or undefined while it is not changed. */
  export function editedNumberInput(draft: Draft): NumberInput | undefined {
    return draft.numbers === undefined ? undefined : numberInputFromRows(draft.numbers.base, draft.numbers.rows);
  }

  /** What stops the table from being saved (`numberInputProblems` of what it would save). */
  export function numberProblemsOf(draft: Draft): MachineProblem[] {
    if (draft.numbers === undefined || draft.kind === 'duplicate') return [];
    return numberRowProblems(draft.numbers.base, draft.numbers.rows, draft.id, NUMBERS_PATH);
  }

  /** The record a draft edits with the table's rules in it, so the preset choice can say "Custom". */
  function withEditedNumbers(current: MachineConfig | undefined, draft: Draft): MachineConfig | undefined {
    const edited = editedNumberInput(draft);
    if (edited === undefined) return current;
    const record: MachineConfig = current ?? { id: '', name: '', profile: draft.profileId, params: {} };
    return { ...record, params: { ...record.params, numberInput: edited } };
  }

  /**
   * The draft after a row of the table changed: the rows kept, and the preset choice (and its
   * point-less feeds) set to what the rules now amount to, "Custom" when no preset is them.
   */
  export function withNumberRows(draft: Draft, rows: NumberClassRow[], deps: MachinesDeps): Draft {
    const decl = deps.profiles.profile(draft.profileId).machineParams;
    // Rows that read exactly as a preset (with a point-less-feed choice) are that preset.
    const choices = [undefined, ...(decl?.numberInput?.pointlessFeeds?.choices ?? [])];
    const candidates = (decl?.numberInput?.presets ?? [])
      .filter((preset) => preset?.value !== null && typeof preset?.value === 'object')
      .flatMap((preset) => choices.map((choice) => withPointlessFeeds(preset.value, choice)));
    const preset = inputReadingAs(candidates, rows);
    const base = preset ?? draft.numbers?.base ?? numberBaseOf(draft, deps);
    if (base === null) return draft;
    // The rows stay as typed (CODE-10): `0.0010` reads as the preset's `0.001`, and replacing the
    // text under the cursor would eat the zero. The saved value is the preset's own either way.
    // Only the "own rule" marks are the preset's.
    const marks = preset === null ? null : numberRows(preset);
    const kept = marks === null ? rows : rows.map((row, i) => ({ ...row, fromBase: marks[i]?.fromBase ?? row.fromBase }));
    const next: Draft = { ...draft, numbers: { base, rows: kept } };
    const record = withEditedNumbers(currentOf(draft, deps), next);
    const values: Record<string, unknown> = { ...draft.values, [FIELD_NUMBER_INPUT]: presetIdOf(decl, record) };
    if (FIELD_POINTLESS_FEEDS in draft.values) values[FIELD_POINTLESS_FEEDS] = pointlessFeedsIdOf(decl, record);
    return { ...next, values };
  }

  /** The form of a draft, rebuilt from its own values, so a variant switch moves the fields. */
  export function fieldsFor(draft: Draft, deps: MachinesDeps): FieldSpec[] {
    const decl = deps.profiles.profile(draft.profileId).machineParams;
    if (decl === undefined) return [];
    const current = withEditedNumbers(currentOf(draft, deps), draft);
    if (draft.kind === 'duplicate') {
      return [
        {
          id: FIELD_NAME,
          type: 'text',
          label: deps.t('machines.param.name'),
          help: deps.t('machines.param.nameHelp'),
          required: true,
          maxLength: MAX_NAME_LENGTH,
          default: '',
        },
      ];
    }
    const { params } = machineFromValues(decl, draft.values, current);
    const words = deps.profiles.profile(draft.profileId).addresses?.diameter;
    return machineFields(decl, codeDbFor(draft.profileId, params, deps), current, words);
  }

  /** Every name in use, lower-cased, except the record itself. */
  export function takenNames(list: readonly MachineConfig[], selfId: string | null): Set<string> {
    return new Set(
      list.filter((machine) => machine.id !== selfId).map((machine) => machine.name.toLowerCase()),
    );
  }

  /** `validateFields` (which also holds the length limits), plus the rule a `FieldSpec` cannot carry: a name no other machine has (§7.15 name rules). */
  export function draftErrors(
    fields: readonly FieldSpec[],
    draft: Draft,
    list: readonly MachineConfig[],
  ): Record<string, Msg> {
    const errors = validateFields(fields as FieldSpec[], draft.values);
    const name = typeof draft.values[FIELD_NAME] === 'string' ? (draft.values[FIELD_NAME] as string).trim() : '';
    if (errors[FIELD_NAME] === undefined && name !== '') {
      if (takenNames(list, draft.kind === 'edit' ? draft.id : null).has(name.toLowerCase())) {
        errors[FIELD_NAME] = { key: 'machines.page.nameTaken' };
      }
    }
    return errors;
  }

  /**
   * P4h (§6.10 rules 13, 14; T123): the problems of the fields "Extra axes" and "Machine builder
   * codes", by field id: the record's own rules run on the machine the form describes, so a
   * name the profile already reads or a code gEdit knows is refused at its field before save.
   */
  export function extraErrorsOf(draft: Draft, deps: MachinesDeps): Record<string, Msg> {
    const profile = deps.profiles.profile(draft.profileId);
    const decl = profile.machineParams;
    if (draft.kind === 'duplicate' || decl === undefined || (decl.extraAxes === undefined && decl.builderCodes === undefined)) return {};
    const built = machineFromValues(decl, draft.values, currentOf(draft, deps));
    const candidate: MachineConfig = { id: draft.id ?? 'new-machine', name: built.name, profile: draft.profileId, params: built.params };
    const problems = validateMachine(candidate, { path: 'machine', profile, codes: codeDbFor(draft.profileId, built.params, deps) });
    return extraFieldErrors(decl, draft.values, problems);
  }

  /** The draft for "Add", once the dialect is known. */
  export function addDraft(profileId: string, deps: MachinesDeps): Draft {
    const values = initialValues(fieldsFor({ kind: 'add', id: null, profileId, values: {} }, deps));
    return { kind: 'add', id: null, profileId, values, motion: { values: motionToValues(undefined, undefined), touched: false } };
  }

  /** The draft for "Edit": the stored record, through the form's own defaults. */
  export function editDraft(machine: MachineConfig, deps: MachinesDeps): Draft {
    const draft: Draft = { kind: 'edit', id: machine.id, profileId: machine.profile, values: {} };
    const stored = machine.params?.channels;
    // A block without `syncMarks` is valid (no rules); the form works on a list.
    const channels =
      stored === undefined ? undefined : structuredClone(typeof stored === 'object' && stored !== null && !Array.isArray(stored) && stored.syncMarks === undefined ? { ...stored, syncMarks: [] } : stored);
    return {
      ...draft,
      values: initialValues(fieldsFor(draft, deps)),
      ...(channels === undefined ? {} : { channels }),
      motion: { values: motionToValues(machine.params?.motion, machine.params?.limits), touched: false },
    };
  }

  /** The draft for "Duplicate": one field, the new name. */
  export function duplicateDraft(machine: MachineConfig, deps: MachinesDeps): Draft {
    return {
      kind: 'duplicate',
      id: machine.id,
      profileId: machine.profile,
      values: { [FIELD_NAME]: deps.t('machines.page.duplicateName', { name: machine.name }) },
    };
  }

  /** English detail for anything thrown across the IPC boundary. */
  function detailOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  /**
   * Says a failure, unless the machines store has already said it: it shows its own message
   * with the detail, and a second one from the page was the same news twice (B1 A4).
   */
  function say(deps: MachinesDeps, key: string, err: unknown): void {
    if (wasReported(err)) return;
    deps.status.show(deps.t(key), { error: true, detail: detailOf(err) });
  }

  /** True when the write went through; the page keeps the form open otherwise. */
  export async function submitDraft(draft: Draft, deps: MachinesDeps): Promise<boolean> {
    if (deps.machines.blocked()) {
      deps.status.show(deps.t('machines.page.blockedAction'), { error: true });
      return false;
    }
    const decl = deps.profiles.profile(draft.profileId).machineParams;
    if (decl === undefined) return false;
    try {
      if (draft.kind === 'duplicate' && draft.id !== null) {
        const name = String(draft.values[FIELD_NAME] ?? '').trim();
        await deps.machines.duplicate(draft.id, name);
        deps.status.show(deps.t('machines.page.duplicated', { name }));
        return true;
      }
      if (channelErrors(draft, deps).length > 0) {
        deps.status.show(deps.t('machines.channels.problemsTitle'), { error: true });
        return false;
      }
      if (motionErrors(draft, deps).length > 0) {
        deps.status.show(deps.t('machines.motion.title'), { error: true });
        return false;
      }
      if (numberProblemsOf(draft).length > 0) {
        deps.status.show(deps.t('machineNumbers.problemsTitle'), { error: true });
        return false;
      }
      // P4h: an extra axes list the field cannot read would otherwise keep the stored one.
      const extra = Object.values(extraErrorsOf(draft, deps));
      if (extra.length > 0) {
        deps.status.show(deps.t(extra[0].key, extra[0].params), { error: true });
        return false;
      }
      const built = machineFromValues(decl, draft.values, currentOf(draft, deps), { channels: draft.channels });
      // P4h: a changed table "Numbers" is saved whole; one that was not changed leaves the rules as the choice gives them.
      const numbers = editedNumberInput(draft);
      if (numbers !== undefined) built.params.numberInput = numbers;
      // A page the user changed rewrites both blocks from its fields (an empty field removes
      // the member, an empty block the block); one that was not touched leaves them as stored.
      if (draft.motion?.touched === true) {
        const made = blocksFromValues(draft.motion.values, axesOf(draft.profileId, deps));
        if (made.motion === undefined) delete built.params.motion;
        else built.params.motion = made.motion as MachineMotion;
        if (made.limits === undefined) delete built.params.limits;
        else built.params.limits = made.limits as MachineLimits;
      }
      if (draft.kind === 'add') {
        await deps.machines.add({
          name: built.name,
          profile: draft.profileId,
          params: built.params,
          notes: built.notes,
        });
        deps.status.show(deps.t('machines.page.added', { name: built.name }));
        return true;
      }
      if (draft.kind === 'edit' && draft.id !== null) {
        await deps.machines.update(draft.id, {
          name: built.name,
          params: built.params,
          notes: built.notes,
        });
        deps.status.show(deps.t('machines.page.updated', { name: built.name }));
        return true;
      }
      // A draft that names no record and is not an "add" would write nothing; saying so is
      // better than reporting a save that never happened.
      return false;
    } catch (err) {
      say(deps, 'machines.page.saveFailed', err);
      return false;
    }
  }

  /** Open documents that use this machine; they fall back when it goes (AD-31). */
  export function usersOf(id: string, deps: MachinesDeps): number {
    return deps.docs.all().filter((doc) => doc.machineId === id).length;
  }

  export async function removeRow(row: MachineRow, deps: MachinesDeps): Promise<boolean> {
    if (deps.machines.blocked()) {
      deps.status.show(deps.t('machines.page.blockedAction'), { error: true });
      return false;
    }
    const count = usersOf(row.id, deps);
    const confirmed = await deps.dialogs.confirm({
      title:
        count > 0
          ? deps.t('machines.page.removeInUse', { name: row.name, count })
          : deps.t('machines.page.removeTitle', { name: row.name }),
      message: deps.t('machines.page.removeMessage'),
      ok: deps.t('machines.page.remove'),
      kind: 'warning',
    });
    if (!confirmed) return false;
    try {
      await deps.machines.remove(row.id);
    } catch (err) {
      say(deps, 'machines.page.saveFailed', err);
      return false;
    }
    deps.status.show(deps.t('machines.page.removed', { name: row.name }));
    return true;
  }

  /** "Default for its dialect", and the same button again to take it away. */
  export async function toggleDefault(row: MachineRow, deps: MachinesDeps): Promise<void> {
    if (deps.machines.blocked()) {
      deps.status.show(deps.t('machines.page.blockedAction'), { error: true });
      return;
    }
    try {
      await deps.machines.setDefault(row.profileId, row.isDefault ? null : row.id);
    } catch (err) {
      say(deps, 'machines.page.saveFailed', err);
      return;
    }
    deps.status.show(
      row.isDefault
        ? deps.t('machines.page.defaultCleared', { profile: row.profileName })
        : deps.t('machines.page.defaultSet', { name: row.name, profile: row.profileName }),
    );
  }

  export async function openMachinesFile(deps: MachinesDeps): Promise<void> {
    try {
      await deps.machines.openFile();
    } catch (err) {
      say(deps, 'machines.openFileFailed', err);
    }
  }

  /**
   * The one path that puts an empty file in place of an unusable one (AD-31 Management).
   * The old file is kept beside it as a backup, and the message names it.
   */
  export async function replaceMachinesFile(deps: MachinesDeps): Promise<boolean> {
    const confirmed = await deps.dialogs.confirm({
      title: deps.t('machines.page.replaceTitle'),
      message: deps.t('machines.page.replaceMessage'),
      ok: deps.t('machines.page.replaceFile'),
      kind: 'warning',
    });
    if (!confirmed) return false;
    let backup: string | null;
    try {
      backup = await deps.machines.replaceWithEmpty();
    } catch (err) {
      say(deps, 'machines.page.saveFailed', err);
      return false;
    }
    deps.status.show(
      backup === null ? deps.t('machines.page.replacedNoBackup') : deps.t('machines.page.replaced', { name: backup }),
    );
    return true;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';
  import ChannelsForm from '$lib/components/dialogs/ChannelsForm.svelte';
  import ChannelsTester from '$lib/components/dialogs/ChannelsTester.svelte';
  import MachineMotionForm from '$lib/components/dialogs/MachineMotionForm.svelte';
  import MachineNumberForm from '$lib/components/dialogs/MachineNumberForm.svelte';
  import { REPOSITORY_URL } from '$lib/components/dialogs/AboutDialog.svelte';
  import { editor } from '$lib/monaco/editorService';
  import { commands } from '$lib/app/registry/commands';
  import { dialogs } from '$lib/app/dialogs';
  import { status } from '$lib/app/status';
  import { docs } from '$lib/stores/documents';
  import { codes } from '$lib/stores/codes';
  import { machines } from '$lib/stores/machines';
  import { profiles } from '$lib/stores/profiles';
  import { t } from '$lib/i18n';
  import { baseName } from '$lib/utils/platform';

  interface Props {
    /** The dialog around the page asks it whether a machine form is open (B1 A4). */
    model?: MachinesModel;
  }

  let { model }: Props = $props();

  const deps: MachinesDeps = { machines, profiles, codes, docs, dialogs, status, t };

  const list = machines.list;
  const revision = machines.revision;

  /** Re-read the service's answers whenever the set or a document's choice changed. */
  const view = $derived.by(() => {
    void $revision;
    return {
      rows: rowsOf($list, deps),
      problems: fileProblems(deps),
      blocked: machines.blocked(),
      readOnly: machines.readOnly(),
    };
  });

  /** null while the list is shown; a dialect id while Add asks which dialect. */
  let profileStep = $state<Record<string, unknown> | null>(null);
  let draft = $state<Draft | null>(null);
  let busy = $state(false);
  // A form is open: closing the dialog now would drop what was typed into it.
  untrack(() => {
    if (model !== undefined) model.hasDraft = () => draft !== null;
  });
  let form = $state<HTMLElement | undefined>(undefined);

  const profileFields = $derived(profileField(deps));
  const fields = $derived(draft ? fieldsFor(draft, deps) : []);
  const errors = $derived(draft ? { ...draftErrors(fields, draft, $list), ...extraErrorsOf(draft, deps) } : {});
  /** The Channels step (M12): only for dialects that declare `machineParams.channels`. */
  const channelsDecl = $derived(
    draft && hasChannelsStep(draft, deps) ? deps.profiles.profile(draft.profileId).machineParams?.channels : undefined,
  );
  const channelIssues = $derived(draft ? channelErrors(draft, deps) : []);
  const motionIssues = $derived(draft ? motionErrors(draft, deps) : []);
  const numberRowsNow = $derived(draft ? numberRowsOf(draft, deps) : null);
  const numberIssues = $derived(draft ? numberProblemsOf(draft) : []);
  const blockedSave = $derived(
    Object.keys(errors).length > 0 || channelIssues.length > 0 || motionIssues.length > 0 || numberIssues.length > 0 || busy,
  );
  /** The stored blocks' problems, shown until the user changes a field of the page (plan §6.4 rule 4). */
  const storedMotionProblems = $derived.by(() => {
    if (!draft || draft.kind !== 'edit' || draft.motion?.touched !== false) return [];
    const machine = draft.id === null ? undefined : machines.get(draft.id);
    const index = $list.findIndex((m) => m.id === draft?.id);
    return machine === undefined || index < 0 ? [] : motionProblemsOf(machine, index, deps);
  });
  const motionAxes = $derived(draft ? axesOf(draft.profileId, deps) : { axes: [], angular: [], diameter: [] });

  const title = $derived.by(() => {
    if (!draft) return '';
    if (draft.kind === 'add') return t('machines.page.addTitle');
    const name = draft.id !== null ? (machines.get(draft.id)?.name ?? draft.id) : '';
    return draft.kind === 'duplicate'
      ? t('machines.page.duplicateTitle', { name })
      : t('machines.page.editTitle', { name });
  });

  function startAdd(): void {
    if (view.blocked) return;
    const choices = profileChoices(deps);
    if (choices.length === 0) {
      status.show(t('machines.page.noProfiles'));
      return;
    }
    profileStep = { [FIELD_PROFILE]: choices[0].value };
  }

  function continueAdd(): void {
    const profileId = String(profileStep?.[FIELD_PROFILE] ?? '');
    if (profileId === '') return;
    profileStep = null;
    draft = addDraft(profileId, deps);
  }

  function startEdit(row: MachineRow): void {
    const machine = machines.get(row.id);
    if (!machine || view.blocked) return;
    draft = editDraft(machine, deps);
  }

  function startDuplicate(row: MachineRow): void {
    const machine = machines.get(row.id);
    if (!machine || view.blocked) return;
    draft = duplicateDraft(machine, deps);
  }

  /**
   * A variant switch rebuilds the form, so a power-on code the newly chosen database does
   * not have is taken away — with a message naming it, never in silence.
   */
  function set(id: string, value: unknown): void {
    if (!draft) return;
    const values = { ...draft.values, [id]: value };
    if (variantIdOf(id) !== null) {
      // D5-3: a default that follows this variant moves with it, unless set by hand.
      followVariantDefaults(deps.profiles.profile(draft.profileId).machineParams, id, draft.values, values);
      const dropped = pruneModalValues(values, fieldsFor({ ...draft, values }, deps));
      if (dropped.length > 0) status.show(t('machines.page.modalDropped', { codes: dropped.join(', ') }));
    }
    // P4h: choosing a preset (or its point-less feeds) fills the table "Numbers" again.
    const refill = id === FIELD_POINTLESS_FEEDS || (id === FIELD_NUMBER_INPUT && value !== CUSTOM_PRESET);
    const next: Draft = { ...draft, values };
    if (refill) delete next.numbers;
    draft = next;
  }

  function setNumbers(rows: NumberClassRow[]): void {
    if (draft) draft = withNumberRows(draft, rows, deps);
  }

  function setChannels(next: ChannelParams | undefined): void {
    if (draft) draft = { ...draft, channels: next };
  }

  function setMotion(id: string, value: unknown): void {
    if (draft?.motion) draft = { ...draft, motion: { values: { ...draft.motion.values, [id]: value }, touched: true } };
  }

  /** "Start this page again": every field empty, so saving removes both blocks. */
  function startMotionAgain(): void {
    if (draft) draft = { ...draft, motion: { values: motionToValues(undefined, undefined), touched: true } };
  }

  /**
   * The app has no way to open a help page (About shows its addresses as text), so the link
   * says where the page is: in the `docs/user` folder and on the repository.
   */
  function openRegexHelp(): void {
    status.show(t('machines.channels.regexHelpAt', { url: `${REPOSITORY_URL}/blob/main/docs/user/regex.md` }));
  }

  /** "Take the active document" of the tester. */
  function activeDocument(): { name: string; text: string } | null {
    const id = docs.getActiveId();
    const doc = id === null ? undefined : docs.get(id);
    if (id === null || doc === undefined) return null;
    const count = editor.getLineCount(id);
    return { name: doc.path === null ? '' : baseName(doc.path), text: count < 1 ? '' : editor.getLines(id, 1, count).join('\n') };
  }

  function cancel(): void {
    draft = null;
    profileStep = null;
  }

  async function save(): Promise<void> {
    if (!draft || blockedSave) return;
    busy = true;
    const ok = await submitDraft(draft, deps);
    busy = false;
    if (ok) draft = null;
  }

  /**
   * Enter and Esc belong to the form while it is open.
   *
   * The settings dialog's own frame confirms on Enter and cancels on Esc, and it would
   * save the settings and close with a half-filled machine in front of the user. The
   * listener is attached by hand, as `Modal` attaches its own: a key handler written on a
   * plain element would trip the a11y check for a non-interactive element.
   */
  $effect(() => {
    const el = form;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
        return;
      }
      if (e.key !== 'Enter' || e.isComposing) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (profileStep) continueAdd();
      else void save();
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  });

  async function run(action: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await action();
    } finally {
      busy = false;
    }
  }
</script>

<div class="machines" data-testid="settings-machines">
  {#if view.blocked}
    <p class="notice" data-testid="machines-notice">{view.readOnly ? t('machines.page.blockedNewer') : t('machines.page.blocked')}</p>
  {/if}
  {#each view.problems as problem, k (k)}
    <p class="notice" data-testid="machines-notice">{problem}</p>
  {/each}

  {#if profileStep}
    <!-- Add, step one: which dialect. The parameter form then always matches it (§7.15). -->
    <div class="form" bind:this={form} data-testid="machine-form" data-step="profile">
      <h3 class="form-title">{t('machines.page.addProfileTitle')}</h3>
      <FormRenderer
        fields={profileFields}
        values={profileStep}
        onChange={(id, value) => (profileStep = { ...profileStep, [id]: value })}
      />
      <div class="actions">
        <button
          type="button"
          class="action"
          data-testid="machine-action"
          data-action="next"
          onclick={continueAdd}>{t('machines.page.next')}</button
        >
        <button
          type="button"
          class="action"
          data-testid="machine-action"
          data-action="cancel"
          onclick={cancel}>{t('machines.page.cancel')}</button
        >
      </div>
    </div>
  {:else if draft}
    <div
      class="form"
      bind:this={form}
      data-testid="machine-form"
      data-step="params"
      data-kind={draft.kind}
    >
      <h3 class="form-title">{title}</h3>
      <FormRenderer {fields} values={draft.values} {errors} onChange={set} />
      {#if channelsDecl}
        <div class="channels-step" data-testid="machine-channels-step">
          {#if draft.channels !== undefined && !formReadable(draft.channels)}
            <h3 class="form-title">{t('machines.channels.title')}</h3>
            <p class="notice" data-testid="channels-unreadable">{t('machines.channels.unreadable')}</p>
            <ul class="problems" data-testid="channels-problems">
              {#each channelIssues as problem, k (k)}
                <li class="problem">{problem}</li>
              {/each}
            </ul>
            <button
              type="button"
              class="action"
              data-testid="channels-remove-unreadable"
              onclick={() => setChannels(undefined)}>{t('machines.channels.removeUnreadable')}</button
            >
          {:else}
            <ChannelsForm
              value={draft.channels}
              onChange={setChannels}
              waitLetters={channelsDecl.waitLetters}
              presets={channelsDecl.presets}
              disabled={view.blocked}
              onOpenRegexHelp={openRegexHelp}
            />
            {#if draft.channels !== undefined && channelIssues.length === 0}
              <ChannelsTester
                params={draft.channels}
                cp={profiles.compiled(draft.profileId)}
                takeDocument={activeDocument}
              />
            {/if}
          {/if}
        </div>
      {/if}
      {#if numberRowsNow !== null && draft.kind !== 'duplicate'}
        <div class="numbers-step" data-testid="machine-numbers-step">
          <MachineNumberForm
            rows={numberRowsNow}
            onChange={setNumbers}
            problems={numberIssues}
            path={NUMBERS_PATH}
            machineId={draft.id ?? ''}
            custom={draft.values[FIELD_NUMBER_INPUT] === CUSTOM_PRESET}
            disabled={view.blocked}
          />
        </div>
      {/if}
      {#if draft.motion && draft.kind !== 'duplicate'}
        <div class="motion-step" data-testid="machine-motion-step">
          <MachineMotionForm
            values={draft.motion.values}
            onChange={setMotion}
            axes={motionAxes.axes}
            angular={motionAxes.angular}
            diameter={motionAxes.diameter}
            problems={storedMotionProblems}
            onStartAgain={startMotionAgain}
            disabled={view.blocked}
          />
        </div>
      {/if}
      <div class="actions">
        <button
          type="button"
          class="action"
          data-testid="machine-action"
          data-action="save"
          data-disabled={blockedSave ? '1' : '0'}
          disabled={blockedSave}
          onclick={() => void save()}>{t('machines.page.save')}</button
        >
        <button
          type="button"
          class="action"
          data-testid="machine-action"
          data-action="cancel"
          onclick={cancel}>{t('machines.page.cancel')}</button
        >
      </div>
    </div>
  {:else}
    {#if view.rows.length === 0}
      <p class="form-help">{t('machines.page.empty')}</p>
    {:else}
      <ul class="list">
        {#each view.rows as row (row.id)}
          <li
            class="row"
            class:broken={!row.usable}
            data-testid="machine-row"
            data-machine-id={row.id}
            data-profile-id={row.profileId}
            data-default={row.isDefault ? '1' : '0'}
            data-problems={row.problems.length}
          >
            <span class="name">{row.name}</span>
            <span class="profile">{row.profileName}</span>
            {#if row.isDefault}<span class="badge">{t('machines.page.defaultMark')}</span>{/if}
            <span class="row-actions">
              <button
                type="button"
                class="action"
                data-testid="machine-action"
                data-action="edit"
                data-disabled={view.blocked || !row.usable ? '1' : '0'}
                disabled={view.blocked || !row.usable}
                onclick={() => startEdit(row)}>{t('machines.page.edit')}</button
              >
              <button
                type="button"
                class="action"
                data-testid="machine-action"
                data-action="duplicate"
                data-disabled={view.blocked || !row.usable ? '1' : '0'}
                disabled={view.blocked || !row.usable}
                onclick={() => startDuplicate(row)}>{t('machines.page.duplicate')}</button
              >
              <button
                type="button"
                class="action"
                data-testid="machine-action"
                data-action="default"
                data-disabled={view.blocked || !row.usable ? '1' : '0'}
                disabled={view.blocked || !row.usable}
                onclick={() => void run(() => toggleDefault(row, deps))}
                >{row.isDefault ? t('machines.page.defaultClear') : t('machines.page.default')}</button
              >
              <button
                type="button"
                class="action"
                data-testid="machine-action"
                data-action="remove"
                data-disabled={view.blocked || !row.usable ? '1' : '0'}
                disabled={view.blocked || !row.usable}
                onclick={() => void run(() => removeRow(row, deps))}>{t('machines.page.remove')}</button
              >
            </span>
            {#if row.problems.length > 0}
              <ul class="problems">
                {#each row.problems as problem, k (k)}
                  <li class="problem">{problem}</li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <div class="actions">
      <button
        type="button"
        class="action"
        data-testid="machine-action"
        data-action="add"
        data-disabled={view.blocked ? '1' : '0'}
        disabled={view.blocked}
        onclick={startAdd}>{t('machines.page.add')}</button
      >
      <!-- M13 (WP13.3, §4): the same two commands as the palette's. Import adds to the file, so it waits for a usable file; a copy of it can always be saved. -->
      <button
        type="button"
        class="action"
        data-testid="machine-action"
        data-action="import"
        data-disabled={view.blocked ? '1' : '0'}
        disabled={view.blocked}
        onclick={() => void run(() => commands.run('machines.import'))}>{t('machines.page.import')}</button
      >
      <button
        type="button"
        class="action"
        data-testid="machine-action"
        data-action="export"
        data-disabled="0"
        onclick={() => void run(() => commands.run('machines.export'))}>{t('machines.page.export')}</button
      >
      <button
        type="button"
        class="action"
        data-testid="machine-action"
        data-action="open-file"
        data-disabled="0"
        onclick={() => void run(() => openMachinesFile(deps))}>{t('machines.page.openFile')}</button
      >
      <!-- Not for a file a newer gEdit wrote: it is read as it is and never replaced. -->
      {#if view.blocked && !view.readOnly}
        <button
          type="button"
          class="action"
          data-testid="machine-action"
          data-action="replace-file"
          data-disabled="0"
          onclick={() => void run(() => replaceMachinesFile(deps))}
          >{t('machines.page.replaceFile')}</button
        >
      {/if}
    </div>
  {/if}
</div>

<style>
  .machines {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
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

  .channels-step {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border-color);
  }

  .numbers-step,
  .motion-step {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border-color);
  }

  .form-help {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .form-title {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    padding: 4px 6px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
  }

  .row.broken {
    border-color: var(--danger-text);
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text-main);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .profile {
    color: var(--text-muted);
    font-size: 12px;
  }

  .badge {
    padding: 0 5px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .row-actions,
  .actions {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
    align-items: center;
  }

  .problems {
    flex: 1 1 100%;
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
