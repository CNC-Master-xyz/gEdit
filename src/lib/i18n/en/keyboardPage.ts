// The Keyboard page of the settings dialog (Phase 4 plan §6.9 rules 1–6). Owner: P4.34.
// One namespace per feature (plan AD-14); the namespace name is this file's name. The prelude
// wrote the page title and the refusal messages; P4.34 adds the page's own texts.

import type { Messages } from '../types';

export default {
  category: 'Keyboard',
  title: 'Keyboard',

  intro:
    'Give a command your own key. A key needs Ctrl, Cmd or Alt, or is a function key. The clipboard, undo and the keys of the system are not offered. Your key wins over a built-in key; the command that loses its key shows none.',
  search: 'Search commands',
  searchPlaceholder: 'Name, group or key…',
  columnCommand: 'Command',
  columnKey: 'Key',
  columnDefault: 'Built-in key',
  none: 'none',
  capture: 'Press a key',
  capturing: 'Press the key now. Esc cancels.',
  clear: 'Remove key',
  reset: 'Reset',
  resetAll: 'Reset all',
  resetAllConfirm: 'Remove every key you set on this system and use the built-in keys again?',
  changed: 'Changed',
  unused: 'Not available',
  unusedHelp: 'This command does not exist right now (for example a script or a package that is gone). Its key comes back with it.',
  empty: 'No command matches.',
  count_one: '{count} command',
  count_other: '{count} commands',
  platformMac: 'Mac',
  platformOther: 'Windows and Linux',
  yourSystem: 'You are on {platform}. Keys you set here apply to this system only; the file keeps the keys of the other system as they are.',
  conflictsTitle: 'Keys used twice',
  conflictUserOverDefault: '{key} ({platform}): {winner} has it now. {others} lost it.',
  conflictUserUser: '{key} ({platform}): {others} want it. None of them has it until you change one.',
  lostKey: 'Lost its key to {winner}.',
  onHold: 'Waiting: the same key is set for another command.',
  altGraphRefused: 'This key was pressed with AltGr. AltGr types a character, so it cannot run a command.',
  readOnly: 'The key file was written by a newer gEdit. It is shown, but gEdit does not change it.',
  loadFailed: 'The key file could not be used. The built-in keys are in force.',
  problems_one: '{count} entry in the key file was ignored.',
  problems_other: '{count} entries in the key file were ignored.',
  saveFailed: 'The keys could not be saved.',
  savedWithConflict_one: 'Saved. {count} key is used twice. See Settings, Keyboard.',
  savedWithConflict_other: 'Saved. {count} keys are used twice. See Settings, Keyboard.',

  // The shortcut reference (View, Keyboard Shortcuts)
  changedMark: 'changed',
  changedMarkHint: 'You set this key. The built-in key is {key}.',
  openPage: 'Change keys…',

  /** Why a key cannot be bound (`KeyRefusal` of `core/keys/userKeys.ts`). */
  refusal: {
    unparsable: 'This is not a key.',
    noModifier: 'A key needs Ctrl, Cmd or Alt, or must be a function key. Otherwise it would take typing away.',
    reserved: 'This key belongs to the system, the clipboard or undo and cannot be used.',
    wrongType: 'A key is written as text, as null to remove it, or as a pair for Mac and other systems.',
    badId: 'The command name is empty or too long.',
    tooMany: 'There are more key entries than gEdit keeps.',
  },

  /** Shown beside a key that may type a character on some keyboards (`KeyNotice`). */
  notice: {
    altGr: 'On some keyboards (for example Swiss German) Ctrl+Alt is the AltGr key. This key may type a character instead of running the command.',
    optionCharacter: 'On a Mac, Option with this key types a character. The command may not run while you type.',
  },
} satisfies Messages;
