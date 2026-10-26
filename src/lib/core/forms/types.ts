// The one form contract (plan §7.5). Written by the M2 prelude (P2); binding.
//
// A `FieldSpec[]` is all three of the app's generated forms: the settings dialog
// (WP2.7, from `SETTING_FIELDS`), transform options (M4, from the profile) and script
// parameters (M5, from the script's TOML header). `modals.form()` renders them and
// `FormRenderer.svelte` (WP2.2) knows how to draw each type — a feature never writes a
// form component of its own.
//
// `label` and `help` are **display text, not i18n keys**: script and profile labels are
// data and are not translated (AD-14). A caller whose labels *are* translatable — the
// settings dialog is the only one — resolves them through `t()` before building the spec.
//
// The functions of §7.5 live next door, where WP2.2 owns them:
// `validateFields` in `./validate.ts` and `initialValues` in `./values.ts`.

import type { FormLiveResult } from '$lib/app/types';

/**
 * v1.2.0 (T146, T159): what a form's `live` hook may answer besides `FormLiveResult`. `note`
 * replaces the form's note while it is set (a note that follows the values: a block number the
 * text would write that the program points at); `help` replaces a field's help by field id, `''`
 * for none (how the machine reads the value typed). The two members are proposed for
 * `FormLiveResult` itself (app types); until then the form dialog reads them from here.
 */
export interface FormLiveAnswer extends FormLiveResult {
  note?: string;
  help?: Record<string, string>;
  /**
   * T226: ids of fields shown greyed out and not changeable while the values stand as they do
   * (an option that does nothing for the choice made above it). The value is kept and handed
   * over as it is; `validateFields` still sees the field as the form declared it.
   */
  readOnly?: string[];
}

/**
 * What a field collects.
 * - `number` / `integer`: numeric input, bounded by `min`/`max`; `integer` rejects a fraction.
 * - `text`: a single line.
 * - `bool`: a checkbox.
 * - `choice`: one of `choices`.
 * - `file` / `folder`: a path, picked with the native dialog (`dialogs.pickFile` / `pickFolder`).
 * - `address-list`: a set of NC addresses, shown as checkboxes over `choices`.
 */
export type FieldType =
  | 'number'
  | 'integer'
  | 'text'
  | 'bool'
  | 'choice'
  | 'file'
  | 'folder'
  | 'address-list';

/** One option of a `choice` or `address-list` field. `label` is display text. */
export interface FieldChoice {
  label: string;
  value: unknown;
}

/** One field of a generated form (plan §7.5). */
export interface FieldSpec {
  /** Unique within the form; also the key in the values record. */
  id: string;
  type: FieldType;
  /** Display text. */
  label: string;
  /** Display text, shown under or next to the control. */
  help?: string;
  /** Used by `initialValues` when nothing is remembered. */
  default?: unknown;
  /** An empty value is rejected by `validateFields`. */
  required?: boolean;
  /** Inclusive bounds for `number` and `integer`. */
  min?: number;
  max?: number;
  /** Decimal places a `number` may carry. */
  decimals?: number;
  /**
   * The most characters a `text` field may hold, counted on the trimmed text (what is
   * stored). A longer text is refused with a message; it is never cut (B1 A4).
   */
  maxLength?: number;
  /**
   * v1.2.0 (T154): display text shown beside the control, a template value's unit (`mm/min`).
   * Nothing reads it but the renderer: it is not checked and not part of the value.
   */
  unit?: string;
  /** The options of a `choice` or `address-list` field. */
  choices?: FieldChoice[];
  /**
   * Phase 3 (P3b prelude; Phase 3 plan §7 #226). Shown but not typed into: a template's formula
   * parameter (P3.8), whose value the form's `live` hook computes from the other fields.
   * `validateFields` skips it; `initialValues` gives it its `default` (usually none).
   */
  readOnly?: boolean;
  /**
   * Phase 4 (P4b; Phase 4 plan §6.4 rule 5). Only on a script parameter: the machine value the
   * field starts from, `"machine.motion.<member>"` from the closed list `meta.rs` checks
   * (`core/machines/motion.ts` `prefillMember`). `src/lib/app/scripts.ts` reads it when the form
   * opens; the generated forms themselves ignore it.
   */
  prefill?: string;
}
