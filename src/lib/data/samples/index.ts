// The sample programs of the profile form's live preview (Phase 4 plan §6.10 rule 8; P4.40).
// One per grammar and machine type, synthetic: see README.md. The files are text with three
// placeholders (`{n10}`, `{note:TEXT}`, `{skip}`) that `sampleProgram` fills in from the draft.

const raw = import.meta.glob<string>('./*.nc', { query: '?raw', import: 'default', eager: true });

/** The templates by `<grammar>-<machine type>`, e.g. `iso-mill`. */
export const SAMPLE_TEMPLATES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(raw).map(([path, text]) => [path.slice(path.lastIndexOf('/') + 1, -'.nc'.length), text]),
);

/** The grammars and machine types there is a sample for. */
export const SAMPLE_GRAMMARS = ['iso', 'klartext', 'okuma', 'sinumerik'] as const;
export const SAMPLE_MACHINE_TYPES = ['mill', 'lathe'] as const;
