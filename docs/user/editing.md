# Editing comfort

Small helps for writing and moving around a program: a space before a new word, the number
of a new line, bookmarks with names, selecting or deleting a range of blocks, putting
another file into the program, and printing. The older typing helps (upper case, no
accidental joins) are in the [user guide](README.md#typing-forced-upper-case-and-no-accidental-joins).

| What | Where |
|---|---|
| [Auto Space](#auto-space) | Edit tab, *Typing* |
| [Automatic Block Number](#automatic-block-number) | Edit tab, *Typing* |
| [Bookmarks](#bookmarks) | Edit tab, *Bookmarks*; the Bookmark Panel on the View tab |
| [Select and Delete Block Range](#select-and-delete-block-range) | Edit tab, *Block Range* |
| [Insert File and Append File](#insert-file-and-append-file) | File tab, *Insert* |
| [Print and Export as HTML](#print-and-export-as-html) | File tab, *Print*; `Cmd/Ctrl+P` |

None of these writes anything into your program except the commands that are meant to
change it (the two typing helps, Delete Block Range, Insert File and Append File). Every
change they make is **one undo step**.

## Auto Space

You type `G1X10.` and gEdit writes `G1 X10.`. When a letter starts a new word, the helper
puts a space in front of it.

**It is off by default.** Switch it on in one of two ways:

- For **this session**: the **Auto Space** button in the *Typing* group of the Edit tab (also
  in the palette, `F1`). It applies to every open document, is not remembered, and the
  status bar says which way it went. The next start follows the profiles again.
- For good, for a machine or a folder: `"autoSpace": true` in the `editing` group of a
  [profile of your own](profiles.md#typing-options-in-a-profile).

**What it does.** A space goes in front of the letter you type when all of this is true:

- the letter starts a new word (an address such as `X`, `G` or `M`);
- the word before it is complete: `G1`, `X5.`, `X[#1+1]`, or a block number such as `N10`;
- there is no space in front of the letter already.

So `G1X` becomes `G1 X`, `N10G1` becomes `N10 G1`, and `G1X5.Y` becomes `G1 X5. Y`. The
space is only ever put in front of the letter you type, never behind letters that are
already there. On Klartext, where words must be separated, `X+10Y` becomes `X+10 Y`.

**What it leaves alone.** When gEdit cannot be sure, it adds no space: a missing space is
only untidy, a wrong one changes the program.

- Letters in a **comment**, in a **string** (`MSG("…")`), in the name of a Klartext
  program or cycle, and in the name after a Klartext `SEL PGM`, `SEL CYCLE`, `SEL TABLE`,
  `SEL PATTERN` or `SEL CORR-TABLE`: a name is never split.
- A letter that **continues the word before it**: `GOTO`, `FMAX`, `TOOL CALL`, an Okuma
  `NLAP1`, a Sinumerik `CYCLE81`, `LIMS[2]=`, `R1=R2*2`. After a number the first letter of
  a Sinumerik exponent (`X1.5E`, then `X3`) may continue it, so it gets no space.
- A letter after a word that has no value yet (a Klartext `L`, then `X`).
- A letter in a variable or an expression.
- Paste, a snippet, a template, a completion you accept and a script's result: they arrive
  as they are. Only a letter key is looked at, with no `Ctrl`, `Alt` or `Cmd` held and no
  input method.

With **Upper-Case Typing** on, the space and the capital are typed together: one keystroke,
one undo step. With several cursors, each decides for itself. It works in every editable
editor, in a channel pane as well, by the settings of that pane's own document. It does not act in a
`.json` or `.py` file.

## Automatic Block Number

You press `Enter` at the end of `N120 G1 X10.` and the new line starts with `N130 `, with the
cursor behind it.

**It is off by default.** The switch is the **Automatic Block Number** button in the *Typing*
group of the Edit tab, for this session, like Auto Space. For good, write
`"autoNumber": true` in the `editing` group of a profile of your own; see
[Typing options in a profile](profiles.md#typing-options-in-a-profile).

**When it acts.** Only on a plain `Enter` with one cursor, no selection and the cursor at
the end of the line (blanks after it do not matter). In every other case `Enter` is the
editor's own, without a message. This also holds when:

- the block it starts from has **no block number**;
- the line is nothing but a number;
- the line ends with the continuation mark, since **a line that continues a block is never
  numbered**. When the cursor is on a continuation line, the number comes from the block's
  first line. The same holds when the next line continues this block by its own first mark
  (Okuma `$`): a numbered line in between would take it over;
- the line is the Klartext `END PGM` line: a block after it is outside the program.

**With the suggestion list open.** Enter numbers the line as usual, unless Enter would
accept a suggestion. That depends on the editor's *accept suggestion on Enter* option: with
it off, Enter never accepts, so the line is numbered whatever the list shows; with it on
or on *smart*, Enter belongs to the list while it is open and the line is not numbered.
When gEdit cannot tell whether the list is open, it leaves Enter to the list.

A block-skip mark is not copied to the new line.

**The number.**

- **Most programs** (numbering mode *free*): the number of the block plus the profile's
  step (`N120` with step 10 gives `N130`). If a numbered block follows within the next 100
  lines and has the same or a higher number, the new number must stay below it. When the step would
  reach it, gEdit takes the number halfway between. The new number is written the way the
  profile writes block numbers: the prefix, the digits and the spaces after it.
- **Klartext** (numbering mode *consecutive*, every block numbered with no gaps): the new
  line is the block's number plus 1, and **all the blocks below are renumbered in the same
  edit**, down to `END PGM`. The new line, the new number and all the renumbered blocks are
  **one undo step**. If that would change more than **5,000** lines, the line is just
  inserted without a number, nothing below is touched, and the status bar says so.

**When there is no number, the line break still happens.** The status bar says why, in one
sentence:

| Reason | What it says |
|---|---|
| No number fits, for example between `N120` and `N121` | *No number fits between N120 and N121, so the new line has none. Use Renumber Blocks on the NC tab.* |
| The next number is above the profile's highest | *The next block number would be above 9999, the largest this control takes, so the new line has none.* Typing never wraps around; only **Renumber Blocks…** does. |
| Klartext, more than 5,000 lines below | *The new line has no number: it would renumber more than 5000 blocks below it, so the program is left as it is.* |
| Klartext, in a channel pane | *The new line has no number: in a channel pane the blocks below also belong to the other channels.* In a channel pane free numbering works, from the pane's own lines. |

To renumber a whole program, use [Renumber Blocks…](transformations.md) on the NC tab.

## Bookmarks

A bookmark marks a line you come back to. `Cmd/Ctrl+F2` sets or clears it, `F2` and
`Shift+F2` step to the next and previous one, wrapping around. Bookmarks live in gEdit, not
in the program; they move with their line when you edit, undo or transform the program.
They are remembered per file and kept when you close and reopen the program; see
[Coming back where you left off](README.md#coming-back-where-you-left-off).

**Names.** **Name Bookmark** (Edit tab, *Bookmarks*; no key) asks for a name for the
bookmark on the cursor's line. If the line has none, it sets one. Leave the name empty to
remove the name and keep the bookmark. Cancel does nothing.

- A name has 1 to **60** characters. Extra blanks are made one; control characters are not
  allowed. A name that is too long is refused with the limit named, never cut.
- Two bookmarks may have the same name.
- Clearing a bookmark (`Cmd/Ctrl+F2` on a bookmarked line), **Clear Bookmarks**, the panel's
  remove button and **Clear All** remove the name with it.
- When you delete a bookmarked line, **the bookmark and its name move to the next line**.
  When an edit puts several bookmarks on one line (deleting a range of lines, joining
  lines), the line keeps one bookmark with the name of the upper one, or, when that one has
  none, the first name among them.

**200 per document.** A document keeps at most 200 bookmarks. A 201st is refused, by
`Cmd/Ctrl+F2` as well as by the other commands: *This document has 200 bookmarks, the most it
keeps. Remove one first.* Removing one is never refused.

**The Bookmark Panel.** **Bookmark Panel** (Edit tab, *Bookmarks*, and View tab, *Panels*)
shows the panel in the left side region. It lists the bookmarks of **every open document**,
by tab and then by line: the file, the line, the name and the text of the line. Hover the
file name for its path.

- Click a row to go to that line. The program comes to the front.
- Each row has a button to remove it and one to rename it. A double click on the name renames too.
- **Clear All** in the header asks once, with the count, then removes the bookmarks and names
  of all open documents.
- A tab that you have not shown yet since the restart lists its remembered bookmarks, with
  line and name but no text. A click shows the tab first.
- With none, the panel says *No bookmarks yet. Toggle one with Cmd/Ctrl+F2.*

**Bookmark All Matches.** Search with Find (`Cmd/Ctrl+F`), then run **Bookmark All Matches**
(Edit tab, *Bookmarks*; no key). Every line the search finds gets a bookmark: the word, the
regular expression, the case and whole-word settings and the *find in selection* scope of the
find box count. The cursor does not move.

- It is all or nothing. If the matches and the bookmarks already there are more than 200,
  nothing is marked: *340 lines match, and a document keeps at most 200 bookmarks. Narrow the
  search.*
- A line that has a bookmark keeps it and its name. The status bar says *Bookmarked 12 lines
  (3 already had one).*
- With no search text it says *Search for something first: open Find and type it.* With no
  match, or a regular expression that does not compile, it says *No line matches the search.*

## Select and Delete Block Range

**Select Block Range** and **Delete Block Range** (Edit tab, *Block Range*; no key) ask for
a first and a last line or block and select or delete the whole range. Both open the same
form:

| Field | |
|---|---|
| Range of | *Line numbers* or *Block numbers*. The choice is remembered. |
| From | The first line or block. With lines selected, the form starts with the first and last selected line. |
| To | The last line or block. |

**Line numbers** are whole numbers from 1 to the number of lines in the program.

**Block numbers** can be written with or without the prefix: `120` or `N120` (on Klartext
also `N120`; where the control has main blocks, `:120`). Only the spellings the control
uses for block numbers count: `G10`, `X10` or `O1000` are no block number and are refused.
Where block numbers are compared as text (Okuma), `100` does not find `N0100`. gEdit looks
in the block heads of the whole program. On Klartext the `BEGIN PGM` line is block 0 and
the `END PGM` line the last block, so `0` to the last number is the whole program. A line that continues a block is not a head, and a
number in a comment is no block number. A block that continues over several lines is taken
whole: the range ends at the last line of the *To* block.

**A refusal stays in the form** and nothing is selected or deleted:

- *Enter a whole number, for example 120.* / *Enter a block number, for example N120 or 120.*
  (also for any word that is not a block number)
- *The program has 480 lines. Enter a line from 1 to 480.*
- *Block N120 is not in the program.*
- *Block N120 is at lines 12 and 340. Use line numbers.* A block number that is there twice is
  never guessed (unlike Go to Line or Block, which goes to the next one).
- *The first line is below the last line. Swap the two.* (or the same for blocks).

**Select** selects the whole lines and puts the cursor in the editor: *Selected lines 12–40
(blocks N100–N200).* **Delete** removes the lines with their line breaks, as **one undo
step**: *Deleted 29 lines: lines 12–40 (blocks N100–N200). Undo brings them back.* The range may
be the whole program. Delete is not offered in a locked document. Neither is offered with no
document open. In a channel pane the numbers are the line numbers of the whole document.

## Insert File and Append File

**Insert File** and **Append File** (File tab, *Insert*; no key) put the lines of another
file into the program. You pick the file in the usual dialog. It is read the way Open reads
it (UTF-8, the byte order marks, UTF-16, a Windows fallback), turned to the line ending of your
document, and its last line break is dropped.

**Which lines go in.** A line that is only `%` (the tape mark) is left out: it would open
or close the tape in the middle of your program. The status bar says so (*Left out the %
line of the file.*). Only an empty document (nothing but blank lines) takes the file as it
is, with its `%` lines.

**Where the lines go.**

- **Insert File:** *before the cursor's line* when the cursor is in column 1 and nothing is
  selected. Otherwise *after the cursor's line*, or after the last line of the selection.
- **Insert at line 1** never goes above or into the first lines of the program: a leading
  `%` and the program-start line (`O1000`, `%_N_…_MPF`, `$NAME.MIN%`, Klartext `BEGIN PGM`)
  stay on top, and the lines go below them. The exception is a file that starts a program
  of its own: its lines go in front of the program-start line, below a leading `%`.
- **Append File:** after the last line. If the program ends with a line break, the lines go
  before that empty last line, so no blank line shows up. If the program closes with a
  `%` on a line of its own (below the first line) or, on Klartext, with `END PGM`, the
  lines go **before** that closing line.
- A block that continues over several lines is never cut: the lines go before its first line
  or after its last.

The inserted lines are selected afterwards, so you see what came in. The insert and every
number change are one undo step. The status bar says *Inserted 12 lines from part2.nc at
lines 40–51. Undo takes them back.*

**Warnings.** The insert goes ahead, and the status bar says it in red:

- **After a program end.** The insert point is below an `M30` (or the control's other program
  end, Klartext `END PGM`) with no new program start after it: *The program ends at line 38.
  The inserted blocks come after it and do not run unless they are called.* A lone `%` is
  not a program end. A file of several programs does not warn when the insert is in the
  second, and neither does a file that starts a program of its own.
- **After the `%` that ends the tape.** The insert point is below the last `%` of the
  program: *The % at line 90 ends the tape. The control reads nothing after it, so it does
  not read the inserted lines.* A `%` that a program start follows is the mark between two
  programs and does not warn.
- **A program start or end in the file where blocks of the program follow.** The file holds
  a program start (or the program's header) or a program end, and blocks of the program
  come after the inserted lines: *Line 42 (“M30”) ends the program in the middle: the blocks
  below it do not run. Check the program.* (or, for a start, that the blocks below now belong
  to that program).

**Block numbers.**

- **Klartext:** the inserted blocks and the blocks below take consecutive numbers in the same
  edit, from the number of the block above plus 1. A line of the file without a number gets
  one, a comment line too, since the control numbers every line; a blank line and a line
  that continues a block (after `~`) get none. The status bar counts the blocks that took a
  new number. If more than 5,000 blocks below would change, or a number would pass the
  highest the control takes, nothing is inserted.
- **Every other dialect:** the inserted blocks keep the numbers they have. Use
  **Renumber Blocks…** on the NC tab to change them.

**Refused, with the file's name and the reason, nothing inserted:**

- the file cannot be read, is larger than gEdit opens, is data rather than a program
  (mostly NUL bytes), or is empty;
- the file holds nothing but `%` lines, which an insert leaves out;
- **Klartext:** the file holds a `BEGIN PGM` line (*The file starts a second program …*; when
  it holds `END PGM` as well, both lines are named) or an `END PGM` line (*The program would
  end there, before the blocks below it …*). A program of this control holds only one.
  Remove those lines from the file first;
- the file's last line ends with the continuation mark (Klartext `~`): the block below
  would become part of it;
- the file's first line starts with the continuation mark (Okuma `$`) and the insert point is
  below line 1: it would become part of the block above;
- the program was closed or locked, or another program came to the front, while the file
  was read.

Both commands are not offered with no document open, in a locked document, or while the
comparison or the [channel view](channels.md#channels-side-by-side) is open: the channel view
sorts lines into channels again, and an insert could move lines into another channel.

## Print and Export as HTML

**Print** (File tab, *Print*; `Cmd/Ctrl+P`) prints the program through the system's print
dialog, which can also write a PDF. **Export as HTML** (same group; no key) writes the same
pages as one web page file, with its colours and no script, which you can open and print from
a browser. Use it where Print does not work.

Both ask the same form, and remember your answers:

| Field | |
|---|---|
| What to print | *The whole program*, or *The selected lines*. With lines selected, the selection is the default. |
| Colours | *In colour* or *Black only* |
| Line numbers | On by default. These are the program's line numbers, not block numbers. A selection keeps its own. |
| Font size (points) | 7 to 14, default 9 |

**The pages.** Portrait, with 15 mm margins, cut for the smaller of A4 and Letter, so a
program prints the same on either paper. Landscape in the print dialog is not supported;
the pages would show cut. A line wider than the page continues on the next row without a
number. A tab is blanks up to the next multiple of 4. Each page has a header with the
program's name, the date of printing and *Page 2 of 5*.

**Colours** are the editor's colours for the dialect, always the **light** ones, since paper
is white, whatever theme is on. A colour too pale to read on paper prints black. *Black only*
writes no colour at all.

**Limits.** Print is limited to **20,000 lines**: *This program has 41,022 lines; printing is
limited to 20,000. Print a selection.* Export as HTML is limited to **100,000 lines**. The
pages are counted as well as the lines, since a very long line takes many rows: a program
that would take more pages than that is refused too (*This program would take more than
N pages; printing is limited to N. Print a selection.*; for the export, *Export
a selection.*). A selection that crosses the junction between channels is refused, as in
the transformations.

**`Cmd/Ctrl+P` in a form or a dialog** does nothing: gEdit does not print its own window
there.

`Cmd/Ctrl+P` is always taken by gEdit, so the web view's own print never prints the
application window. With no program open, Print says so in the status bar.
