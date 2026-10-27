// The Keyboard page of the settings dialog (Phase 4 plan §6.9 rules 1–6). Owner: P4.34.
// One namespace per feature (plan AD-14); the namespace name is this file's name. The prelude
// wrote the page title and the refusal messages; P4.34 adds the page's own texts.

import type { Messages } from '../types';

export default {
  category: 'Keyboard',
  title: 'Keyboard',

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
