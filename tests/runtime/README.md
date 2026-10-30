# Runtime harness

The harness builds a test variant of gEdit and drives it like a user: real key presses
and mouse clicks, the real unsaved-changes alert, real quit handling, and stubbed file
dialogs that grant paths exactly as the dialog plugin does. A scenario reads the app
through `data-testid` attributes and the `window.__gedit` test hook (phase 1 plan §7.9),
never through visible text.

It is the only test layer that runs the whole app, so it is what proves the behaviour
of the window, the file operations and the backend. It needs a real macOS desktop, which
a GitHub-hosted macOS runner has: `.github/workflows/harness.yml` runs the cumulative suite
there on every push to `main` and on demand (see [On a hosted runner](#on-a-hosted-runner)).
It is not part of `ci.yml`, which runs on every pull request.

## Prerequisites

- macOS, with a screen you are not using while a run is in progress: the window is
  visible, takes over the keyboard focus and receives native events. An **unlocked**
  screen — a locked one gives the keyboard to `loginwindow`, and every scenario that
  posts input is reported BLOCKED.

  Check it before starting a cumulative suite; half an hour of BLOCKED answers nothing:

  ```sh
  ioreg -n Root -d1 -r -k IOConsoleUsers | grep -qE 'CGSSessionScreenIsLocked"[[:space:]]*=[[:space:]]*Yes' && echo locked || echo unlocked
  ```

  This is the query and the pattern the harness itself uses (`screenLocked()` in
  `harness/core.mjs`). The key is absent while the screen is unlocked, so "no match" is the
  good answer. The spaces around `=` are not always there, which is why the pattern allows
  any number of them: one that requires them reports an unlocked screen while it is locked.
- Node and Rust as for a normal build (`npm install` once; `cargo` on PATH).
- Python 3 for the script scenarios. Every run passes an explicit `GEDIT_PYTHON`
  unless the scenario tests the lookup itself, so your shell setup does not change
  the result.

## Usage

```sh
tests/runtime/sync.sh                                # copy the repo, patch the harness in, build
tests/runtime/run.sh m0-main                         # run one scenario; exits 0 when it passes
tests/runtime/suite.sh tests/runtime/suites/m0.txt   # run a suite and print the result table
```

- `sync.sh [--repo DIR]` copies the working tree (including uncommitted changes) to
  `$GEDIT_RH_DIR/app`, symlinks `node_modules` back to the repo, patches `lib.rs`,
  `Cargo.toml` and `tauri.conf.json`, and builds. Run it again after every change to
  the app or to `harness/harness.rs`; scenarios and `lib/` are read fresh on each run.
- `run.sh <scenario> [--home DIR] [--keep-home] [--env K=V]… [--timeout S]` runs one
  scenario exactly once, so a failure here is a failure.
  - `--home DIR` runs the app with that HOME and never deletes it. Without it the run gets
    `runs/<scenario>/home`, which is deleted afterwards unless `--keep-home` is given.
  - `--env K=V` sets an environment variable of the app. It is applied after the
    scenario's `vars` and takes no placeholders.
  - `--timeout S` replaces the scenario's timeout: the app's own watchdog ends the run
    after S+5 seconds, and the runner kills it after S+10.
- `suite.sh <suite.txt | scenario>… [--no-retry] [--retry] [--repeat N]` runs them one
  after another; see **PASS, FLAKY, FAIL, BLOCKED** below.
- A usage error — an unknown flag or an unknown scenario — exits with code 2.
- Everything lives under `$GEDIT_RH_DIR` (default `$TMPDIR/gedit-rh`):
  - the build in `app/` and `target/`, with `sync.json` (which checkout was synced, and
    when) and one log per build step in `logs/sync-<step>.log`;
  - one folder per run under `runs/<scenario>/`, wiped at the start of every run of that
    scenario, with `app.log` and the page script `bundle.js`;
  - the results: `out/<scenario>.json` per run, and `out/suite.json` for a suite.
- Runs and syncs take a lock (`$GEDIT_RH_DIR/lock`), so two of them never fight over
  the screen. A lock whose owner died is taken over, and a run waits for a held lock for
  `GEDIT_RH_LOCK_WAIT` seconds (default 1800) before it gives up. The lock guards the
  *screen*, not the build, so two harness folders on one Mac must share one:
  `GEDIT_RH_LOCK=<dir>` points them both at the same lock.
- While a run or suite holds the lock, `caffeinate` keeps the display awake, because a
  cumulative suite outlasts a short idle timer and a screen that locks halfway through
  blocks every scenario left. It is a child process that exits with the run and changes
  no setting; `GEDIT_RH_NO_CAFFEINATE=1` leaves the idle timer alone.
- `GEDIT_RH_PYTHON=<path>` is the interpreter behind `{python}` (see the options below);
  without it the harness takes the first `python3` on `PATH`, else `/usr/bin/python3`.
- `HARNESS_VISIBLE=0` skips the window preparation described under
  [How it is put together](#how-it-is-put-together): the window is never sized, centred or
  shown, and stays hidden.
- The repository is never modified. The patched copy is.

## On a hosted runner

`harness.yml` runs `sync.sh` and then `suite.sh tests/runtime/suites/{m{0..12},rp,m13,p3a,p3b,b1,p4a,p4b,p4c,p4d,p4e,p4f,p4g,p4h}.txt` on `macos-15`
(150 minute limit since P4a; it was 45: `p4-perf` runs five scripts on 300,000 lines, about 100 minutes for the job, see the comment in `harness.yml`; its P4e sections D to F add about ten minutes of key presses and three programs opened), always uploads `$GEDIT_RH_DIR/out`, the app logs and the sync logs, and
caches the build directory. A run started by hand can be limited to some scenarios or suites (the
`scenarios` input: space-separated names, scenario names and/or suite names such as `p4e`, letters, digits, `.`, `_`, `-` only;
empty runs the whole list as a push to `main` does), for the answer on one change without the whole 100 minutes:

```sh
gh workflow run harness.yml --ref <branch> -f scenarios="p4-compare"
```

What differs from the owner's Mac, and how the scenarios deal with it:

- The runner has a live, unlocked session with Accessibility already granted, so no setup
  step is needed. The harness is unchanged.
- The login shell is bash and the runner is macOS 15 (macOS 14 until GitHub retired that image on 2026-11-02). The workflow sets `SHELL=/bin/zsh`; the
  Python lookup scenarios (`m0-py3-default`, `m0-py3-zdotdir`) write zsh profiles and pin
  `SHELL` to `/bin/zsh` themselves, so they mean the same on both machines.
- Button order read back from an alert is the OS's business: `m0-encoding` checks the set of
  buttons. `m0-py3-stub` compares the interpreter by real path, since Homebrew's layout differs.
- **Wall-clock budgets go through `h.checkTime`.** The budgets of the perf scenarios are the
  development Mac's (G7, plan §5.2 rule 13). `h.checkTime(name, measuredMs, budgetMs, detail?,
  { also, strict })` holds the measurement to `budgetMs` locally, unchanged, and to
  `budgetMs x 10` when `CI` is set (`h.cfg.ci`; the factor is `CI_TIME_FACTOR` in `lib/api.js`),
  so a hosted runner only catches gross regressions. It is 10 and not 5 because shared-runner UI
  timings vary 5-10x from run to run (a tab switch onto a 10 MB document measured 349 ms against
  100, switching away 607 ms). The check's name and detail always show the measured value, the
  local budget and, on CI, the factor. `also` adds a non-timing condition to the same check;
  `strict` asks for "below" instead of "at most". A perf scenario never compares a duration with
  `<=` itself.
- The cached-interpreter check of `m0-py3-default` counts how often the login shell read the
  profile instead of comparing two run times.

## Suites

One file per milestone, `suites/m0.txt` … `suites/m12.txt`, then `suites/rp.txt` (M12.5, "Real programs, second pass"), `suites/m13.txt` (M13 and the Phase 2 exit criteria), `suites/p3a.txt` (Phase 3, P3a "Understand a block"), `suites/p3b.txt` (Phase 3, P3b "Write with templates"), `suites/b1.txt` (the bug-fix round B1) `suites/p4a.txt` (Phase 4, P4a "Move the path"), `suites/p4b.txt` (Phase 4, P4b "Drilling cycles and time"), `suites/p4c.txt` (Phase 4, P4c "Typing help and bookmarks"), `suites/p4d.txt` (Phase 4, P4d "Renumber, all of it") and `suites/p4e.txt` (Phase 4, P4e "Side by side"), `suites/p4f.txt` (Phase 4, P4f "Folders, files from the system and channel files"), `suites/p4g.txt` (Phase 4, P4g "Settings, keys and packages") and `suites/p4h.txt` (Phase 4, P4h "Profiles and machines"): one scenario name per line, `#`
starts a comment. A cumulative run is all of them in order:

```sh
tests/runtime/suite.sh tests/runtime/suites/{m{0,1,2,3,4,5,6,7,8,9,10,11,12},rp,m13,p3a,p3b,b1,p4a,p4b,p4c,p4d,p4e,p4f,p4g,p4h}.txt
```

The Phase 2 exit criteria (plan §2.2) and where each is proven; `suites/m13.txt` has the same table in its comments:

| Criterion | Scenario |
|---|---|
| X1 Fanuc lathe | `exit2-x1` |
| X2 Okuma and Sinumerik | `exit2-x2` |
| X3 no lost work | `m6-dock-quit-dirty`, `m6-dock-quit-clean-1/2`, `m7-backup`, `m7-readonly`, `m7-recovery-1/2` |
| X4 session | `m7-session-1/2` |
| X5 compare | `exit2-x5` |
| X6 search | `exit2-x6` |
| X7 inspector | Phase 3 (`p3-inspector`, below) |
| X8 checks and transformations | `exit2-x8` |
| X9 user profiles (the templates half is Phase 3) | `exit2-x9`, `m13-user-profile`; `exit2-x9-ties` holds the owner's rule for a folder rule (a built-in wins every tie; M13 review NC-2) |
| X10 no regression | the cumulative run `m0`…`m13` |
| X11 machine configurations and number reading | `exit2-x11-1/2` |
| X12 channels and wait codes | `exit2-x12` |
| X13 real programs | `tests/unit/ownerPublic.test.ts`, `tests/python/test_owner_public.py`, `m9-detect` |
| X1, X2, X5, X6, X8, X12 without Python | `exit2-nopython` |

The Phase 3 criteria that the running app proves (`suites/p3a.txt` and `suites/p3b.txt`, plan `docs/planning/phase-3-implementation.md` §2):

| Criterion | Scenario |
|---|---|
| X7 inspector, with the inspector half of X11 (c) | `p3-inspector` |
| X14 hover in context, with the hover half of X11 (c) | `p3-hover` |
| X16 motion colours | `p3-colors` (also registered as `p3-colours`) |
| X17 the budgets at 300,000 lines, the typing budget with the inspector open and the colours on, the 8 ms index slices (and a 300,000-line Klartext program) | `p3-perf`, `m3-perf`, `m12-perf` |
| X9t templates in the window (the templates half of X9), the Insert tab, the form, completion, stars, the cost of the form's live text, of opening it and of the Insert at 300,000 lines (unnumbered and numbered) | `p3-templates` |
| X18 a, b Edit Cycle: read back, changed, nothing else touched, one Undo; insert mode with the renumber | `p3-cycleforms` |
| X18 c the template manager and New Template from Selection, unsaved edits asked about | `p3-template-manager` |

The Phase 4 criteria that the running app proves (`suites/p4a.txt`, plan `docs/planning/phase-4-implementation.md` §2.2):

| Criterion | Scenario |
|---|---|
| X19 to X22 Translate, Rotate and Mirror from the Tools tab's Built-in Scripts on the goldens of `tests/fixtures/scripts/{translate,rotate,mirror}`: the form, the golden's text, message and findings, one undo; a refused run that changes nothing and lists every refused block in Results | `p4-geometry` |
| X34 (geometry) the three scripts on a 300,000-line program, and rotate and mirror at 30 degrees on an arc-heavy one, within the 900 s of their timeout (a target of 450 s on the development Mac), the result compared line by line, one undo; never retried | `p4-perf` |

The Phase 4 criteria of P4c "Typing help and bookmarks" that the running app proves (`suites/p4c.txt`, plan `docs/planning/phase-4-implementation.md` §2.2 and §6.5; none of them has been run on a runner yet). The programs are `tests/fixtures/p4c/harness/` (its README lists the lines the checks rely on, `tests/unit/p4cHarnessFixtures.test.ts` holds the expected texts to what the core says for them). No scenario opens a system dialog: `h.app.ctx.print.setPrintFunction` is a stub and the save and open dialogs are the harness's queued answers.

| Criterion | Scenario |
|---|---|
| X26 Auto Space (`G1X` is `G1 X`, one undo, a comment and `GOTO` untouched, a paste not a key, off until switched on, never saved) and the automatic block number on Enter (the gap number in a Fanuc program, the renumber below in a Klartext program as one undo, a refusal said in the status bar, a continuation line never numbered, Enter after a typed `M3` that may open the suggestion list), with both switches on together | `p4-comfort` (A, B, C) |
| X27 (bookmarks) names (trimmed, the limit, an empty answer, Cancel), names that follow their line and survive closing the file, the panel (rows of all documents, jump, rename, delete, Clear All asks once), Bookmark All Matches from the find widget (case, regular expression, find in selection, names kept), the 201st refused | `p4-comfort` (D) |
| X27 (bookmarks) named bookmarks across a restart: a tab nobody has shown is listed from its waiting memo, a click shows it and jumps, a delete changes the memo | `p4-comfort-names-1`, `p4-comfort-names-2` |
| X27 (ranges, files, print) Select and Delete Block Range (the form's refusals, the remembered kind, a block with continuation lines whole, one undo), Insert File and Append File (placement, at line 1 below the leading `%` and the program start, Append before the closing `%` or `END PGM`, selected lines, the program-end and tape-end warnings, the file's `%` lines left out, a program start where blocks follow, Klartext renumbering as one undo, the refusals), Print (Mod+P, the view's pages, rows, colours and numbers, a selection, the 20,000-line limit, the view removed at `afterprint`, at the next print and with the document) and Export as HTML (the stubbed save dialog, escaping, one section per page) | `p4-comfort` (E, F, G, H) |

The scenarios of P4f "Folders, files from the system and channel files" (`suites/p4f.txt`, plan `docs/planning/phase-4-implementation.md` §5 P4f and §6.8; none of them has been run on a runner yet): `gh workflow run harness.yml --ref <branch> -f scenarios="p4f"` runs the suite.

| Rule | Scenario |
|---|---|
| Find in Folder: the counted tree and its skips, rows that open, the older-search rule, Stop, the guard against a runaway regular expression, one search at a time | `p4f-folder`, `p4f-folder-stop`, `p4f-folder-regex`, `p4f-folder-busy` |
| files the system opens in the running window, and what is refused | `p4f-system` |
| machine folders: the longest folder wins, two machines on one folder choose none, a duplicate has no folders | `p4f-machine-folders` |
| channel files: Save Channel Files, Merge Channels Back, Find All and Compare by channel | `p4f-channel-files`, `p4f-channel-scope` |
| the check follows jumps (inside IF, over an IF block, a counted REPEAT, a forward GOTO, into a subprogram) | `p4f-flow` |
| the Siemens job list and the path-1 file name | `p4f-joblist`, `p4f-siblings` |

The scenarios of P4g "Settings, keys and packages" (`suites/p4g.txt`, plan `docs/planning/phase-4-implementation.md` §5 P4g and §6.9; none of them has been run on a runner yet): `gh workflow run harness.yml --ref <branch> -f scenarios="p4g"` runs the suite. A second message set does not ship (owner answer Q4-18), so the switch to another language and the fall back from a broken set are held by the unit tests only.

| Rule | Scenario |
|---|---|
| keys: a `keybindings.json` read at start, a user key over a default and over Monaco's own (Cmd+S, Cmd+D with real key presses), the shortcut reference marks only what the user set, the Keyboard page (rows, conflicts, unused commands, the entry that could not be read, search, Press a key with its refusals, an F-key, an Option key, Remove key, Reset, Reset all), the file keeping what it could not use | `p4g-keys` |
| packages: the page, a package's problem told apart from the user's own file, the Scripts menu under the display name, switching off and on without a restart, Reload, the question for a package script that is edited | `p4g-packages` |
| configuration zip: export (layout, count), the round trip as all "same", backup and undo, refusals, the two commands | `p4g-config` |
| configuration zip: an import while Settings is open, a file that cannot switch a package on, the trust tick, a failing write put back | `p4g-config-import` |
| settings search: focus, finding, at most 20, Enter, Escape, the arrow down, a click, a page by its heading | `p4g-settings` |
| language: a tag with no message set behind it, a value that is no tag | `p4g-language`, `p4g-language-bad` |

The scenarios of P4h "Profiles and machines" (`suites/p4h.txt`, plan `docs/planning/phase-4-implementation.md` §5 P4h and §6.10; none of them has been run on a runner yet): `gh workflow run harness.yml --ref <branch> -f scenarios="p4h"` runs the suite.

| Rule | Scenario |
|---|---|
| the profile form (command and inline on Settings > Profiles): live preview, a colour for the profile, refusals, the ruler link, the layout of the file kept, built-in read-only, the `$schema` line | `p4-profiles-form`, `p4-profiles-form-page` |
| Settings asks before the changes in the profile form are lost | `p4-profiles-leave` |
| code colours: set, refused when too faint, shown live, reset, print and export, and a drag of the picker on a large program | `p4-profiles-colours`, `p4-profiles-colours-drag` |
| a profile's own tab width and rulers, also in two split panes | `p4-profiles-editing` |
| the machine form's table Numbers (presets, inch step, Custom) | `p4-machines-numbers` |
| Siemens extra axes and builder codes, and Translate's row for a linear extra axis | `p4-machines-axes` |

The Phase 4 criteria of P4e "Side by side" that the running app proves (`suites/p4e.txt`, plan `docs/planning/phase-4-implementation.md` §2.2 and §5 P4e; the three `p4-perf` rows at the end stay in `suites/p4a.txt`, with the rest of that scenario, and have not been run on a runner yet):

| Criterion | Scenario |
|---|---|
| X29 (split view) Split Editor, Split Editor Down and Close Split from the View tab; F6 and Shift+F6; one model with an own cursor and scroll per pane and one undo history; the typing options in the focused pane; the 2 px accent border; the splitter; a second editor that leaves the theme as it was, in the light and the dark theme; the comparison that detaches the panes and builds them again with the focus back | `p4-split` |
| X29 (channel view) one program with two channel sections and one file per path (`tests/fixtures/p4e/`): the file dialog for the other files, the bar's data attributes, the filler zones and the panes level at the owner's wait codes (`M901P12`, `M910P123`), matched and unmatched marks and the hover of an unmatched one, panes that always scroll together without drift, one undo step from either pane (and one history over three files), the compare overlay, closing by the bar, Close Split and a pane's X; Go to the Matching Mark follows the `P` set | `p4-channels` |
| X29 (merge back) Split into Channel Documents, an edit in each channel document, Merge Channels Back as one undo step (and again after the undo), and the refusal when the program changed in a channel's lines | `p4-channels` |
| X30 word marks (`F1200` to `F1000` marks both whole words) in the raw view and review mode; the Aligned view: two panes with fillers that keep them level, the block arrow and the filler arrow (a real click) copy a block as one undo step of the target, "Word" copies the marked word, a review toggle takes a renumbered-only difference out, the editor and its focus come back | `p4-compare` |
| X34 (P4e, split view) the typing budget of P1 with a second pane on the 300,000-line simple program: 40 characters typed with real key presses in one editor (the baseline), in group 1 while group 2 draws the same lines, in group 1 while group 2 is at the top, in group 2 while group 1 draws the same lines, and in the one editor again after Close Split; each p95 of the keypress to the frame under 50 ms (the other group drawing the character within the same 50 ms, and no more than one frame, 17 ms, over the baseline), and Split Editor shows both groups drawn within 2 s (the open budget of P1; proposed, the plan states none) | `p4-perf` (D) |
| X34 (P4e, channel view) a 300,000-line program with two channel sections and 20,000 waits (the program of `m12-perf`): Channels Side by Side shows both panes drawn, with the bar saying all 20,000 waits are lined up, within 2 s (proposed); 40 characters typed in pane 2 and in pane 1, each p95 under 50 ms and within one frame of the one-editor baseline; 20 line breaks in pane 2, each moving every wait below it, p95 within 100 ms (the figure `channelPanes.typing.slow.test.ts` holds the code to; proposed for the page); the waits found again afterwards | `p4-perf` (E) |
| X34 (P4e, aligned view) two 100,000-line programs that differ in 450 places (150 changed feeds, 150 removed lines, 150 new lines): the Aligned view shows its 450 blocks on both sides, counted against the construction, within 6 s from `compare.open` (the review normalization's 5 s and the diff's 1 s; proposed), 40 characters typed in the current document's pane with p95 under 50 ms, and the typed line drawn as a block of its own within 9 s of the last key (the view's longest wait before it aligns again, 3 s, and the alignment after it; proposed) | `p4-perf` (F) |

The Phase 4 criteria of P4b "Drilling cycles and time" that the running app proves (`suites/p4b.txt`, plan `docs/planning/phase-4-implementation.md` §2.2 and §5 P4b; `p4-perf` stays in `suites/p4a.txt`):

| Criterion | Scenario |
|---|---|
| X25 (the page) the page "Motion and limits" of the machine form: the unit first, one rapid field and one pair of travel ends per axis, the labels that follow the unit, a value outside its bound refused next to the field with the bound named (mm and inch) and Save disabled while one field fails, the two blocks written as the page makes them, an untouched page keeping a hand-edited block and a touched one rewriting it, a broken block listed on the machine's row and on the page with its JSON path and removed by "Start this page again" | `p4-machines` |
| X23 Expand Drilling Cycles from the Tools tab on the goldens of `tests/fixtures/scripts/expand_cycles`: Fanuc `G81` under `G98`/`G99`, `G83` and `G73` with the two peck values, Klartext cycle 200 with its calls; the refusals (a return level that is not stated, the peck values missing, a turning program) that leave the text the same bytes with one row per refused block; the peck fields prefilled from the machine's motion block, empty under a machine without one | `p4-cycles` |
| X24 Statistics and Time on the goldens of `tests/fixtures/scripts/statistics`: the form from the machine's motion block, typed values, the form left empty, the CSV as a new document and the table worked out from it, the findings in Results | `p4-cycles-time` |
| X25 (the checks) the "Spindle speed limit" and "Travel" rows of the program checks with a machine that has limits (`program_checks/limits-fanuc-mill`), and none with a machine that has none, or none at all | `p4-cycles-time` |
| X34 (P4b) Expand Drilling Cycles on a 300,000-line drilling program (about 50,000 holes, 440,000 lines written) and Statistics and Time on the simple program, within the 900 s of their `# timeout` (a target of 450 s on the development Mac), the expansion held to a walk of the program's own text, the totals to the program's own lengths, one undo; never retried | `p4-perf` (sections B and C) |
The Phase 4 criteria of P4d "Renumber, all of it" that the running app proves (`suites/p4d.txt`, plan `docs/planning/phase-4-implementation.md` section 6.6; `m6-lathe-renumber` stays in `suites/m6.txt` and its part B was brought up to the reference model):

| Criterion | Scenario |
|---|---|
| P4.18 the options of Renumber Blocks as fields of the form (Fit to maximum, Every Nth block, Skip lines containing, Start trigger, Align to a column, Skip the first and last lines) with their defaults and bounds, remembered per dialect, each golden `opt-*` typed into the form and giving its text, status line, warnings and rows, one undo; the three refusals that write nothing | `p4-renumber` (sections A to C) |
| P4.19 the references across programs: `M99 P` into the one program that calls this one (also through a packed `M98 P21010`, a program name, a macro call and the local call `M98 Q`), the questions asked for two callers, no caller and a program in the file twice with their reasons as rows, the kept row of `M98 P Q`, Continue and Cancel | `p4-renumber` (section D), `m6-lathe-renumber` (part B) |
| P4.20 references in other open documents: the list after a renumber (a row per reference with its own document and line, another dialect's document left out, a click on a row), Update References in Other Documents (one question, one undo step per document, the reference that is never rewritten left), all or nothing (a changed document, a locked one, Cancel, a closed one) and the enabled state of the command and its ribbon button | `p4-renumber-others` |

The v1.2.0 harness batch (BL-harness) closed gaps on the paths that can lose work, all in `suites/m1.txt` and the scenarios they belong to; none of them has been run on a runner yet:

| What | Where |
|---|---|
| Save All on the quit question: the note's Save As declined stops the quit with the programs already written, then Save writes everything and the app exits (T179) | `m1-quit-save-all` |
| A file dropped while the quit question is up is not opened, not even looked at; after Cancel a drop is taken again (T182) | `m1-quit-multi` |
| A dropped symbolic link to an open file adds no tab and is never silent; one with no target is refused (T181) | `m1-dnd` |
| Save over a file another program changed: the question, Cancel, Overwrite; a file that is gone is written again without one (T183) | `m1-save-changed` |
| The window-state plugin's restore reaches the window: the seeded size at the start of run 1, the size run 1 left at the start of run 2 (T188) | `m2-window-state-1`, `m2-window-state-2` |
| The line-join guard and the capitals in both panes of the aligned view (T034) | `p4-compare` (D6) |

The bug-fix round B1 (`suites/b1.txt`) adds one scenario or pair for each behaviour only the running app can prove:

| Package | Scenario |
|---|---|
| A1 one file under two spellings (a symbolic link, `folder/../`): one tab, Save As onto the other spelling refused, a same-size rewrite noticed at Save | `b1-files-spellings` |
| A1 a restored session shows the front tab first | `b1-session-1`, `b1-session-2` |
| A4, A9 Settings asks before it loses typed input and before leaving the Machines tab with an open form | `b1-settings-leave` |
| A4 a transform of 1,500 lines: bookmarks stay, one undo; the program map scrolls to the cursor | `b1-edits-1000`, `b1-map-scroll` |
| A5 Convert Case keeps program names and lists them | `b1-convert-case` |
| A9 no colour box on `#101=5`; a hover on the first lines fully visible | `b1-colorbox`, `b1-hover-line1` |
| A9 the seven ribbon tabs and their groups; the scrollbar below the group labels at a narrow width | `b1-ribbon-tabs`, `b1-ribbon-narrow` |
| A2 the recovery warning while snapshots fail; the recent-files list that cannot be saved; a restore onto a file another tab holds | `b1-recovery-status`, `b1-recovery-1`, `b1-recovery-2` |
| A3, B4 the login shell's PATH behind the app's own; not asked for when `scripts.python` is set | `b1-py3-loginpath`, `b1-py3-setting` |

## PASS, FLAKY, FAIL, BLOCKED

The harness drives a real desktop, so one run is not proof. `suite.sh` runs a scenario
again when it failed and reports:

| Result | What it means | Exit code |
|---|---|---|
| `PASS` | passed the first time | 0 |
| `FLAKY` | failed, passed on the retry — the harness's problem, not the app's; the first failure is kept in `out/<scenario>.attempt1.json` | 0 |
| `FAIL` | failed twice | 1 |
| `BLOCKED` | could not be carried out: an input the scenario needed could not be delivered, because another app held the keyboard. A locked screen is final and is not retried — a second run would say the same. With the screen unlocked it is a hiccup of the machine (the main thread did not answer an input in time; `m0-trusted` on the hosted runner) and is retried once: a pass on the retry is `FLAKY`, a second block stays `BLOCKED`. Never silently green. A `…-2` whose `…-1` was blocked is blocked too, and printed so from the first line | 1 |

`--no-retry` runs each scenario once, and `--retry` turns the retry back on where
`GEDIT_RH_ROBUST=0` switched it off. A scenario that declares `retry: false` (`p4-perf`: five
runs of up to 900 s each) is never run twice, whichever flag is given: a second run would double
the time of a real regression, and a timing failure is not the harness's flake. `--repeat N` runs the whole list N times and prints how
many runs were flaky, which is how a flake rate is measured. The table's `Focus` column
counts how often the app had to take the keyboard back during a run; `out/suite.json`
holds the same numbers per scenario, with `firstAttempt` for the flakes.

A numbered scenario (`…-2`) reads the HOME its predecessors wrote, so retrying it alone
would test a home that has already been through a run: the whole `…-1 … -n` group is
re-run in order instead — as long as every member of the group is in the same list;
otherwise only the failed scenario is re-run.

## What makes a run fail

`out/<scenario>.json` holds `{ status, pass, checks, violations, errors, blocked, focus, … }`,
and `status` is `pass`, `fail` or `blocked`; FLAKY exists only in the suite table.
A run fails when

- a `h.check(...)` failed, or the scenario threw,
- the page reported a CSP violation that the scenario did not ask for,
- a console error turned up that is neither expected (`h.allowErrors(...)`) nor known
  noise (see below),
- the app asked for a file dialog nobody queued, or left a queued answer unused,
- a native alert was still open when the scenario ended,
- the page never sent its `start` record — the bundle was not injected, or never ran,
- the run hit its timeout,
- the app exited when it should not have, or did not exit when it should.

It is **blocked** instead of failed when `blocked` is not empty: something outside the
app stopped it. The harness says so when a click or a Cmd key cannot be delivered; a
scenario can say so itself with `h.blocked(reason)`; and `suite.sh` says so for a `…-2`
whose `…-1` was blocked and so never wrote the HOME it reads.

A locked screen is a *reason*, not a verdict: it is added to a blocked run's reasons, and
it never turns a failure into a block on its own — a scenario that needs no keyboard can
still find a real bug while the screen is locked, and that bug must not be filed as an
environment problem.

Known console noise, allowed in every run:

- `NotAllowedError` from Monaco's clipboard workaround under synthetic events.
- `Canceled` rejections: how Monaco ends work it no longer needs.
- `ResizeObserver loop completed with undelivered notifications` and `ResizeObserver loop
  limit exceeded`, from Monaco's `automaticLayout` while a panel toggle resizes the
  editor. It is a spec notification that the loop deferred callbacks to the next frame,
  not an exception; startup itself is clean.

## Writing a scenario

```js
import { scenario } from '../lib/index.js'

scenario('m1-example', { timeout: 90 }, async (h) => {
  const file = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  await h.dialogs.queue('open', file)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === 'f01-mill-3tools.nc — gEdit')
  h.check('the file is open', h.app.text().startsWith('(WRITTEN FOR GEDIT'))
})
```

- One file per topic under `scenarios/`; a file may register several scenarios, and
  `run.sh` selects by name, so names are unique across all files.
- Helpers several scenarios need live in `scenarios/m<N>-common.js`, which register no
  scenario of their own: `m0-common.js` checks that a NUL-heavy file opens read-only
  (`checkBinaryOpensReadOnly`), `m3-common.js` opens files through the dialog (`openPath`,
  `openFixture`), `m6-common.js` drives the machine picker and the Machines page,
  `m7-common.js` changes file modes and flags (`osOp`), ages a heartbeat (`makeStale`),
  finds backups (`backupsRoot`, `historyOf`) and quits cleanly (`quitCleanly`), and
  `m8-common.js` walks the fixture goldens (`detectGolden`, `outlineGolden`, `scriptCase`), `m9-common.js`
  opens probe programs and walks number classes (`openProbe`, `numberWalk`), and `m11-common.js` reads Monaco's registries and the diff editor (`monacoRegistry`, `lineChanges`, `paneText`), opens and closes a comparison (`openCompare`, `closeCompare`, `setMode`) and runs the search forms (`runForm`), and `m10-common.js` runs
  the M10 scripts (`runFromTools` from the Tools tab, `runReplace` for an envelope), fills a script's form
  (`fillForm`, `pick`), makes machines from a profile's own presets (`machineMaker`) and compares a shifted
  program with the one it should be (`bump`, `differences`, `outcomeOf`).
  `m12-common.js` reads a channel golden and a preset's block (`golden`, `blockOf`, `presetBlock`), makes channel
  machines (`channelMachines`), and reads the channel item, the program map by channel and the check's rows
  (`channelState`, `waitChannel`, `mapRows`, `mapByChannel`, `resultRows`).
  The `rp-*` scenarios (M12.5) take their programs from `tests/fixtures/nc/uncertain/`, the outline goldens and
  `tests/fixtures/channels/`, or write a short synthetic program into the run folder; they use the helpers above and
  add none.
  The `exit2-*` scenarios (M13, the Phase 2 exit criteria X1, X2, X5, X6, X8, X9, X11, X12 and the run without Python) read
  their programs and goldens from `tests/fixtures/exit2/` (its README is the contract) and share
  `exit2-common.js`: the folder copied once per run (`exitDir`), a golden (`gold`, `goldText`), a script run compared with
  its golden and undone (`runAndCompare`), hover compared by its words (`checkHovers`), F7 and the program map
  (`walkTools`, `mapTools`), the tool list (`checkToolList`), a stored report (`checkStoredReport`, `everyRowJumps`),
  machines made from a golden (`makeMachine`, `useMachine`), the Profiles page (`openProfilesPage`, `profileRows`,
  `profileAction`) and the run with no interpreter (`expectNoPython`). Each criterion is a function (`runX1`, …) that the
  scenario of its own and `exit2-nopython` both call. `m13-typing`, `m13-user-profile` and `m13-machines-io` are the
  scenarios of the milestone itself.
  The `p3-*` scenarios (Phase 3, P3a) share `p3-common.js`: the inspector read through its test ids (`showInspector`, `inspectLine`,
  `stateRows`, `wordRows`, `wordRow`, `openEdit`, `typeInPrompt`), the hover read as the paragraphs and table rows Monaco rendered
  (`hoverOn`, `hoverParts`), the motion marks read from the line-decorations margin (`marksOnScreen`, `markDecorations`,
  `parseMotionColors`, `clickMotionColors`) and the timing helpers of the 300,000-line scenario (`stallMonitor`, `watchRebuild`,
  `measureTyping`). Expected wording is `ctx.t(...)`, expected numbers and kinds come from the goldens of `tests/fixtures/modal/**`
  and `tests/fixtures/motion/**` or from the synthetic programs themselves.
  The P3b scenarios (`p3-templates`, `p3-cycleforms`, `p3-template-manager`) share `p3b-common.js`: the Insert tab read as ribbon
  groups and template blocks (`ribbonGroups`, `templateBlocks`, `runFromInsertTab`), the form dialog read whole (`formState`,
  `typeInField`, `waitForm`), the dialogs' buttons pressed with a real click that is counted (`press`, `pressOk`, `pressCancel`,
  `clicks`; a scenario fails if one fell back to a DOM click), the quick pick and the suggest widget (`pickRows`, `pickByLabel`,
  `suggestItems`), and the goldens and code databases read back (`golden`, `codeFile`, with `files: REPO_FILE` for `{repo}`). Expected
  text comes from `tests/fixtures/templates/**` and `tests/fixtures/cycleforms/**`, never from what the app shows.
  The P4a scenarios (`p4-geometry`, `p4-perf`) share `p4-geometry-common.js`: a golden of the geometry scripts read and its program opened
  byte for byte under the profile the case names (`geometryGolden`, `openGolden`), a script started from the Tools tab with the
  form filled by the field ids of `tests/fixtures/scripts/README.md` (`runGeometry`, which tells the end of the run by a subscription
  to `scripts.running`, and fills every field so no remembered value leaks in) and the answer for the 300,000-line program worked out
  from its own text (`wantedLine`; for the arc-heavy program of the angled runs `arcProgram` and `wantedArcLine`, compared by `nearDifferences` to one last place). Expected text comes from `tests/fixtures/scripts/**`, never from what the app shows.
  The P4e scenarios (`p4-split`, `p4-channels`, `p4-compare`) share `p4e-common.js`: the editor groups read from the DOM (`groupsOnScreen`, `waitGroups`, `hostLayout`, `hostGroups`) and from the service (`views`, `groupIds`, `focusedGroup`, `editorOf`), the keyboard of a group (`textFocusIn`, `waitFocus`, `placeCursor`; a group is given the keyboard with `ctx.editor.focusGroup`, never with `h.focusEditor()`, which takes the first textarea of the host), the keys (`nextPane`, `previousPane`, `undoKey`, `redoKey`, `pressKey`), a ribbon button clicked on its tab (`clickRibbon`, `ribbonEnabled`, `ribbonDisabled`) and the theme of every Monaco root (`editorLooks`). Expected text comes from the programs (`tests/fixtures/p4e/`, the pair written in `p4-compare`) and from `ctx.t(...)`. While a comparison is open `editorInstance()` is undefined (the groups are detached): read the editor only after `waitGroups` or after waiting for `editorInstance()`, never as `editorInstance()?.… ?? 0`.
  The two-pane sections of `p4-perf` (D split view, E channel view, F aligned view) share `p4e-perf-common.js`: the budgets with the reason for each (`KEYPRESS_P95_BUDGET_MS` the P1 typing budget; `TYPING_COST_BUDGET_MS`, `VIEW_OPEN_BUDGET_MS`, `ENTER_BUDGET_MS`, `ALIGNED_OPEN_BUDGET_MS` and `ALIGNED_REALIGN_BUDGET_MS` proposed, derived from numbers the repo already holds), the programs (`channelProgram`: 300,000 lines, two sections, 20,000 waits, and `channelLineAt`, which gives a line of the program and the pane line that shows it; `alignedPair`: two 100,000-line programs with a known set of differences and a typing line far from all of them), and the measuring of a key press in one of several editors (`measureChars`: the keydown to the DOM change that draws the typed line in the typed editor and in each editor that shows it too; `measureEnters`; `groupsDrawn`; `until`). Held to the real resolution and mapping by `tests/unit/p4ePerfHarness.test.ts`.
  The P4b scenarios (`p4-cycles`, `p4-cycles-time`, `p4-machines`, `p4-perf` sections B and C) share `p4-cycles-common.js`: a built-in script started from the Tools tab with the form read untouched first (that is where a prefill is seen) and then filled by field id (`runTools`, which tells the end of the run by a subscription to `scripts.running`; `formValues`, `fillForm`, `fieldText`, `fieldPicked`), machines made through the service with a `motion` and a `limits` block (`makeMill`, `useMachine`), the golden's message cut before the sentence about the machine where a machine is chosen (`beforeMachineSentence`), the statistics goldens (`statisticsGolden`, `openStatistics`), the CSV and its table (`csvRows`, `clock`), and for `p4-perf` the 300,000-line drilling program, the oracle that holds its expansion to a walk of the program's text (`drillProgram`, `checkDrillExpansion`, `walkLines`) and the totals of the simple program worked out from its text (`largeProgramTotals`). `p4-machines` finds a field of the page inside the page (`machine-motion-form`): the machine's own form has a `units` field too. Expected text comes from the goldens (`tests/fixtures/scripts/**`, `tests/fixtures/p4b/harness/`) and from `ctx.t(...)`.
  The P4d scenarios (`p4-renumber`, `p4-renumber-others`, and part B of `m6-lathe-renumber`) share `p4-renumber-common.js`: the option and reference cases (`OPTION_CASES`, `REFERENCE_CASES`) with the parameters of the messages they expect, held to the real transform by `tests/unit/p4dHarness.test.ts`; the goldens' options turned into the form's fields (`formFieldsOf`), the form's memory forgotten before a run (`resetRenumberForm`), read without running (`peekForm`) or tried with values (`tryForm`); a run that answers the question the golden says is asked (`renumberAsking`); a case's document undone and closed (`finishCase`, `closeDoc`: a document of the dialect that stays open is read for references after the next run); and the four documents of the other-documents scenario (`world(base)`, one set of program numbers per phase). Expected text comes from the goldens and from `ctx.t(...)`.
  The P4g scenarios (`p4g-keys`, `p4g-packages`, `p4g-config`, `p4g-config-import`, `p4g-settings`, `p4g-language`) share `p4g-common.js`: the config folder as the `files` option spells it (`CONFIG`, `seed`) with the texts of a script, a profile and a code file (`scriptText`, `profileText`, `codesText`, `json`), Settings opened on a tab and closed (`openSettings`, `openTab`, `closeSettings`, `control`), the key a command has now and was registered with (`keyNow`, `keyDefault`), a stored zip built in the page (`zipOf`, `writeZip`: the manifest first, the layout of the zip crate, Unix mode 0644) and the entry names of a zip the app wrote (`zipNames`), and the export and import through the stubbed dialogs (`exportTo`, `pickImport`, `previewState`, `confirmImport`, `leavePreview`, `tick`). Expected text is `ctx.t(...)`.
  The B1 scenarios (`b1-*`) share `b1-common.js`: the seven ribbon tabs (`TABS`), a symbolic link made outside the app (`symlink`), the
  visible hover as a rectangle (`hoverBox`) and whether a row is inside its scrolling panel (`rowVisible`); a folder made read-only
  with `osOp(h, 'chmod', …)` is made writable again in a `finally`.
- Find elements with `h.q('<test id>', { attr: 'value' })`. The test ids are a contract:
  §7.9 of `docs/planning/phase-1-implementation.md` (Phase 1) and §7.12 of
  `docs/planning/phase-2-implementation.md` (from M6 on), and §6.8 of `docs/planning/phase-3-implementation.md`
  (the inspector, the templates, the manager). A new one goes into the Phase 2 or Phase 3 table in the same change.
- Read app state through `h.app` (the test hook) where it offers it, and through test
  ids otherwise. Never through visible text.
- Trigger through real input (`h.nativeKeys`, `h.nativeType`, `h.nativeClick`) or a
  click on a test id (`h.click`). `h.insertText()` is for characters no US key press
  can produce.
- Every scenario starts a fresh app with an empty `HOME`, so runs never see each
  other's settings, and a file a scenario writes lives in its run folder (`h.cfg.run`).
- **State across a restart is a numbered pair.** `…-1` sets
  `vars: { HOME: '{run}/state-home' }`, a folder in its own run folder, which is wiped
  before every run of `…-1`; `…-2` sets `vars: { HOME: '{run}/../<name>-1/state-home' }`,
  the folder `…-1` left behind (`m7-common.js` `otherRun()` builds such a path). `h.cfg.home`
  does not follow a `vars.HOME` override, so read the app's real folders through
  `h.config.read()`, `h.recoveryDir()` or `ctx.settings.paths`, never through `h.cfg.home`.
- **Open through the dialog even when the scenario drives `ctx.files` directly.** The file
  system scope holds only what a dialog picked or a drop granted. Queue the answer and call
  `open()` without a path — `await h.dialogs.queue('open', path); await h.app.ctx.files.open()`
  — so the stub answers the dialog and grants the path, as `scenarios/m3-common.js`
  `openPath()` does. `ctx.files.open([path])` skips the dialog: the path is never granted,
  the backend refuses the read, `fileOps` shows a native error dialog nobody is there to
  click, and the scenario hangs until its timeout.
- Wait for the thing, not for a number of milliseconds: `h.waitFor(...)` for a state you
  can name, `h.idle()` for an effect with no single element to watch. `h.sleep(n)` is a
  guess, and a guess is what turns into a flake on a loaded machine.

`scenario(name, options, fn)` takes these options; `scenario(name, fn)` runs with the
defaults:

| Option | What it does |
|---|---|
| `timeout` | seconds before the run is killed (default 90) |
| `env` | `'finder'` starts the app with the minimal environment of a Finder launch; default `'inherit'` |
| `python` | `GEDIT_PYTHON` for the app (default `'{python}'`); `null` leaves it unset so the backend resolves it |
| `vars` | extra environment variables |
| `files` | files written into the run folder before the app starts: a path and its text, or `{ text, mode }` to set the file mode as well |
| `retry` | `false`: `suite.sh` does not run the scenario a second time after a failure (only `p4-perf`, whose runs are minutes long; default `true`) |

`vars`, `python` and `files` may use `{run}`, `{home}`, `{python}` and `{repo}`.

## The helper API

| Call | What it does |
|---|---|
| `h.check(name, cond, detail?)` | records a check; a false `cond` fails the scenario |
| `h.checkTime(name, measuredMs, budgetMs, detail?, { also, strict }?)` | records a wall-clock budget check; on CI the budget is multiplied by 10 (see "On a hosted runner") |
| `h.checks()` | the checks recorded so far |
| `h.blocked(reason, detail?)` | this run could not be carried out; the runner reports BLOCKED |
| `h.log(...args)` | a line in the run's `app.log` |
| `h.waitFor(fn, { timeout, interval })` | first truthy value, or the last one on timeout; every sample after the first is taken **after a rendered frame** |
| `h.frame()` | resolves once the browser has rendered a frame |
| `h.idle({ quiet, timeout })` | resolves once the DOM has stopped changing and no backend call is in flight; use it instead of a fixed sleep |
| `h.sleep(ms)` | a fixed wait; the last resort |
| `h.q(testid, attrs?)`, `h.qa(testid, attrs?)` | element(s) by test id; `{ docId: 'd2' }` matches `data-doc-id="d2"`, `true`/`false` require the attribute to be there or gone |
| `h.click(el)`, `h.select(el, value)` | a DOM click, and picking an option |
| `h.nativeKeys([{ key: 's', mods: ['cmd'] }])`, `h.nativeType(text)`, `h.nativeClick(el, { dx, dy, clickCount })` | real NSEvents; `dx`/`dy` move the click away from the element's centre |
| `h.focusEditor()`, `h.insertText(text)` | focus the editor; insert text as an input method would |
| `h.title()` | the native window title |
| `h.dialogs.queue('open' \| 'save' \| 'folder', result)` | the answer of the next file dialog (a path, a list, or `null` for Cancel); the stub grants it like the plugin |
| `h.dialogs.calls()`, `h.dialogs.clear()` | every dialog the app asked for, with its arguments; drop the queued answers, resolving to the ones nobody used |
| `h.alert.visible()`, `h.alert.wait()`, `h.alert.click(label)` | the real NSAlert (`'OK\|Ok'` accepts either label) |
| `h.disk.read/hex/write/touch/stat` | the file system, from outside the app |
| `h.disk.copy(from, to)` | a file or a folder with its content, the folders above `to` created |
| `h.disk.remove(path, { recursive })`, `h.disk.list(path)`, `h.disk.symlink(target, link)` | delete (only below the run folder or the app's HOME; a missing path is no error), list a folder sorted by name (`{ name, isFile, isDir, isSymlink, len }`), make a symbolic link |
| `h.clipboard.read/write/clear` | the system clipboard's text; a run starts with it empty and the runner puts the owner's text back at the end (`HARNESS_CLIPBOARD=keep` leaves it alone; only text is kept) |
| `h.monaco.modelCount()`, `h.monaco.service(id, method)` | the number of Monaco text models, and the one place that reads Monaco's internals (pinned to 0.55; `-1`/`null` when they moved) |
| `h.config.read('settings.json' \| 'machines.json' \| 'state.json')` | one of the app's own files, parsed, from the folder the app really uses; `null` while it does not exist |
| `h.recoveryDir()` | `<data>/recovery`, where the crash-recovery snapshots live |
| `h.drop(paths, { x, y })` | grants like tauri-plugin-fs, then emits `tauri://drag-drop` at that position |
| `h.pgrep(pattern)`, `h.children()` | processes |
| `h.fixture(rel, { from })` | a fresh copy of `tests/fixtures/<rel>` in the run folder (`from: 'runtime'` for `tests/runtime/fixtures/<rel>`) |
| `h.app` | `window.__gedit`: `ready`, `version`, `text()`, `cursor()`, `activeProfile()`, `setProfile()`, and `ctx`, the service aggregate (`src/lib/app/context.ts`: commands, docs, editor, files, dialogs, settings, machines, fileMemory, session, recovery, …) |
| `h.window.close/performClose/quitKey/terminate/state` | the ways an app ends, and what AppKit sees; while an exit is expected each one first hands the queued records to Rust |
| `h.window.geometry()`, `h.window.setSize(w, h, { x, y })` | the window's size and place in physical pixels (the unit of `.window-state.json`, with the `scale`), and a resize in logical pixels that resolves once the window shows it. `vars: { HARNESS_KEEP_GEOMETRY: '1' }` stops the 1100x700 sizing at start, so what the window-state plugin restored stays |
| `h.window.focus()`, `h.window.ensureFront()` | who owns the keyboard; take it back and wait for the confirmation |
| `h.expectExit({ code, signal, within, files, events })` | say the app is about to exit; the runner then judges the exit — the code (default 0) or the `signal`, within `within` ms (default 10000) — and checks the `files` afterwards, each `{ path, includes, excludes, hex, missing }`. It resolves once the record is in Rust, and every call that can end the app flushes first, so no scenario sleeps "to let the queue empty" |
| `h.exitExpectation()` | the exit expectation declared so far, or `null` |
| `h.crash({ files })` | kills the app with SIGKILL, the way a power cut does; it declares the exit itself and never resolves, so snapshot first (`h.app.ctx.recovery.flushNow()`) |
| `h.allowErrors(re)`, `h.expectViolations(fn)` | expected console errors and CSP violations |
| `h.invoke(cmd, args, options)`, `h.attempt(cmd, args, options)` | a backend command, raw or without throwing |
| `h.setenv(name, value)` | sets an environment variable of the running app; `null` removes it |
| `h.menu()` | the native menu as text |
| `h.cfg` | `scenario`, `run`, `home`, `python`, `appVersion`, `robust` |
| `h.rec` | what the recorder saw: `violations`, `errors`, `warnings`, `ipc`, `otherFetches`, `workers`, `dialogCalls` |

## How it is put together

- `harness/harness.rs` is a Tauri plugin with the `h_*` commands. `sync.sh` copies it into
  the app copy as `src-tauri/src/harness.rs` and patches `lib.rs` in three places: `mod
  harness;` at the top, `.plugin(harness::plugin())` after the single
  `tauri::Builder::default()`, and one `harness::h_…,` line per command after the single
  `generate_handler![`. The last two are the only anchors in the app's code, so a change to
  either of them in `lib.rs` breaks the sync loudly (phase 1 plan AD-15). It also adds
  `objc2` to `Cargo.toml` and starts the window hidden, with a non-persistent web view store, in `tauri.conf.json` (`harness/patch.mjs`); on every run
  the plugin sizes the window to 1100×700 (unless `HARNESS_KEEP_GEOMETRY=1`), centres it, turns WebKit's occlusion detection
  off (an occluded page stops drawing) and shows it.
- `harness.rs` is compiled only inside the patched copy, so `cargo fmt` and `clippy` in
  `src-tauri/` never see it. Run `rustfmt --edition 2021 tests/runtime/harness/harness.rs`
  after editing it; CI checks the formatting.
- The Node side is in `harness/`: `core.mjs` (paths, the run lock, finding scenarios,
  bundling the page script, running one scenario and judging it), `run.mjs`, `suite.mjs`,
  `sync.mjs` and `patch.mjs` (what `sync.sh` changes in `tauri.conf.json`). The three `.sh` files only start them.
- `lib/` is the page side: `index.js` is what a scenario file imports (`scenario()`), the
  recorder installs at document start, `api.js` builds `h`, `keys.js` turns key specs into
  native events, and `runner.js` runs the scenario and reports.
- `run.sh` bundles `lib/` and the scenario's file into one script, and the plugin
  injects it into the page before the app loads (`HARNESS_BUNDLE`).
- Results come back as `RH <json>` lines on stdout, which the runner turns into
  `out/<scenario>.json`.
- The build is a normal debug build with `VITE_GEDIT_TEST=1`, so it has the test hook,
  the production CSP and the embedded `tauri://` assets. A release build never
  contains `__gedit`; CI checks that.

What a run isolates, and what it cannot:

- `HOME`, and with it the app's config and data folders, is the run's own.
- WebKit's storage is **non-persistent** in a test build: `sync.sh` sets `incognito` on the
  window (`harness/patch.mjs`), so the web view neither reads nor writes the owner's
  `~/Library/WebKit/<identifier>`. `GEDIT_RH_PERSISTENT_WEBKIT=1` at sync time keeps the old store.
- The clipboard is empty when a run starts and the owner's text is back when it ends. The
  runner (`harness/core.mjs`, not the app) keeps the text, so it comes back after a normal
  end, a crash, a hang the watchdog kills, a SIGKILL of the app, and a Ctrl-C or SIGTERM of
  the runner itself. Only the text is saved and restored: an image, a file list or rich text
  that was on the clipboard is not, and a SIGKILL of the runner itself leaves it empty.
  `HARNESS_CLIPBOARD=keep` leaves the clipboard alone. (The app gets `HARNESS_CLIPBOARD=keep`
  from the runner and only isolates the clipboard itself when the test build is started by hand.)
- A scenario that leaves a process behind is cleaned up by matching the run folder in its
  command line.

One build folder holds one build. `sync.sh` records which checkout made it, and `run.sh` and
`suite.sh` **refuse** (exit code 2) to run another checkout's scenarios against it instead of
judging someone else's code; sync from this checkout, give it a folder of its own
(`GEDIT_RH_DIR`, with `GEDIT_RH_LOCK` shared), or set `GEDIT_RH_ALLOW_FOREIGN_BUILD=1`.

## Native input and the keyboard

Not every posted event needs the app to be in front, and the difference was measured
rather than assumed — a whole cumulative suite run against a locked screen, where the
app is running and drawing but owns no keyboard. The evidence below was measured at M3,
when the activation gate was written:

| Event | Behind another app | Evidence |
|---|---|---|
| plain key | **arrives** — it carries our window number and `NSApp.sendEvent` takes it to that window's first responder | `m1-tabs` typed and moved the cursor through 53 key events with `isActive == false` and no key window, and passed all 36 checks |
| Cmd key | **not reliable** — it is a main-menu key equivalent, and the menu is only offered the event while the app is active | `m0-fix3` lost exactly its two Cmd+S checks |
| click | **not reliable** — a click on a window that is not key is spent on activating it | `m0-trusted` lost the cursor position its click was to set |

So `h_native_input` brings the app to the front and waits for the confirmation — 2.5 s
(`FOCUS_TIMEOUT_MS` in `harness.rs`; override it with `GEDIT_RH_FOCUS_TIMEOUT_MS=<ms>`) —
before a click or a Cmd key, and posts every event in the same main-thread hop that
re-reads the focus, so nothing slips in between the check and the post. A plain key is
never held up: it asks for the keyboard for the events that follow and goes out
immediately. Each rescue is a `focus` record in `out/<scenario>.json`.

What it cannot do is take the keyboard from an app that is genuinely using it: since
macOS 14 an app in the background is not allowed to activate itself over the one in
front, and no API the harness may use changes that. Then the run is **BLOCKED**, naming
the event and the app that holds the keyboard (`key cmd+"o" cannot be delivered:
loginwindow (pid 411) is frontmost`) — which is the honest answer, and the reason the run
lock exists.

Events are handed to our own `NSApplication` and our own `NSWindow`, never to the window
server, so nothing the harness posts can reach another app's window: a run that loses the
keyboard loses its own input, it does not type into whatever you are doing.

`GEDIT_RH_ROBUST=0` turns the activation gate, the frame-synced waits and the retry off
together. It is not for normal use: it exists so a run can be measured against the harness
without its robustness layer; `suite.sh --repeat N` prints the flake rate.
