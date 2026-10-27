# File compare

Compare two NC programs side by side, for example a re-posted program against the previous version, or the post output against the copy edited at the machine. The goal is to see real changes (motion, feeds, tools) without noise from renumbering, reformatted numbers or new header comments.

Tag format: `Priority · Size · Delivery`.

> **Status.** Design note from 2026-09-19. What shipped is described in the user guide ([Comparing two programs](../user/README.md#comparing-two-programs)); where this note and the guide differ, the guide is right. Status per section: starting a comparison, the review mode with its ignore options, merging in both directions, export and two files on disk shipped (Phase 1 and M11). Not built: a numeric tolerance (cut). Built in Phase 4: word-level marking (P4.24) and the aligned diff with merge (P4.25). The `P2` tags below were met in M11, not earlier; the tag `P3` on the aligned diff means Phase 4 (the roadmap says which is which).

## Starting a comparison

### Compare with an open document, a file, or the saved version
`P1 · S · Monaco + Core`

**Status:** shipped in Phase 1 (`Cmd/Ctrl+Alt+C`).

- Active document vs. another open document (chosen from a list if more than two are open).
- Active document vs. a file on disk (file dialog).
- Active document vs. its saved version on disk, to show unsaved changes. The [external change prompt](editor-core.md#external-change-detection) uses this too.
- Two files on disk, neither open yet (shipped in M11 as *Compare Two Files…*; both are opened as programs).

The comparison opens in the editor area in place of the single editor and uses Monaco's diff editor. Closing the comparison returns to normal tabs. Both documents stay open, and neither is modified by closing.

### What Monaco's diff editor provides
`P1 · S · Monaco`

**Status:** as designed; the other side is read-only and the current document editable.

- Side-by-side and inline views, with changed lines and changed characters highlighted.
- Next/previous difference navigation (shortcuts).
- Ignore leading/trailing whitespace.
- Editable right side, and reverting a change block from left to right.
- Synced scrolling, overview ruler.

That covers a useful first version with no custom diff code.

## NC-aware comparison

### Ignore options
`P2 · M · Core`

**Status:** shipped in M11 as the buttons of the review bar, with the defaults of each dialect; see [Review mode](../user/README.md#review-mode) for what each option never hides.

Options per profile, adjustable in the compare toolbar:

| Option | Effect |
|---|---|
| Ignore block numbers | Values and presence (`N10 G0 X0` equals `G0 X0`) |
| Ignore whitespace | Spaces and tabs anywhere in the line (`G1X10` equals `G1 X10`) |
| Ignore comments | Uses the profile's comment syntax. A line that is only a comment disappears from the comparison. |
| Ignore case | `g1 x10` equals `G1 X10` |
| Ignore number format | Leading zeros, trailing zeros and an explicit plus sign: `X+05.500` equals `X5.5`, `G01` equals `G1` |
| Numeric tolerance | *Cut.* Values within ± tolerance would count as equal. Not built: `X10.0001` and `X10.` are two different values, because an unseen difference of a thousandth is what the check is for. The profile's `compare.tolerance` is ignored |
| Cycle names | *Added in M11, Klartext only:* the cycle name in the control's dialog language (`CYCL DEF 200 BOHREN` against `... DRILLING`) and the label of an old numbered cycle. Off to begin with |

The decimal point needs care. On Fanuc-style controls, `X10` and `X10.` can mean different values ([syntax-fanuc.md](syntax/syntax-fanuc.md)). When the profile marks the decimal point as significant, number normalization keeps the presence of the point.

### NC-aware review mode
`P2 · S · Core`

**Status:** shipped in M11. Merging is available in the raw view only, as designed.

First implementation of the ignore options, at low cost. Both texts are normalized line by line (normalizing each word through the tokenizer) and the normalized texts are shown in a read-only Monaco diff editor. A toggle switches back to the raw view. Line numbers in the normalized view map to the original lines, so "go to this line in the document" still works. Normalization code is shared with scripts through the [tokenizer](nc-transformations.md#nc-tokenizer-and-modal-interpreter).

Limitation: merging is only available in the raw view.

### Aligned NC-aware diff with merge
`P3 · L · Core`

**Status:** built in Phase 4 (P4.25, X30; the owner asked for it, Q4-14). The third button of the compare toolbar, *Aligned*, next to Raw and Review.

- **What it shows.** Both programs as written, in two ordinary editors side by side. The line diff runs on the review-mode normalization (the toggles of the review bar apply and stay on screen), so a renumbered program or a comment the options drop is not a difference; the result is mapped back to the lines as written. Where one side has lines the other lacks, a hatched filler keeps the panes level, and they scroll as one. The diff is a patience diff (lines that occur once on each side anchor the rest) with the capped Myers diff between the anchors. Lines the options drop sit in the block they fall in: facing a dropped line of the other side, or on a row of their own.
- **Word marks.** Inside a changed block the whole words that differ are marked (P4.24), read after the options: a block number or `X5.50` against `X5.5` that the options ignore is not marked.
- **Merging.** The arrow in the column between the line numbers and the text copies a block to the other side (Shift+click: one row); the toolbar buttons and `Mod+Alt+Right` / `Mod+Alt+Left` copy the block at the cursor as in the raw view. *Word →* and *← Word* (and the commands *Copy Word to Current Document* / *Copy Word to Original*) copy the marked words at the cursor: they replace the words on the other side, put them in, or take them out. Every merge is one undo step of the target, and the target takes the keyboard so that Cmd+Z reaches it. Both panes are editable (unless locked); the alignment is redone a moment after the last change, and a merge is refused until it has been.
- **Not done.** No inline form; no merge of a stretch the options drop on both sides (it is not a difference); no word merge across a line pair the alignment does not pair.
### Word-level marking
`P2 · S · Core`

**Status:** built in Phase 4 (P4.24, X30) for the raw view and review mode, and in the aligned diff (P4.25).

Inside a changed line, mark the whole NC word that differs (`F1200` → `F1000` highlights both words completely), not single digits. Uses the tokenizer on both lines. It applies to review mode and later to the aligned diff.

## Merging

### Copy differences in both directions
`P2 · M · Core`

**Status:** shipped in M11 (`Cmd/Ctrl+Alt+Right`, `Cmd/Ctrl+Alt+Left`, the buttons ← and →, Shift+click for one line).

Copy the current difference block from left to right or right to left (shortcuts and gutter buttons). Monaco only reverts from original to modified. The other direction is added with edits on the left model. Each merge is one undo step in the target document. An option jumps to the next difference after a merge. A single-line mode copies only the line at the cursor instead of the whole block.

## Output

### Export differences
`P2 · S · Core`

**Status:** shipped in M11 as a unified diff in a new tab (raw or review text); the two-column listing and a file export were not built.

Open a unified diff (raw, or normalized as the review shows it) in a new untitled tab, from which the user can save it as a text file. A two-column listing and a direct file export are not built; the command is "Export Differences…". Use: change record for program revisions and approvals.

### Compare colors
`P2 · S · Core`

**Status:** as designed: the diff colors follow the theme.

Colors for inserted, removed and changed lines and changed words come from the theme and have light and dark variants ([settings-ui.md](settings-ui.md#themes-and-colors)).

## Not planned

- Printing only the differences (use the export plus the normal print function).
- Tab key switching between compare panes.
- Three-way merge.
