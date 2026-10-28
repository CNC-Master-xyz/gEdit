// The profile form (Phase 4 plan §6.10 rule 7; P4.40): "Edit Profile in Form" and the form's own
// words. The titles and help of the fields are not here: they are the schema's (English, data).
// Plain words for an NC programmer: no member names in the messages, no plan ids.

import type { Messages } from '../types';

export default {
  // The command.
  edit: 'Edit Profile in Form',
  category: 'Profile',

  // The Profiles page.
  editButton: 'Edit in form',

  // The dialog and the form.
  title: 'Edit profile {name}',
  titleReadOnly: 'Profile {name} (built in)',
  loading: 'Reading the profile file…',
  readOnlyNote: 'This profile is built in and cannot be changed. Duplicate it as a profile of your own to change it.',
  duplicate: 'Duplicate as a user profile',
  save: 'Save',
  cancel: 'Cancel',
  more: 'More ({count})…',
  less: 'Fewer settings',
  notSet: '(not set)',
  inherited: 'From {parent}: {value}',
  useParent: "Use the parent's value",
  leaveOut: 'Leave out',
  yes: 'Yes',
  no: 'No',
  listHint: 'One entry per line',
  weightsHint: 'One per line, for example nc = 1',
  badLine: 'Line {line} cannot be read.',
  addRow: 'Add a row',
  removeRow: 'Remove',
  jsonNote: 'Shown as written. Change it in the file itself.',
  openJson: 'Open as JSON',

  // The pattern tester beside a pattern.
  pattern: {
    ok: 'This pattern is valid.',
    needsGroup: 'It has to carry the named group (?<{group}>…).',
    entry: 'Entry {line}: {reason}',
  },

  // The live preview.
  preview: {
    title: 'Preview',
    stale: 'The preview shows the last version that worked: {problem}',
    failed: 'The preview could not be started.',
  },

  // Why the form does not open, or does not save.
  noDocument: 'Open a program first, or choose a profile on the Profiles page.',
  unknownProfile: 'The profile {id} is not loaded, so it cannot be opened in the form.',
  cannotRead: '{name} could not be read: {detail}',
  notJson: '{name} is not valid JSON: {detail}',
  notObject: '{name} does not hold one JSON object.',
  saveFirst: 'Save or close {name} first: it has changes that are not saved.',
  changed: '{name} was changed since the form read it. Close the form and open it again.',
  openFailed: '{name} could not be opened to save the form.',
  lockAction: 'save the profile form',
  locked: '{name} is locked against changes, so the form cannot write it.',
  notSaved: '{name} could not be saved. The file was left as it was.',
  saved: '{name} saved.',
  failed: 'The profile form failed: {detail}',
  problem: {
    noParent: 'The profile {parent} that this one extends is not loaded.',
    ownField: 'A profile built on another one needs its own name.',
  },
  leave: {
    title: 'Discard changes?',
    message: 'The changes to {name} are not saved. Leave without saving them?',
    ok: 'Discard',
  },
} satisfies Messages;
