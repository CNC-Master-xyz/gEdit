// The machine dialog's table "Numbers" (Phase 4 plan §6.10 rule 12; P4.43a): how this machine
// reads a number of each kind. Plain words for an NC programmer: no class names, no member
// names. The preset labels the table starts from are data of the profile and are not here.

import type { Messages } from '../types';

export default {
  title: 'Numbers',
  note: 'How this machine reads a number of each kind. Choosing a number input above fills the table; a row you change here is saved with the machine.',
  custom: 'These rules match no number input of the list, so the choice above shows “Custom”.',

  // The classes, in the table's order.
  class: {
    length: 'Length',
    angle: 'Angle',
    feedPerMin: 'Feed per minute',
    feedPerRev: 'Feed per revolution',
    dwell: 'Dwell',
  },

  // The three readings.
  reading: {
    increment: 'In steps of the increment (a number without a point)',
    calculator: 'As written',
    scale: 'Every number times the unit',
  },

  // Column headings and field labels.
  kind: 'Kind of number',
  readingLabel: 'Reading',
  increment: 'Increment',
  incrementInch: 'Increment in inch programs',
  /** The unit beside an increment. */
  unit: {
    length: 'mm',
    angle: 'degrees',
    feedPerMin: 'mm/min',
    feedPerRev: 'mm/rev',
    dwell: 's',
  },
  unitInch: {
    length: 'inch',
    feedPerMin: 'inch/min',
    feedPerRev: 'inch/rev',
  },
  /** Help of the inch field of a length. */
  inchEmpty: 'Empty: a tenth of the metric increment (none for “Every number times the unit”)',
  /** Help of the inch field of a feed: no single rule fits, so it is always written. */
  inchFeed: 'Write it whenever the metric increment is set or changed. Fanuc: a hundredth of the metric step, Okuma: a tenth.',
  /** The increment of the length row. With “As written” the cycle values in steps still use it. */
  incrementHelpLength:
    'The increment, or for “Every number times the unit” the value of a written 1. A decimal number above zero, such as 0.001. With “As written” the step still counts the cycle values the control always takes in steps (G74/G75 P and Q, G76 P and Q, G83 Q).',
  incrementHelp: 'The increment, or for “Every number times the unit” the value of a written 1. A decimal number above zero, such as 0.001.',
  /** Shown beside a row that differs from the machine's base reading. */
  ownRule: 'Own rule',
  problemsTitle: 'These rules cannot be saved yet:',
  /** A problem of the rules, worded by the check of the machines file. */
  problem: '{message}',
} as const satisfies Messages;
