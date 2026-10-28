// Files the system asks gEdit to open: a double-click or "Open With" in the file browser, a
// second start of gEdit with a file name (`contrib/openRequests.ts`, `src-tauri/src/open_requests.rs`).
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// The opening itself says what it did (`files.*`). These two lines are about what never got that
// far: a name the system passed that is not a file gEdit may open, and files that arrived faster
// than the window could take them.

import type { Messages } from '../types';

export default {
  refused_one: 'The system asked gEdit to open something that is not a file it can open. It was skipped.',
  refused_other: 'The system asked gEdit to open {count} things that are not files it can open. They were skipped.',
  dropped_one: 'Too many files arrived at once before the window was ready: 1 was not opened.',
  dropped_other: 'Too many files arrived at once before the window was ready: {count} were not opened.',
} as const satisfies Messages;
