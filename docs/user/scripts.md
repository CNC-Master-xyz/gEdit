# Scripts

A script is a small Python program that reads your NC code and gives something back: new
code, or a table. Scripts are how gEdit is extended. Scaling feeds, scaling spindle speeds,
listing tools, checking a program, finding its extents, writing drilling cycles out as plain
moves, estimating the running time, doing arithmetic on address
values and moving, turning or mirroring the path are done by scripts that ship with the app, and they use exactly the same contract
as one you write yourself — so if a bundled script is nearly what you need, copy it and
change the part that is not.

> **Only run scripts you trust.** A script is an ordinary program running with your rights:
> it can read and write your files and reach the network. gEdit does not sandbox it.
> See [Security](#security) at the end of this page.

## What you need

Python **3.9 or newer**. Nothing else — no `pip install`, no packages. The bundled scripts
use the standard library only, on purpose: you should be able to run them on a fresh
machine.

gEdit looks for an interpreter at startup, in this order:

1. The `GEDIT_PYTHON` environment variable, if it is set.
2. `Settings ▸ Scripts ▸ Python interpreter`, if it names a file that exists. Point this
   at a virtual environment's interpreter if you want one.
3. The interpreter your own command line would run.
   - **macOS and Linux**: `python3`, looked up through your login shell — so a Homebrew or
     python.org install is found even when you started gEdit from the Dock — and then in
     the usual install locations.
   - **Windows**: the `py` launcher first, asked which interpreter `py -3` would start,
     then `python`, then `python3`. Each is looked for where a command prompt would find
     it — the Windows folder included, so a launcher installed for all users is found
     whatever is on `PATH`.

`GEDIT_PYTHON` is read from the environment gEdit was started with: a variable exported in
a shell profile reaches it only when gEdit is started from that shell, not from the Dock or
Finder; on Windows, set it as a user environment variable. gEdit looks again when you
change the interpreter setting; after installing Python while gEdit runs, restart it.

**The PATH a script runs with.** A program started from Finder or the Dock gets only the
system's short `PATH`, so a script that runs a tool of yours (a formatter, `git`) could fail
with "not found" although the tool works in your terminal. On macOS and Linux gEdit therefore
asks your login shell once for its `PATH` and adds the folders the script's own `PATH` is
missing, behind the ones it has. gEdit does not read `~/.zshrc` or any other file only an
interactive shell reads: something that is set up only there is still not found, and the way
out is to put its folder on the login `PATH` or to name the interpreter in
`Settings ▸ Scripts ▸ Python interpreter`. When `GEDIT_PYTHON` is set, or the interpreter
setting names a file, gEdit never starts your login shell at all, and the script keeps the
`PATH` gEdit was started with.

**If no interpreter is found — or only one older than 3.9 — the commands that run a script
are disabled and say so. Everything else in gEdit keeps working**, writing and editing
scripts included. On Windows that covers the case that looks least like it: a
clean Windows 10 or 11 already has `python.exe` and `python3.exe` on `PATH` before Python
is installed, as placeholders that open the Microsoft Store instead of running anything.
gEdit never takes one of those for an interpreter, and the Tools and Scripts tabs say "Python 3.9 or
newer was not found, so the script commands are off". A Python you really did install from the Store is used as usual.

## Running a script

The scripts that come with gEdit are in the **Built-in Scripts** group of the **Tools** tab,
and your own are in the **My Scripts** group of the **Scripts** tab — a subfolder's scripts
under its name, the rest together — with the script's own description as the
tooltip. A script that declares which dialects it is for is only offered on those.

| | |
|---|---|
| Pick a script from a list | **F9** |
| Run the last script again | **Cmd/Ctrl+F9** |
| Run a particular script | Its button on the Tools tab (bundled) or the Scripts tab (yours), or its own entry in the `F1` command palette |

**Cmd/Ctrl+F9 does not ask again.** It runs the last script straight away, with the values
you used last time — running the same thing again is what the command is for. To change a
parameter, start the script from **F9** or from its Tools button, which opens the form.

What then happens, in order:

1. **Parameters.** If the script declares any, a form opens, pre-filled with the values you
   used last time for that script. A script without parameters runs immediately.
2. **The input.** Most scripts take the selection, or the whole program when nothing is
   selected. A selection is extended to whole lines. The text goes to the script as UTF-8
   with LF line endings, whatever the file's own encoding and line ending are.
3. **The run.** The status bar shows that a script is running: click it to stop the run.
   The **Script Output** panel has a **Stop** button too. One script runs at a time.
4. **The result.** What happens depends on the script — see below.

A run that takes longer than the time limit is stopped. The limit is
`Settings ▸ Scripts ▸ Script timeout` (60 seconds by default) unless the script's own
header sets one. A stopped or cancelled run changes nothing.

**Stopping ends what the script started.** The **Stop** button, the time limit and quitting
gEdit end the script and the programs it started: on macOS and Linux as a group, on Windows
because gEdit binds the script and its children together (a Job Object), so a program the
script started — a formatter that hangs, say — dies with it. A program the script left
running on purpose after it finished by itself is not touched. Quitting gEdit waits at most
a third of a second for a running script to end.

### What comes back

| The script declares | What gEdit does with its output |
|---|---|
| `replace` | Replaces the input lines, as **one undo step** |
| `new-document` | Opens the text in a new untitled tab, in the same dialect |
| `report` | Shows a table and findings in the **Results** panel; a row with a line number jumps there when you click it |
| `panel` | Shows the raw output in the **Script Output** panel, with a **Structured result** section when it is JSON |

`panel` is also what a script with no header gets, and what a script with a header gEdit
could not read gets. That is deliberate: a half-understood script must never be treated as
one that may rewrite your program.

### When nothing is applied

The safety rules, in the order they are checked — so the message you get names the cause,
not whatever failed first:

1. **You cancelled it.**
2. **It ran out of time.**
3. **It ended with an error** (a non-zero exit code, or it was killed). Whatever it wrote
   on its error output is shown. When that text was cut at the size cap, the outcome line of
   the **Script Output** panel says *Error messages cut off*, so a short message is not
   mistaken for the whole of it.
4. **Its output was cut off** at the size cap, or the script left the output open (a
   program it started kept the pipe) so that gEdit stopped waiting for it. A prefix of a
   program is a program that ends in the middle of a cut, so it is refused rather than
   applied, and the reason is shown.
5. **It did not return a usable result**: a `report` whose JSON is not a report, or an
   envelope whose JSON is not `{"text", …}`.
6. **It produced nothing**, in `replace` mode. Otherwise a broken script would silently
   delete your selection.
7. **You edited the document while it ran.** The answer no longer fits the question: the
   lines it would overwrite have moved. Nothing is applied, and a dialog — *The program
   changed while the script ran* — offers **Open in new tab** so the work is not lost.
8. **You locked the document while it ran**, in `replace` mode. Nothing is written into it;
   the same **Open in new tab** is offered.

A run can also be refused before it starts: no program is open, the script is not for this
dialect, it needs a selection, its header asks to replace an input it does not take, it
would replace the text of a locked (read-only) program, another script is running, or no
Python was found. The status bar says which. A script in any other mode still runs on a
locked program: it changes nothing there.

Nothing is ever applied silently: every run ends in a summary, a result, or a message
saying why not.

## The scripts that ship with gEdit

They are read-only. To change one, use **Copy to My Scripts** in the `F1` palette, or
**Edit Script**, which offers the copy (**Copy and edit**). The copy lands in your own
scripts folder, where it takes the place of the bundled one with the same file name, and
gEdit opens it for editing. A file of that name already in your folder is never
overwritten: the copy is refused and says so.

### Scale feed rates

Multiplies `F` values by a percentage.

| Parameter | |
|---|---|
| Percentage | 0.1 to 1000; 100 % leaves every feed as it is |
| Decimal places | As written, or 0 to 4 |
| Smallest feed / Largest feed | A scaled feed outside the range is pulled back to it. Empty means no limit |
| Only feeds above / Only feeds below | Leaves the others as they are |
| The limits are in | Which feeds the four values above are compared with: *automatically* (per revolution on a turning dialect, per minute on a milling one), *feed per minute* or *feed per revolution*. A feed in the other unit is scaled **without** the limits, and the run says so, so a largest feed of 0.3 meant per revolution never lowers a feed per minute |
| Also scale per-revolution feeds | Automatically, yes or no. **Automatically** scales them on a turning dialect and leaves them alone on a milling one, which is what each of them usually wants |
| Also scale inverse-time feeds | `G93`, where `F` is the reciprocal of the time the block may take. Off by default |

With **As written** a value keeps the decimals it was written with. Whatever the decimals,
the run warns when rounding puts a result more than 5 % away from the exact value (`F0.3`
at 50 % becomes `F0.2`). Where the decimal point matters, a feed written without one never
gets one, and a value that would round to zero is left as it was and reported.

It leaves alone, and reports, the feeds it must not touch: **thread leads** (in a tapping
or threading cycle the `F` carries a lead rather than a feed rate — the finding names the
code of the block, so you can see which cycle it was) and feeds written as a variable
(`F#101`, `F=R1`, `F=V1`): the control works out those values, gEdit cannot. A feed written
under an address of its own — a chamfer feed `FRC=`, the `FA=` of a change of cutting
conditions — is not the `F` word either; it is reported and left. An Okuma line that starts
with `$` belongs to the block above it, whether or not a blank follows the `$`, so the lead
a `G71` thread cycle carries on its `$` line is a thread lead like any other. Klartext
`FMAX` and `FAUTO` are not numbers and are never touched; an `F` on a rapid block (`G0 … F`)
is scaled like any other. A value written with a Klartext decimal comma (`F1000,5`) is
scaled like any other and written back with its comma; a limit compares it correctly too.

**A thread lead is a lead only where the database says so.** The `F` of a threading code is
never scaled. A tapping cycle is different: its `F` follows the feed unit in force, so under
`G94` it is a feed per minute and is scaled like one (it used to be taken for a feed per
revolution, which is a hundred times too small on an Okuma set to 1 µm). Its speed is still
left, as below. A Sinumerik `G33`, `G331`, `G332`, `G335` or `G336` takes its lead from `I`,
`J` or `K`: the block's `F` does not cut the thread, stays the feed in force, and is left as
written with a finding that says so. After a Sinumerik `G931` an `F` is a travel time, not a
feed: it is never scaled, whatever the options, and each one is reported.

**A feed in another unit than the limits is scaled without the smallest and largest feed.**
A feed per tooth or an inverse-time feed has no unit the limits could be compared in; it is
scaled and reported. With no machine, a Fanuc feed written without a point and per revolution
has no value either ([machines.md](machines.md#not-every-word-is-read-the-same-way)); it is
scaled and not compared. This holds only when the run sets the smallest or largest feed and
no filter. **With "Only feeds above" or "Only feeds below" set, such a feed is left as
written** and reported as a warning, and the summary says how many were left because the
filter cannot be compared with them: a feed in another unit and one with no value are not
guessed at.

**A Fanuc lathe `G71`, `G72` or `G73` without a `P` is refused while no machine is chosen.**
On a Fanuc lathe these roughing cycles carry `P` and `Q` (or `U` and `R`), and the `F` is a
feed. The same `G71 X… Z… F2.` with no `P` is an Okuma thread cycle, whose `F` is the lead,
and a program whose dialect was only guessed could be either. The `F` is left with a warning
that says so; choose a machine for the document to have it scaled, or scale the block by
hand.

**A code that means two things is refused.** Some codes cut a thread on another kind of
machine, in the other G-code system or on another make of control — `G76` and `G92` on the
Fanuc mill profile, `G74` and `G78` (system A) or `G74` and `G92` (system B) on the Fanuc
lathe, `G76`, `G84`, `G88` and `G92` on an Okuma. Nothing in the block says which reading is
meant, so their `F` is left alone with a warning — "threading cycle" for the codes above,
and "**tapping** cycle" for Okuma's `G84` and `G88` and the Fanuc lathe's `G74`, whose other
reading is a tap rather than a thread (their speed is left too, below).

**An `F` under a code the dialect's database does not know is reported and left, not
scaled**, when that code is written under the letter the dialect writes its moves with
(`G` on the ISO dialects; Klartext has none). A builder's own cycle may take that word as
something other than a feed rate, and scaling it changed a real program's radial tapping
lead before this rule existed.

**The words of a `G65`/`G66` macro call and a `G10` offset block are arguments or data, not
feeds.** They are reported and left, whatever letter they are written under.

**A function's own `F` is not a path feed.** In Klartext the `F` behind `M128` (the feed of the
compensating moves), behind `M140` (the retract), in a `PLANE … MOVE` or `TURN` line (the
tilting move) and in cycle 19 (positioning the rotary axes) belongs to that function. It is
left as written with an information finding — *F800 is the feed for the compensating moves of
M128, not a path feed, so it is left as written.* — and the summary counts them (*N feeds of a
function left as written*). An `F` in front of the code in the same block (`L X+50 F600 M128
F900`) is the path feed and is scaled; the `F900` is not. The tool list leaves such a word out
of its feed range too, and so do the inspector's *Feed* row and the hover: the feed in force
stays the feed of the path.

**A dwell is not a feed.** In a dwell block the `F` word is a time — Okuma `G04 F2`,
Sinumerik `G4 F2` — so it is never scaled and not counted as a feed rate; the summary says
how many dwells it left as written.

**Cycles written as calls.** A Sinumerik cycle such as `CYCLE85(…)` or `CYCLE95(…)` carries
its feeds as arguments. They are listed and left as they are. A tapping cycle written that
way stands in a block of its own and has no `F` of its own; the one that can take its lead
from the feed in force (`CYCLE840`, tapping with a compensating chuck and no spindle
encoder, where the feed is the speed times the pitch) leaves that feed exactly as written,
wherever it stands, and says so — and while `MCALL` repeats such a call after every move,
every feed written in between is left too. If your call takes the lead from its own
arguments, scale that feed by hand. A cycle that always takes its lead from its arguments
(`CYCLE84`, `CYCLE99`) changes nothing about the feeds around it.

Feed *mode* is tracked as it goes, out of the dialect's own code database rather than out
of a table in the script: on the Fanuc mill that is `G93`/`G94`/`G95`; on a Fanuc lathe
`G98`/`G99` in G-code system A and `G94`/`G95` in system B; on an Okuma `G94`/`G95`; on a
Sinumerik `G93`/`G94`/`G95`, and there `G96`/`G97` (per revolution) and `G961`/`G971` (per
minute) switch the feed unit too. On a Fanuc lathe, a feed inside the finishing profile of
a `G71`–`G73` roughing cycle is an ordinary feed and is scaled like one; on an Okuma, `G71`
and `G72` are thread cycles and their `F` is a lead. **Fanuc `G63`** (tapping mode) is a
mode of its own, not a cycle: while it is in force — until `G61`, `G62` or `G64` — the
feed is a lead and is left, exactly as inside a tapping cycle.

**An Okuma `E` word that no code of its block, or the cycle in force, declares as a
parameter is reported and left.** LAP's high-speed bar turning cycle makes `E` a contour
feed only inside a finish-contour definition, and `E` can also be a lead or a dwell
elsewhere on this control — reporting it is the one reading that is safe everywhere.

**The limits are compared against real values.** If gEdit can work out what a feed is worth
on this document's [machine](machines.md), your limits and thresholds are compared against
that value, and a feed that has to be clamped is written back in the form the word was
written in. If it cannot — a feed whose reading depends on a machine nobody chose — the
feed is still **scaled** and simply not compared, and the run says which ones those were.
The summary names the machine it worked with, or says that none was chosen and the
dialect's defaults were assumed.

**A selection is read in the state it is really written in.** When you run the script on
part of a program, the lines above the selection are read for their modal state before the
first line it may change, so a `G95`, a `G96` or a tapping cycle set higher up is in force.
The run tells you what it inherited, as an ordinary note on its first line. Started inside a
modal tapping call that repeats (Sinumerik `MCALL CYCLE840`), the selection still leaves the
next tap's lead, because the run knows it is still inside the call.

There is one limit. A very large amount of text above the selection is not sent to the
script — a selection tens of thousands of lines into a program — and the run then says so
with a **warning** instead: it saw only the selection, the modes above it are unknown, and
a thread pitch belonging to a cycle that starts higher up may have been scaled. That
warning is the one case where you should run the command on the whole program, or check
those blocks by hand.

### Scale spindle speeds

The same, for `S`. Leaves alone, and reports, speeds written as a variable and — unless you
ask — speed limits and the speeds of other spindles.

**A tap's speed is left as written, and reported, like its feed.** Feed and speed are tied
by the thread's pitch, so scaling one without the other cuts a different thread. This covers
every speed word of a tapping block — a tapping code of the block itself, a modal tapping
cycle in force (Fanuc `G84`, Sinumerik `G331`…), a tapping mode in force (Fanuc `G63` until
`G61`/`G62`/`G64`), a modal call of a tapping cycle while it repeats (`MCALL CYCLE840`), or a
tapping cycle a keyword defines (Klartext `CYCL DEF 207`) while a call of the database's
`cycle` group that starts nothing runs it (`CYCL CALL`, `M99`, `M89`; a later `CYCL DEF`
under the same keyword, such as another parameter set of 207, does not end it) — plus, for a
tapping block with no speed word of its own, the speed word written last before it, of
whichever spindle. The run counts these speeds and reports "N tapping speeds left as
written"; threading keeps the old behaviour, scaled with a warning, because it is not a tap
in the database's own reading. **Okuma's `G84` and `G88`, and the Fanuc lathe's `G74`, also
keep their speed**: these numbers are a tapping cycle on a machining centre or a mill, even
though on a lathe they are LAP or a face-pecking cycle, and the pitch ties speed to feed
there too. A speed-only block under a modal tap — `S900` with no move — is treated as an
ordinary speed and scaled, and counted as the last speed written, so the next tap that runs
with no `S` of its own still leaves the right one.

**Constant surface speeds** (`G96`) are a three-way choice like the per-revolution feeds:
**Also scale constant surface speeds**, automatically, yes or no. Under `G96` the `S` word
is a surface speed in metres or feet per minute, not revolutions per minute, so scaling it
is a different decision from scaling an rpm — and one you should make deliberately.
**Automatically** scales them on a turning dialect, where nearly every cut is one, and
leaves them alone, and reports them, on a milling one. On Sinumerik, `SVC=` and `SVC[n]=`
follow the same choice: the tool's cutting speed on the master spindle, or the spindle the
index names.

**A Klartext cutting speed is read too.** `VC:120` (behind `FUNCTION TURNDATA SPIN VCONST:ON`)
is the cutting speed of the tool, a constant surface speed like `SVC=`: it follows the
**Also scale constant surface speeds** choice. *Automatically* leaves it alone on the milling
Klartext profile and says so (*VC:120 is the cutting speed of the tool (VC), so it is not
scaled.*); with *yes* it is scaled (`VC:120` at 120 % is `VC:144`), and the `VC:` stays.

**A speed limit is not a speed.** The `S` of the block that clamps the top speed for
constant surface speed — `G50 S` on a Fanuc lathe in G-code system A and on an Okuma,
`G92 S` in system B, `G26 S` on a Sinumerik — is left alone by default and reported, and so is a clamp written as a word of its own (`LIMS=3000`,
`LIMS[2]=1800`). In such a block every speed word is a limit, the ones for other spindles
included (`G26 S3000 S2=2000`). Which code or word that is comes from the dialect's code
database and profile, so the script is right on every dialect without knowing any of them.
The Sinumerik `G25 S` is the **lowest** speed, not a clamp: it is never scaled, with "Also
scale spindle speed limits" or without it, and it is still counted as a limit left as written. A word
with an index — `S[2]=500`, `LIMS[2]=1800` — belongs to the spindle the index names: it is
never the main spindle's speed in force and never the main clamp.

**Other spindles are left alone unless you ask.** On a Sinumerik program, gEdit's main
spindle is spindle 1: a plain `S` while spindle 1 is the master (the default, `SETMS`, or
`SETMS(1)`), and `S1=`, are scaled by default; on a Fanuc lathe or an Okuma the master
spindle's plain `S` is scaled the same way. A speed written with an address of its own —
`SB=2000` for a driven tool, `S3=2400` for spindle 3, `S[SPI]=2400` for the spindle whose
number is in `SPI` — is reported and left, and so is a plain `S` while the program has made
another spindle the master (`SETMS(2)` on a Sinumerik, `G141` on an Okuma — the sub spindle
question there still needs the project's answer), because the script cannot tell which
spindle is your main one otherwise. **Also scale other spindles** scales them with the rest.
The `S` of a dwell is never a speed (`G4 S2` waits two spindle revolutions), and neither is
a word the dialect lists as an angle (the start angle `SF=` of a thread).

**Cycles written as calls** carry their speeds as arguments (the tapping speed of
`CYCLE84(…)`); they are listed and left as they are.

A value written with a Klartext decimal comma is scaled and written back with its comma,
like a feed.

Defaults to whole numbers, which is what nearly every control wants. A selection is primed
from the lines above it in exactly the same way, and warns in exactly the same case. If a
selection ends with a speed that is still in force at its last line and was itself scaled,
an **info** note on that line says so: the lines below the selection were not read, so a
tapping or threading block further down that runs at this speed may have had its lead
written for the old one. Run the command on the whole program, or check those blocks by
hand, when this note appears.

### Tool list

One row per tool, in order of first use: the tool, the comment that describes it, the line
of its first call, how many times it is called, and — unless you switch it off — the range
of feeds and speeds each tool is used with. Click a row to jump to the call.

On a Fanuc or Okuma turning program it lists the **turret stations**, and an extra column
shows the offsets each station was called with (`01, 11`) — so a station used with two
different offsets is one row and tells you both. On a Fanuc lathe, `T0100` (and, with no
machine, the five-digit `T12000`; on a 3 + 2 machine `T12300`), which cancels the offset rather
than changing the tool, is not a call, unless the block also writes `M6` (`M06 T21000` loads
tool 21); a `T` in a block with a three-digit `G` code (`G183 Z-5. T5 F20`) is not a call
either; on an Okuma, `T0100` is station 1 with offset 00, and only station `00` (`T0001`) is
no tool. A six-digit Okuma `T010203` is nose-radius set 01, station 02 and offset 03, and a
`T` inside a cycle block only switches the offset. A Sinumerik `T` carries no offset, so its
list has no such column. On a Fanuc mill, `T0` followed by `M6` is an unload — no tool T0 —
even when the two are on separate lines.

On a Sinumerik milling program the tool is the `T` before `M6`, or, on a machine set to
change the tool by `T` alone, every `T`
([Machines](machines.md#sinumerik-diameter-programming-and-the-rest)). A Klartext
`TOOL CALL "END MILL 10"` with the name at the end of the line, or with a digit straight behind it, is read like one with more
words behind it; a tool number with more than one decimal is read as its whole number.

A Klartext `TOOL CALL` of the tool already in the spindle, written with no axis, is a speed
change rather than a second call: only a `TOOL CALL` that names a different tool, or names
the axis (a possible sister-tool swap on the same number), counts as a change and moves the
list on.

A range of constant surface speeds shows its unit and the code that set it, `220 m/min (G96)`
or `150 m/min (G961)` (`ft/min` in an inch program); a range of spindle speeds in rpm carries
no mark. A feed after a Sinumerik `G931` is a travel time and is left out of the feed range
with a note.

A speed or feed written **before** the turret indexes (`G97 S1500 M03`, then `T0202`)
belongs to the new tool: a value counts for the tool that moves next. A dwell is in no range,
and neither is a driven tool's `SB=` or a numbered spindle's `S3=`: the speed column is the
plain `S` of the main spindle, so a driven tool shows no speed of its own.

A range is in one unit: the one the control starts in — per revolution on a lathe, marked
`/rev` — or, for a tool with no value in that unit, the one it has (`/tooth` and `surface`
are marked as well; per minute and rpm carry no mark). A value in another unit is left out
of the range and listed under the table, and so are thread pitches and speed limits. A
Klartext value written with a decimal comma is read and shown the same as any other.

A tool named in quotation marks is a name, whatever it is made of: `T="007"` and tool
number 7 are two rows, and a name keeps its zeros and, when it is all digits, its quotation
marks.

Where the description comes from is a parameter — the dialect's rule; the end of the call
line, else above, else below; or only the lines above, the lines below or the end of the
call line — and a numbered tool without one takes it from a tool list comment elsewhere in
the program (`(T5 D12 FLAT END MILL)`), the first such line for each number. Another
parameter decides whether the list writes `T1` or `T01` (as the first call wrote it);
`T01` and `T1` are always the same tool.

If a program has `T` words but no tool change at all, the list says so rather than coming
back silently empty. On a milling dialect that usually means the program is really a turning
program opened with a mill profile — switch the dialect in the status bar.

**On a program with channels** (a machine with [channel settings](channels.md)), and a
program that holds several channels in one file, the rows are grouped by channel. A
**Channel** column comes first, and the summary names the channels. A channel that has
several sections gets its rows from all of them, in program order. A tool called on lines
that belong to no channel (a shared subprogram, for instance) is listed last, under
**Outside the channels**; with no such tool there is no such group. With **one file for each channel** the list is for the
file in front of you. The summary names its channel and says that the others are separate
runs. A single list over several channel files is not possible, because a script sees one
document ([Channels in a script](#channels-in-a-script)). A program without channels gives
the list described above, unchanged.

### Program checks

Lists what a program does that the control or the machine will not like, before the
program goes to the machine. It changes nothing: the result is a table in the **Results**
panel, one row per finding, in line order, with the line, the check, a severity and the
finding. Click a row to jump to the line.

It is **a reading of the text, not a simulation**. It does not know where the tool is, what
the stock looks like or whether the tool fits the hole; it finds what a program says about
itself that cannot be right. A check that cries wolf on a correct program is worse than no
check, so each one is driven by the dialect, the code database and the machine, never by a
guess about what your post usually writes, and where a check cannot judge it says nothing
rather than flag every line.

| Severity | Means |
|---|---|
| **Error** | The control refuses the program, or it is broken where it stands: an unclosed comment, a `G70` target that is not there, code after the end |
| **Warning** | Almost certainly not what was meant: a cut with the spindle stopped |
| **Info** | A list you asked for (every stop), or a reading to confirm (the machine reading, lower case) |

Every check is a tick box on the form, all on; clear one and its rows go. A check whose
data the dialect does not have is not run; the general checks run on every dialect.

| Check | Severity | What it finds |
|---|---|---|
| **Program frame** | error, warning | A program that runs into the next start marker or the closing `%` with no end code; code after the end or after the closing `%`, which never runs; the end written twice; a tape with only one `%`. Also a file that stops short: a Klartext program with no `END PGM`, or with an `END PGM` that names another program than its `BEGIN PGM`; a Sinumerik main program (`.MPF`, or no header) that has no `M30`, `M2`, `M17` or `RET` anywhere. One row, on the last line. A Sinumerik subprogram (`.SPF`, `_SPF` or `PROC`, or a file whose first line is a commented subprogram header `;%_N_<name>_SPF`) is not judged, because it may end at its last block; nor is an untitled document, a main program whose last block is an unconditional jump (`GOTOB`, `GOTOF`, `GOTO`), or the data section of an archive (`%_N_<n>_<m>_MPF`, `<m>` not 0) |
| **Spindle** | warning | A cut while the spindle is stopped (the row names the code that stopped it; a Klartext `L` with no coordinate word is no cut, and the words of a cycle definition written behind a bare `L`, such as `L CYCL DEF 32.1 T0.05`, are not read as a move), or a cut before the program starts a spindle. The second is reported only in a program that starts a spindle somewhere, because a subprogram runs under its caller's spindle |
| **Spindle after tool change** | warning | The first cut after a tool change with no spindle start in between. Only on a machining centre, whose tool change stops the spindle; a turret does not |
| **Tool change in a cycle** | warning | A tool change while a modal cycle, or a modal call such as `MCALL` or Klartext `M89`, is in force |
| **Pass repeated** | warning | Fanuc lathe, G-code system A or B: a block that moves nothing while a single pass (`G90`, `G92`, `G94`; system B `G77`, `G78`, `G79`) is in force. The control runs that pass again in such a block: an empty block, a line with a comment only, a block with only `M`, `S` or `T` words, a block with only an `F` word or only a modal `G` code (`G40`, `G97`, `G99`, `G96 S200`). A blank line counts as an empty block. A dwell (`G04`), a one-shot code (`G50 S`, `G28`) and a block with a word gEdit does not know do not. Not checked on an Okuma, whose fixed thread cycles `G31` to `G33` are not run again by a block without a move. Write `G00` or `G01` first. |
| **G-code system** | warning | Fanuc lathe: a block written the way G-code system C writes it (`G70` or `G71` alone for inch or metric input, `G20`, `G21` or `G24` with a position and a feed). gEdit reads systems A and B only, so the check says once per program that the program may be written in system C. It is a hint in this check and not a choice of the machine: gEdit has no system C to choose, so it cannot say so when the file is opened |
| **Offset cancel** | warning | Lathe: a cut after a lone tool word that cancels the offset (`T0100`) and before the next tool call |
| **Speed after tapping** | error | Sinumerik: a cut after leaving a tapping move that sets the speed to zero (`G331`, `G332`) with no new speed |
| **Speed clamp** | warning | Constant surface speed with no spindle-speed limit earlier in the program (once per program) |
| **Spindle speed limit** | warning | A spindle speed above the top speed set for the machine, or a speed clamp (`G50 S`, `LIMS=`) above it. Needs the machine's **Top spindle speed** (Motion and limits, [Machines](machines.md#motion-and-limits)). See below |
| **Travel** | error, warning | An absolute axis position outside the travel set for the machine: an error in machine coordinates; a warning, once per axis, when the positions in work coordinates span more than the travel. Needs the machine's **Travel**. See below |
| **Thread under surface speed** | warning | A thread cut under constant surface speed (once per stretch of it) |
| **Refused in this state** | warning | A code written in a state the control refuses it in. Examples: `G28` or `G53` under tool centre point control, a tilted working plane under compensation or inside another frame, Klartext `TOOL CALL` or `M91` while `M128` is on, Sinumerik `G75` under radius compensation, Okuma `G140` under constant surface speed, Okuma `M100` while radius compensation (`G41`, `G42`) is on |
| **Missing word** | error | A code whose block lacks the word the control needs with it: Klartext `PLANE` without `MOVE`, `TURN` or `STAY`, Okuma `G96` without `S`. Not on a line your machine's channel settings count as a wait code: a wait such as `M198` written without `P` is judged by the Channels settings, not here |
| **Alone in its block** | error | A code that has to stand in a block of its own does not: Fanuc `G53.1` and a `G65` macro call (its arguments may follow it, nothing may stand in front), Okuma `M110`. Not on a wait-code line of the machine's channels either |
| **Rigid tapping** | error | A speed word or a move between the rigid-tapping call (`M29`) and its cycle, or the call inside a running tapping cycle. `M29` counts as a tapping call only when a tapping cycle follows it, so on a lathe where that M number means something else nothing is reported |
| **Cycle call** | error | A cycle call with no cycle defined before it. A Klartext definition the database does not know still counts as a definition, so nothing is reported after one |
| **Modal call** | warning | A modal call still in force at the end of the program |
| **Control language** | warning | A code that switches the control to its ISO dialect (Sinumerik `G291`) |
| **Profile targets** | error | Lathe: the `P` and `Q` blocks of a roughing or finishing cycle missing, or `P` after `Q` |
| **Call in a profile** | error | Lathe: a subprogram call inside such a `P` to `Q` profile |
| **Jump target** | error, warning | A jump to a block or label that is not in the program; a target written on two lines; `GOTOF` to a label above, `GOTOB` to one below. A jump to a name that no label has but that begins labels which exist (`GOTOF TOOL` over `TOOL_1_0:`) is a string variable the check cannot see, and is not reported. A target that is worked out while the program runs (`GOTOF "STEP_"<<COUNTER`, `GOTOF R10`) is not judged either |
| **DO and END** | error | Loop numbers outside 1 to 3, an `END` with no `DO`, loops that cross, a `DO` never ended |
| **Words in a block** | error | Two speed words or two tool words in one block; more M codes than the control takes (Okuma: eight). Two `T` words with an `M6` (`N20 T7 T8 M6`, the tool in the spindle and the one to fetch) are fine on a milling profile, and so are the words of a message |
| **Tool word** | warning | A tool word the machine's tool-word format does not describe, and tool words of different lengths in one file. Only where the machine itself states the format. An Okuma machine set to *Three-digit offsets* states it, so a six-digit `T010101` is reported there: it is no tool change under that reading |
| **Program name** | error | A program name that shares its block with other words |
| **Sequence name** | error | A sequence name or block number with no space or tab behind it |
| **Digits** | error | A word with more digits than the control stores (Fanuc: eight), once converted to increments, under every reading the machine or the presets allow |
| **Machine reading** | info | A dimension word without a decimal point whose value depends on how the machine reads numbers, see below |
| **Tape marker** | error | A `%` inside a comment, which ends the program when the tape is read in. Not on Klartext, which has no tape marker: `; INPUT 50...150 %` is fine |
| **Comment** | error | A comment opened and not closed on its line |
| **Brackets** | error | Brackets or quotes that are not balanced in a block, or a `)` with no `(`. An unclosed string or `[` runs to the end of its line, so a comment behind it is read as part of it: *a string is opened with " and not closed on its line*, *a [ is opened and not closed on its line*, and on Sinumerik *a ( is opened and not closed on its line* |
| **Lower case** | info | Lower-case addresses outside comments and strings, on a control that reads upper case |
| **Characters** | warning, error | Characters outside ASCII outside comments (warning); blocks longer than the control takes (error) |
| **Stop** | info | Every program stop and optional stop, as a list |

**Small things that are not findings.** `F MAX` written apart is the rapid word `FMAX` and
not a feed. A thread cycle that carries a tool word starts the cycle, and `G80 T2 M6` ends
it, so neither is a tool change inside one. The blocks that describe an Okuma LAP shape are
not cuts.

**The decimal-point finding.** `X50` is 50 mm on one control and 0.050 mm on the next
([Machines](machines.md)). **Machine reading** names the words whose value depends on that:

- With a machine whose numbers are **increments**, one row per such word says what it is
  read as on that machine ("0.050 mm on machine 'Lathe 2'") and what it would be with a
  point.
- With a machine that uses **calculator-type input**, or an Okuma **unit system**, no row:
  the machine reads every literal one way.
- With **no machine**, the rows list the readings of the dialect's presets, the assumed one
  first. On Fanuc that is one row per number without a point; on Okuma it is one row for
  the whole program, because every number there depends on the unit system. The report
  says "No machine chosen" and the way out is to choose one.

It is information and not a warning, so that a post which writes no points does not drown
the report. The tool direction `I`, `J`, `K` under Fanuc `G43.5`, `G41.6` and `G42.6` (until
`G49` or `G40`) is a count that every machine reads alike, so it is not read as a length and
gets no row.

**The machine's limits.** Spindle speed limit and Travel read the **Limits** of the machine
([Machines](machines.md#motion-and-limits)) and nothing else: no machine, or no limit set,
and they say nothing, like every check whose data is missing. Where a machine is chosen but
lacks a value the program needs (no top speed for a spindle it uses, no travel for an axis it
positions), the report says so once in a note instead of guessing.

- **Spindle speed limit** compares a speed in rpm with the top speed of its spindle: the
  plain `S` word with the main spindle's, `S2=` and the like with their own, and a clamp
  above it. A speed under constant surface speed is no rpm and is not compared; neither is
  a dwell's number of revolutions. Where the dialect has a code for rpm (`G97` on Fanuc), a speed written before the program says which unit it is in is read as rpm, and its
  row says so. A dialect with no such code (Klartext, where the speed is always rpm) has no
  such row. The control would hold the spindle at its top
  speed or stop; the check names what you wrote.
- **Travel** compares an absolute position with the lowest and highest position of its
  axis. A word in machine coordinates (`G53`, `G28`, `SUPA`, `M91`) is an **error**: the
  control will refuse it. The work offset of a word in work coordinates is not known, so one
  position says nothing: it may be fine. What can be told is the **span**. If the lowest and
  the highest position of an axis in the program are further apart than the travel of that axis,
  no work offset brings them all inside, and the check gives one **warning** for the axis, on the
  line where the span first grows past the travel. The message names the lowest and the highest
  position with their lines. A
  position is converted to the unit of the travel. On a lathe, the travel of **X is a
  diameter**, as the program writes it. Incremental words, words the machine reads
  differently, positions under a tilted or turned frame or tool centre point control, and the
  blocks of a contour definition are not compared; a stretch where the distance mode is not
  known is compared only where the program sets it, and a note says so.

**A selection** is read together with the lines above it, so the spindle, the cycle and the
other state at its first line are right. Some checks need the whole program, the program
frame and the jump and profile targets among them, and the report says so in a note when
you run on a selection.

**What it does not check, and why.**

- Okuma `G136` alone in its block, and the first blocks after `G137`: the manual states
  them for ending a conversion, and a post may write `G136 M109`; no rule says
  that is wrong.
- A code a Heidenhain TNC 640 refuses (`M104`, `FN 15`, cycles 1 to 6): which codes it
  refuses depends on a setting of the control generation, which the machine configuration
  does not have.
- The two-turret rules of Okuma (the `P` codes, `M100`, the spindle commands at a `P` code): a
  two-turret program is two channels, and
  [Check Wait Codes](channels.md#the-okuma-p-codes-and-m100) judges them.
- The Fanuc lathe's `G69` ending a tilted plane instead of `G69.1`, and `G53.1` standing
  directly after `G68.2`.

**Long reports are cut at 5,000 rows.** Errors are kept first, then warnings, then
information; what is kept stays in line order, and a note says how many were left out. An
error on the last line of a very long program is still there.

**It takes time on a long program.** Tokenizing and following the modal state are most of
the cost: a 300,000-line program takes about a minute on a busy machine, roughly a third
less than before the tokenizer was made faster. The three
scripts of this section ask for 300 seconds in their headers, which wins over
`Settings ▸ Scripts ▸ Script timeout`.

### Extents

The smallest and largest value of every axis, for the whole program, for each work offset
and for each tool. Also a table in the **Results** panel; click a row to jump to the line
of the largest value. It reads the program and changes nothing.

| Column | |
|---|---|
| **Where** | The program, a work offset (`G55 (line 14)`), a tool inside it (`G55, T2 (line 15)`), or a machine position |
| **Axis** | `X`, `Y`, `Z` and the rotary axes. On a **turning** dialect the X column is `X (diameter)`, see below |
| **Min**, **Max** and their lines | In the program's units, rounded to 0.0001 mm (0.00001 inch, 0.0001 degree) |
| **Not resolved** | How many positions of this axis in this scope could not be worked out |

Everything is in **effective values**: a word is converted by the way the machine reads
it, so a program that switches between millimetres and inches does not mix the two, and an
incremental move (`G91`, `U`/`W` on a lathe, a Klartext `I` prefix, a Sinumerik `IC()`) is
added to where the tool was. **Arcs count**: the largest and smallest values on a circle
are found from its centre or radius in the plane in force, so the bulge of an arc is in the
range and not only its end point.

**One X column on a lathe.** Every `X` is turned into a diameter, so a program that
switches between diameter and radius programming (`DIAMON`, `DIAMOF`) never mixes the two
in one minimum or maximum. A word written as a radius counts double. The message above the
table says which mode the program starts in and where that came from: the dialect, the
machine, or the program. A milling dialect keeps a plain `X`, in which a diameter word
counts half.

**Machine positions** (`G28`, `G30`, `G53`, `M91`, `M92`, Sinumerik `SUPA`) are listed in
rows of their own and never enter a range: they are places on the machine, not on the
part. The axes they moved are in an unknown place afterwards, which matters to a later
incremental move.

**Tool centre point control.** Under `G43.4`, `G43.5`, `M128`, `FUNCTION TCPM` or `TRAORI`
the `X`, `Y` and `Z` are the tool tip in the workpiece, and they are in the ranges.

**Work offsets and shifts.** A change of work offset starts a new group. So does a shift
written over it (a local shift `G52`, `G92`, Sinumerik `TRANS`), and the group is named for
both (`G54 + G52 (line 8)`), because the positions after it are in another system than
those before. A speed clamp such as `G50 S2000` is not a shift.

**"Not resolved"** means gEdit would have had to guess, so it counted instead. The
findings under the table say which and why, once per kind:

- **No machine is chosen**, and the dialect's presets read the word differently.
- A **variable** or an expression (`X#101`, `Z+Q5`).
- A position inside a **tilted plane, a rotation, a mirror, a scaling, `TRANSMIT`, polar
  coordinates (`G16`) or polar interpolation**: its numbers are not coordinates of the
  workpiece.
- A position written while a **rotary axis that turns it stands turned**, or at an angle
  nobody knows, with tool centre point control off: it is a position of the machine's axes
  (see [the rotary rule](#rotary-axes-and-tool-centre-point-control)).
- An **incremental move from an unknown start**: the first one of a run, or one after a
  machine position, a cycle, a shift or a value that was not resolved. A Fanuc `G10 L1`,
  `L10` to `L13` writes a tool offset and no coordinate system, so the positions stay known
  after it; any other `G10` (a work offset `L2`, `L20`, or one without `L`) is a setting.
- **A cycle that [Expand Drilling Cycles](#expand-drilling-cycles) refuses**, and a cycle
  gEdit has no description of (Klartext `203`, a tapping cycle): a depth that is a distance
  from another parameter would show a place the cycle may never reach, so it is counted
  as not resolved. On Fanuc such a cycle's bottom is its `Z` word under `G90`; under `G91`
  that word is measured from the R point, so it is not resolved. A cycle that expands is not
  in this list: see below.
- **Lathe roughing passes** (`G71` to `G73`): the control works the passes out.
- An **arc it cannot compute** (Klartext `CT`, `CIP`, a centre written as a variable, a
  radius shorter than half the chord, an Okuma arc by radius `L`).
- A **code the database does not know** under the move letter, because it may hide a
  machine position or a frame.

Klartext polar moves are worked out from the pole `CC`; with no pole, or no radius or angle
to start from, they are not resolved. Blocks whose words are values and not positions
(`G92`, `G52`, the `X` of a dwell, `CYCL DEF 7`, `BLK FORM`) are left out of the ranges and
listed once per code.

**A single pass of a lathe cycle** (`G90`, `G92`, `G94`; system B `G77`, `G78`, `G79`)
cuts to the point it writes and goes back to where it started, so the tool stands at the
start afterwards and an incremental move of the next pass counts from there. With a taper
`R` the first move of the pass goes to the end plus `R` along the axis `R` lies along: X for
`G90` and `G92` (`R` is a radius, so twice it in the diameter column), Z for `G94`. That
taper start is in the ranges. `X`, `Z` and `R` stay for the passes that follow until a
block writes them again, a block with only `R` runs the pass again, and a one-shot code
other than a dwell or a plane code ends them. A taper that cannot be read (no machine
chosen, a variable) is counted as not resolved, and so is the taper start of a pass that
does not write `R` after a subprogram call (`M98`), a macro call (`G65`) or the start of a
second program in the file: the called program may have written a taper. Whether a `G00` or
`G01` ends them on your control is not known yet; the extents keep `R` and do not trust the
end point. A pass that carries an `I` or a `K` (the taper of the older Series 15 tape
format, or the thread taper of an Okuma `G31` to `G33`) is not read for its taper: the
start of such a pass is counted as not resolved.

**Okuma `G31`, `G32` and `G33`** are fixed thread cycles: one block cuts one pass and the
tool returns to where it started, as for the Fanuc single passes, and a block with a new `X`
cuts the next pass. Their end point is in the ranges; the tapered start is not worked out
(the sign of `I` says rising or falling on an Okuma, and the Fanuc rule for `R` does not
apply). `K` (`G31`, `G33`) and `I` (`G32`) shift the start of the thread along its own axis,
and only that axis is counted as not resolved; the start shift is read for the block it is
written in. `E` is the change of the lead. `C` is the phase shift of the start for a thread
with several starts: it is an angle and no move of the C axis, so the extents do not move
the tool for it.

**Drilling cycles reach their depths.** A drilling, peck or boring cycle that [Expand
Drilling Cycles](#expand-drilling-cycles) can write out is read the way it would be written:
the depth is measured **from the surface**, so a Klartext `200` with `Q203` and `Q201`, or
a Sinumerik `CYCLE81` with `RFP` and `DPR`, reaches the place the drill reaches. So do the
set-up clearance, the return level, every hole of a repeat count and the point of a
`CYCL CALL POS`. The extents of a program and of its expansion are the same. On **Fanuc**
under `G91`, the `Z` word of a cycle block is the depth from the R point, and the R point
is measured from the initial level, so the word is no step from where the tool stood: the
depth is worked out from the holes. `K` is the number of holes, each one the plane
increment further under `G91`; `K0` drills none and moves nothing. The two peck values do not matter here, because they shape the moves between the
R point and the bottom and never a level outside them: the extents do not ask for them.

A subprogram call is not followed: the called blocks are read where they stand in the
file. A selection is read with the lines above it, as in the program checks.

### Expand Drilling Cycles

Replaces the drilling, peck drilling and boring cycles of a **milling** program with the
plain moves they make, so that the program can be read, checked, timed or run on a control
that does not have the cycle. For each hole it writes the rapid move to the start, the feed
move to the depth (in one go or in pecks), the dwell, and the way out. It is **all or
nothing**: if one cycle cannot be written out safely, nothing is changed and every cycle
that stopped it is listed with its line and its reason.

| Dialect | Cycles it writes out |
|---|---|
| **Fanuc mill** | `G73`, `G81`, `G82`, `G83`, `G85`, `G86`, `G89` |
| **Heidenhain Klartext** | cycles `200` (drilling) and `201` (reaming), called with `M99`, `CYCL CALL` or `CYCL CALL POS` |
| **Sinumerik** | `CYCLE81`, `CYCLE82`, `CYCLE83` (with `VARI=1`), `CYCLE85`, `CYCLE86`, `CYCLE89`, also under `MCALL` |

**What it writes.** On Fanuc, a cycle block and every block that runs the cycle again
become the moves of the hole: the rapid to the position, the move to the R point, the
feed to the bottom and the way out. A word of the block that is not the cycle's (an `M`, an
`S`, a comment, the block number) stays on the first written block. `G80`, `G98` and
`G99` stay as written, and the next block that needs the feed or the motion mode the cycle
left in force gets it written back. A block that moves on its own whatever the mode in force
(Fanuc `G28` and `G53`, Sinumerik `G74` and `G75`) does not get it; the next block that moves
does. On Klartext the cycle definition stays as written (it
does nothing without a call) and the call is replaced by the moves; the program is
renumbered from there to `END PGM`, because Klartext numbers every block. On Sinumerik
the `CYCLE…(…)` line becomes the moves; under `MCALL` the positions stay and the moves follow
each, and the `MCALL CYCLE…` line itself leaves. A motion code (`G0`, `G1`) is written only
where the mode in force is not the one the move needs, moves follow the distance mode in
force (`G90`/`G91`), and a number is written the way the cycle writes its own words. A
computed number gets the decimals of the longest word of the cycle. Nothing is rounded: a
value that does not fit its word refuses the cycle.

**The pecks.** A peck depth is measured from the surface of the hole, which on Fanuc is the
R point, in Klartext `Q203` and on Sinumerik the reference plane. Two values of a
peck cycle are settings of the control and not of the program: how far a high-speed peck
cycle (`G73`) pulls back between pecks, and how far above the last depth a deep peck cycle
(`G83`) comes back down at rapid. The form asks for both. They are **prefilled from the
machine's Motion data** ([Machines](machines.md#motion-and-limits)) and you can change them
for the run. A program with such a cycle and an empty field is refused.

The field **Units of the peck values** (mm or inch) says in which unit the two values are
written. It is prefilled from the machine's units in Motion data. When the unit differs from
the unit of the program at the cycle, the values are converted (by 25.4, exactly). A value
that does not convert to a number the cycle's words can hold is refused, never rounded.
Left empty, the values are read in the units of the program.

**What it refuses**, each with a reason in the finding:

- **Tapping and thread cycles**, an oriented bore `G76`, a back bore `G87`, a manual-return
  `G88`, and any cycle gEdit has no description of. Klartext `203` (its full retract runs at
  its own feed) and `CYCLE83` with `VARI=0` are two of these on purpose: their moves are
  not plain ones.
- **A word the cycle does not know.** A Fanuc cycle block is refused when it carries an
  address word that is not a code, an `M`, `S`, `T` or `F` word, a block number or a
  parameter of that very cycle. Writing it out would put the stray word on a rapid move.
  Two cases are known: the `I` of the small-hole peck mode of `G83` (a mode set by an M code
  of the machine), and the `,D` of `G73` and `G83`, the clearance of newer controls (`G83 …
  Q5. ,D1.5`). gEdit does not read `,D` yet, so the block is refused and the value from the
  form is never used instead.
- **A return level that is only assumed.** A Fanuc cycle returns to the initial level
  after `G98` and to the R point after `G99`. If neither the program nor the machine's power-on
  codes say which is in force, the cycle is refused as *the return level is only assumed*:
  the two write different moves, and a wrong guess would put the tool somewhere else. Write
  `G98` or `G99`, or set the machine's power-on codes.
- **An unknown distance mode** for the same reason, a cycle under radius compensation, in
  another plane than XY, or in a tilted or turned frame, and a tool level that is not
  known where the cycle starts.
- **A value the cycle needs that is missing.** On Sinumerik an argument left empty is
  refused (*a value the cycle needs is not written and has no default*), although the control
  would read the empty argument as 0: gEdit does not guess on a cycle that moves a tool. A
  Klartext `201` with a retract feed `Q208` of 0 is read as the plunging feed `Q206`, as the
  manual says; a plunging feed `Q206` of 0 (a feed of 0 or less) is refused.
- **A value that is a variable or a calculation**, a value that changes how the cycle moves
  beyond its default (a feed factor, a display mode), and a value whose reading depends on the
  machine when no machine is chosen.
- **A call, a jump, a loop or a pattern while a cycle is in force.** A subprogram call
  (`M98`, `G65`, `CALL`, `CALL LBL`), a jump or a loop (`GOTO`, `IF`, `WHILE`) or a pattern
  cycle such as `HOLES1(…)` in a block that runs a cycle, or in a block under a cycle that
  stays in force (a Fanuc cycle, a Sinumerik `MCALL`, a Klartext `M89`): the control would run
  the cycle at the places the subprogram or the pattern gives, which gEdit does not follow.
- **Blocks under `MCALL` that run the cycle without a position.** A block that writes only a
  feed or a spindle speed while `G0` or `G1` is in force, or only `G0`/`G1`, runs the cycle
  again on the control; written out, the hole would be missing.
- **A block skip (`/`)** on a cycle block, on a line that holds cycle data (a definition, a
  Fanuc drilling-data line), on a cancel or return mode while a cycle is in force, or on a block
  that gets the motion code or the feed back from the cycle. Written out, the plain moves would
  not be skipped the same way.
- **`K0` with a position** (Fanuc): the manual does not say whether the control still goes to
  the position. `K0` without a position is not refused: the control stores the values and
  drills nothing, so the block stays as written, block number and all, and an information row
  says so. The first move written after it carries `G0` and the feed, which ends the cycle on
  the control as `G80` does.
  A **repeat count above 9999** is refused as well.
- **`G86` under any spindle code but `M3`.** The manual does not say which way the spindle
  restarts after the stop, so `G86` is written out only while the clockwise spindle code
  (`M3`) is in force. Under `M4`, or any other running-spindle code, it is refused
  (*variant-unknown*, "M4 in force"), and so it is when no spindle direction is known at the
  cycle (*value missing*, "the spindle direction in force").
- **`G43`, `G44` or `G49` in a cycle block.** A tool length offset in the block of the cycle
  is refused, because it changes the levels the cycle uses.
- **Levels and depths that cannot be right.** A set-up clearance or a return distance below
  0; a return level that is not above the surface; a depth of 0 and no other depth; a signed
  relative depth above 0 (the bottom would not be below the start); a missing `SDIR` on a
  Sinumerik `CYCLE86`.
- **A motion code that is not known before the cycle.** If the code in force before the cycle
  is not known, it could not be written back after it.
- **A Klartext call on a pattern** (`CYCL CALL PAT`) and a call from below the surface
  (the control would go to a safe height first, which the cycle does not give). `CYCL CALL POS`
  from above the surface is written out: the tool goes to the point of the call in the plane
  first, and a tool-axis value in the call shifts the surface of the cycle. The `F` of a
  `CYCL CALL POS` is the feed of the move to that point for **its own block only**: the next
  block runs at the feed in force before the call.
- **A selection that cuts a cycle** (its values above the selection, or blocks that run it
  below), a cycle whose mode would have to be restored below the selection, and a Klartext
  selection that does not reach `END PGM` (the blocks below would need new numbers).

**Turning programs** are refused whole: the drilling cycles are written out on milling
programs only.

**Undo.** The program is replaced in one step, so one undo takes it back.

Under `CYCLE83` a further-peck reduction `_DAM` of 0 is read as no reduction. A
`CYCLE83` whose first retract `_DIS1` is 0 (the control works the distance out itself) is
refused. The newer arguments of `CYCLE82` (`_VARI`, `S_ZA`, `S_FA`, `S_ZD`, `S_FD`) are
accepted only when they are 0 or left out; any other value is refused until gEdit knows
what they do.

**The way out of `CYCLE86`.** The control brings the tool back to the centre of the hole
as part of its move up to the return plane. gEdit writes the move to the centre at the
safety distance above the surface first and then the rapid up to the return plane. Both
end at the same point, so the program is the same where it counts; the path between is not
the control's, so do not use the written-out moves to judge clearance beside a wall.

The expansion is also what the other scripts read: the [time estimate](#statistics-and-time)
times the same moves, and [Extents](#extents) counts the depths of the holes.

### Statistics and Time

How long a program runs and how far it moves: the feed length and the rapid length per tool
(per channel where the program has channels), the tool changes, and a time estimate from
the machine's **Motion data** ([Machines](machines.md#motion-and-limits)). It opens a table
in a new document, or comma-separated values for a spreadsheet, and changes nothing. The
form takes the rapid rates of X, Y and Z (and A, B, C in degrees per minute where the
program turns them at rapid), the kind of rapid move, the top cutting feed, the tool-change
time and the two peck values; every field is prefilled from the machine and can be changed
for one run.

| Column | |
|---|---|
| **Feed length**, **Rapid length** | Always given, in the program's units |
| **Tool changes** | One per tool the program loads |
| **Feed time**, **Rapid time**, **Dwell time**, **Tool-change time** | The time of each kind; a dwell counts as written (seconds, revolutions at the speed in force, or the lines of a Klartext dwell) |
| **Total time** | The four times together |
| **Not estimated** | The blocks the estimate leaves out, with their lines |

**Never a number gEdit made up.** The lengths are always there. A time needs a value of the
machine: a rapid time needs the rapid rates of the axes that move, a tool-change time the
tool-change time. Where the machine does not give it, the cell says **not set**, a finding
names the missing value, and the total says **not set** too. A field left empty is never
replaced by a typical one. Fill the machine's Motion data in once and the form is ready.

**How a move is timed.**

- A **feed move** takes its length divided by its feed, at 100 %. A feed above the top
  cutting feed is timed at the top feed, and the message counts those moves. A feed per
  revolution is multiplied by the spindle speed in force. Under **constant surface speed**
  (`G96`) the speed follows the diameter along the move, held by the clamp in force
  (`G50 S`, `LIMS=`) or else by the machine's top spindle speed; the move is split where the
  clamp starts to hold. A move in inverse time (`G93`) takes 1 / F minutes. On Sinumerik `G931`
  (a feed given as the **travel time**) a block takes F seconds as written; if the length
  divided by that time is above the top feed, the move takes the length divided by the top
  feed instead.
- A **rapid move**, "Straight", moves all axes on one line at the rate of the slowest axis that
  moves: the longer, safer estimate. "Each axis at its own rate" takes the longest of
  each axis's distance divided by its rate. A rapid kind left empty is read as straight, and
  the message says so.
- A **drilling cycle** is timed move by move, the very moves [Expand Drilling Cycles](#expand-drilling-cycles)
  would write, so the estimate of a program and the estimate of its expansion agree. The two
  peck values and their units come from the form.

**Not estimated.** A block the estimate cannot time is never guessed: it is counted with its
line, in the table and as a finding. The kinds: a cycle the control works out the passes of
(the Fanuc lathe `G71` to `G73` and their contour blocks, a multi-pass thread cycle), a
thread, a Klartext free contour (FK), a cycle called on a pattern, an Okuma LAP block,
a feed per tooth, a subprogram call, a jump or a loop (each block counts once and is not
followed; the same detector as the expansion's, so it also covers `CALL LBL`, `CALL PGM`,
`PCALL`, `EXTCALL`), a move of a rotary axis without its rate, a cycle gEdit has no description of or
whose holes it refuses (the block is named by the reason the expansion gives, and a block under a
cycle that stays in force, such as a feed alone under `MCALL`, by that cycle), a peck cycle
without its peck value, a move whose start or end is not
known (the first move of an axis, or the first after a move to a machine position), a feed
move whose feed cannot be read, and a dwell whose time cannot be read. A **dwell** that
cannot be read in a drilling cycle leaves out
that dwell only: the moves of the holes are still counted.

**Block skip.** A block with a block skip (`/`) is timed like any other: the estimate is for a
run with the block skip **off**. If you run with it on, skipped blocks do not run and the
real time is shorter by what they take.

**The estimate is a lower bound**, and the message says so: it counts 100 % feed and rapid
override, no acceleration, no time to read a block and no look-ahead. A real cycle time is
longer, and longer still by what the listed blocks add. Use the figure to compare two
versions of a program or two tools, or to see roughly what a program costs, not to quote
a cycle time.

**Channels.** A program with channels is reported per channel. The channels run at the same
time, so the message names the longest channel's time and never adds the channels up.

**A selection** is read together with the lines above it, as in the program checks.

### Address arithmetic

Adds, subtracts, multiplies or divides the **written values** of the addresses you choose:
the part sits half a millimetre higher, so every `Z` moves; a flipped sign; a scale. It
replaces the text as one undo step and ends with a message that says what it changed and
what it left, so read the message.

| Field | |
|---|---|
| **Operation** | Add, Subtract, Multiply, Divide |
| **Value** | For add and subtract, in the program's units (millimetres or inches; degrees for a rotary axis). For multiply and divide, a plain factor. A factor of 0 is refused |
| **Addresses** | The words to change: `X Y Z U V W A B C I J K R`. `G`, `M`, `N`, `O` and `T` are never offered. Default `Z`. When multiplying both axes of the plane, add `R` if your arcs are written with a radius: then the radius is scaled with the positions. Without `R`, a block with an arc radius is left as written and listed. A shift never changes an arc radius |
| **Arc centres** | Also change the centre words of the chosen axes: `I` with `X`, `J` with `Y`, `K` with `Z`. *Automatically* means no for add and subtract, where a centre is a distance from the start point on most controls, and yes for multiply and divide |
| **The X value is** | On a turning dialect only: whether the value is a diameter or a radius. Each `X` word is converted by the mode it is written in, so a Sinumerik program that switches `DIAMON` and `DIAMOF` moves right. On a milling dialect the value is a plain coordinate: a radius word moves by it, a word read as a diameter by twice it |
| **Decimal places** | *As written* keeps the decimals each value had and adds what the result needs, at most four; or 0 to 4 |

It never guesses what a number is worth. Each word's value is read the way **the
machine** reads it ([Machines](machines.md)) and the result is written back in the word's
own form: a point stays a point, and a word without a point stays a whole number of
increments, rounded half away from zero and reported when it had to round. A change too
small for the form of its word rounds back to the value the word had: the word stays, a
*rounded* row says so, and the message begins *Changed nothing: 1 word rounded back to the
value it is written with* (`F200` plus 0.01 on an IS-B lathe stays `F200`). With **no
machine chosen**, a word whose value depends on the machine is left as written and listed,
unless every preset of the dialect would write the same result. A count (a repeat count
`K`, a dwell, a block number) changes only when you choose its address.

**The tool direction is not an arc centre.** On a Fanuc mill, `I`, `J` and `K` under `G43.5`,
`G41.6` or `G42.6` are the direction of the tool, not the centre of an arc, and they stay so
in the blocks that follow until `G49` or `G40` ends the mode, also when those blocks do not
write the code again. A multiply or divide leaves them as written, even with the arc-centre
option on, and says so with a note (*… a parameter of G43.5, not an arc centre*); scaled,
the tool would tilt. After `G49` or `G40` the same words are arc centres again and are
scaled with the end point as before. Only the three words are read this way: the `Q` of a
modal `G83` under `G43.5` is still a length.

Examples: `Z1000` minus 0.5 is `Z500` on an increment machine (IS-B) and `Z999.5` on a
calculator-type one, and is left with no machine; `Z10.` becomes `Z9.5` on all three. On an
Okuma machine with 10 µm units, `Z1000` minus 0.5 is `Z950` and `Z10.` minus 0.5 is
`Z-40.`.

**Multiply and divide treat a distance like a position.** An incremental move is scaled
too, whatever the distance mode, and so are the cycle positions on a scaled tool axis. What
would be left unscaled while the positions around it are scaled is refused: a coordinate
shift or set written with a chosen axis, and, when the tool axis is chosen, a cycle that
writes a length parameter of its own (a peck depth `Q`, Klartext `Q201`, Sinumerik `SDIS`).
A Fanuc lathe cycle `G71` to `G76` is never scaled in part, on any axis: a multiply or
divide of a linear axis refuses (*not scaled*) a block of it that writes a length of the
cycle other than zero, and a block that scales its end point. Its blocks are left as written
and listed.

**Arcs need both axes of their plane.** Scaling one axis of the plane and not the other
would turn an arc into an ellipse, which no arc code can write: the centre or the radius no
longer fits the end points. So a multiply or divide that scales `X` but not `Y` (in the XY
plane; on a lathe `X` but not `Z`) leaves every arc block as written and lists it (*not
scaled*), and so does a block that writes a centre word `I`, `J` or `K` (the lathe chamfer
`G1 Z-10. I2.` too). While the plane is not known, all three axes count. Scaling `Z` alone
under `G17` leaves the arcs in the XY plane alone (a helix keeps its circle), and one factor
on both axes of the plane is fine, a lathe's diameter `X` included.

**The radius of an arc** (`G2 X… Y… R…`, Klartext `CR … R`) is scaled only when you choose
`R` **and** both axes of its plane are scaled. Without `R`, a multiply or divide of an axis
of the plane leaves such a block as written and lists it, because scaling the end point
alone would change the arc. With `R` chosen and neither axis of the plane scaled (only `Z`,
a helix), the radius is left and listed as a value of the arc; with only one of them scaled,
the block is left (above). A shift (add or subtract) never changes a radius: with `R` chosen
it is left and listed. A Sinumerik radius `CR=` and an Okuma radius `L` are always left and
listed under a multiply or divide of the plane.

**What else is left under a multiply or divide.** A size is not a position, so a multiply
or divide of its axis leaves what carries it as written and lists it (*not scaled*), as long
as the size is written and not 0:

- **The sizes of a cycle:** the side lengths, diameters, corner radii and stock sizes of the
  Klartext cycles 208, 240, 251 to 257 and 262, the sizes of the Sinumerik `CYCLE61`,
  `POCKET3`, `POCKET4`, `SLOT1`, `SLOT2`, `CYCLE72` and `CYCLE93`, and the taper and chamfer
  of the Okuma thread passes `G31` to `G33`. The cycle is left with every call of it. They
  would be right only for one factor on both axes of the plane, and gEdit does not decide
  that for you.
- **The taper of a lathe pass:** the taper `R` of `G90`, `G92`, `G94` (system B `G77`, `G78`,
  `G79`) lies along X (turning, threading) or Z (facing). The control keeps `X`, `Z` and `R`
  for the passes that follow, so the passes from the code until the next move are left
  together, as one series. A taper written in an earlier pass still counts for a later
  straight pass.
- **Corner and arc words:** Klartext `CHF`, `RND` and `CR`, Sinumerik `CHF=`, `CHR=`, `RND=`
  and `CR=`, the Fanuc arc radius `R`, and Okuma's `L` radius, chamfer and round. Choosing
  `R` scales a corner `R` (`RND R2`) as asked, and an arc radius as above.
- **Fanuc corner words:** the optional chamfer and rounding at the end of a move (`,C`, `,R`,
  and the angle `,A`), and on a lathe the chamfer and the rounding of a straight move
  (`G1 Z-10. R2.`, `G1 Z-10. C2.`). A block that writes one is left and listed when an axis
  of the plane is scaled. On a lathe a `C` word counts too, since a setting of the control
  decides whether `C2.` is a chamfer or a move of the C axis. A shift keeps them and moves
  the block.
- **`RNDM=`:** a Sinumerik `RNDM=2` rounds every following corner until `RNDM=0`, so every
  block that moves in between is left.

**The approach and the departure** (Klartext `APPR` and `DEP`) are not the contour: their
length `LEN` and their radius `R` say how the tool gets onto the contour and off it. A
multiply or divide of the plane scales their end points and keeps `LEN` and `R`, with a
warning row: *LEN15: a size of APPR LN, kept; check the approach fits the scaled contour.*
The summary counts them (*approach or departure sizes*). An approach on an arc (`APPR CT`,
`APPR LCT`) is an arc too: with only one axis of the plane scaled it is left (above).

A shift never changes any of them. Words that are feeds, smoothing distances or counts
(`ADIS=`, `ADISPOS=`, `FRC=`, `FRCM=`) are kept by every script.

**A tool offset is no shift.** A Fanuc `G10 L1` and `L10` to `L13` write a tool offset and
set no coordinate system, so they do not stop Translate, Rotate and Mirror. `G10 L2` and
`L20` (work offsets), a variable for `L`, and on a lathe a `G10` without `L` still do.

#### What a Z shift moves in a cycle

A drilling cycle holds absolute positions on the tool axis that are not axis words: the
`R` plane of a Fanuc `G81`, Klartext's `Q203`, the Sinumerik `RTP`, `RFP`, `DP` and `FDEP`.
Moving every `Z` and leaving those would move the surface and not the hole. So **a shift of
the tool axis moves them too**, while the plane in force is the one the tool axis stands
across (`Z` in the XY plane); in another plane, or one that is not known, the cycle is
refused.

| Dialect | What moves with `Z` |
|---|---|
| Fanuc mill | The `R` plane of `G73`, `G74`, `G76`, `G81` to `G89` (absolute under `G90`; under `G91` it is a distance and is left) |
| Klartext | `Q203` of cycles 200 to 209, 240 and 262 |
| Sinumerik | `RTP`, `RFP` and `DP` of `CYCLE81` to `CYCLE89` and `CYCLE840`, and `FDEP` of `CYCLE83` |

A call argument and a Klartext `Q` are absolute positions and move under `G91` as well.
The other parameters of those cycles are reviewed and left. A shift of `X` or `Y` does not
touch them: they are `Z` coordinates.

An **empty** Sinumerik argument counts as 0 on the control (`CYCLE81(10,,2,-10)` has its
reference plane at 0). A shift of `Z` cannot move it without writing a number there, so such
a call is left as written and listed (*cycle with an empty position on the tool axis*).
Where the depth can be given two ways, the one you wrote counts: `CYCLE81(10,0,2,,5)` leaves
the absolute depth `DP` empty and gives the depth `DPR` from the reference plane, which
follows the moved reference plane, so the call is moved. The same holds for `FDEP` and
`FDPR` of `CYCLE83`.

The `R` of a Fanuc drilling cycle is its `R` plane even when the last move before the cycle
was an arc (`G2 … R10.`, then `G81 … R2.`): it moves with `Z`. A block that writes a
drilling cycle and an arc code together is left as written.

A cycle and the blocks that run it are **moved in one piece, or not at all**: a modal cycle
and its positions, a Klartext definition and every call of it, an `MCALL` and its
positions. If one member cannot be moved, every member is left, and the row names the line
of the first refused one ("part of the same cycle as line 12"). A cycle that starts above
your selection cannot be moved from a selection, so its blocks inside the selection are
left and the row says why.

On a selection, an add or subtract of the tool axis leaves a word cycle that **starts before
any edited tool-axis word of the selection** unchanged, with a warning (`cycle-level-outside`):
its level comes from the lines above, which are not moved. Multiply and divide are not
affected.

#### What it refuses, and lists

A block it cannot judge is **left as written and listed, never shifted in part**: a shift
that moves the surface around a cycle but not the cycle scraps the part. There is one row
per refused block, with the block as written and the reason in plain words.

- **A machine position**: `G53`, `G28`, `G30`, `M91`, `M92`, `SUPA`. A place on the
  machine, not on the part.
- **Inside a frame**: a tilted plane, a rotation, a mirror, a scaling, polar coordinates
  (`G16`), `CYCLE800`, `G68`, and on a Sinumerik also `ROTS`, `AROTS` and `CROTS` (a rotation
  by solid angles), `TOFRAME` and `TOROT` with their `X`, `Y` and `Z` forms (the coordinate
  system turned along the tool) and `PAROT` (turned with the workpiece). A bare `ROT` or
  `TRANS` ends the first group, `TOROTOF` the second and `PAROTOF` the third. The numbers there are not the part's coordinates. A frame
  that is closed again (`G69`, `G15`, `PLANE RESET`, `CYCLE800()`) ends it, and so does a
  Klartext cycle 19 or `PLANE SPATIAL`, `PROJECTED` or `EULER` with every angle at zero, and a `CYCL DEF 19.1` that names no angle.
- **A rotary axis without tool centre point control**, see the next section.
- **A cycle it has no role for**: every Okuma cycle (but the change points `XA=`, `XB=`, `ZA=`, `ZB=` of the LAP code `G84`: they move with their axis, `X` as a diameter, while the mode is known to be absolute) and every lathe cycle but the Fanuc
  drilling cycles `G83` to `G89` (their `Z`, and `X` for `G87` to `G89`, move with a shift; the
  `R` is a distance from the start level in system A and is left (on a machine set to the
  *Series 15 format* it can be an absolute position, parameter 5102 bit 6, and Translate says
  so in an information row), and in system B it can be
  absolute or incremental, so a block with `R` is refused there) and the multiple repetitive
  cycles `G70` to `G76` (their contour blocks and end points are moved,
  and their depths, allowances, the relief `R` of `G74` and `G75`, the taper `R` of `G76`, and
  counts are left as written **and listed** as values of the cycle), a Fanuc `G65` that hands a
  chosen address a number, a Sinumerik or Klartext cycle the database has not reviewed, and
  **a call it does not know that has a number among its arguments** (`CYCLE76(…)`, a
  subprogram `MYSUB(10)`), since its depth could be an absolute position nobody described.
  A call with no number (`MYSUB`, `CYCLE832()`) is not a cycle with positions and is not
  touched. The Sinumerik milling cycles `CYCLE61`, `POCKET3`, `POCKET4` and `SLOT1`, the turning cycle `CYCLE95` (its contour is
  elsewhere) and the
  Klartext cycle 254 are known, but their points in the plane are positions of their own that a
  shift cannot judge, so such a call is refused with *has positions of its own*.
- **An FK contour point**: the absolute points of a Klartext FK contour (`P1X`, `P1Y`, `P1Z`,
  `P2X` … `P3Z`, and the circle centre `CCX`, `CCY`) are **left as written and listed with a
  warning** — *CCX+50: an absolute point of an FK contour; gEdit does not move it. Check the
  FK contour.* — when you shift or scale the axis they belong to, while the ordinary moves
  around them move. The summary counts them (*N FK contour points*). Look at the FK contour
  yourself before it goes to the machine.
- **A cycle with positions it cannot move**: Klartext `CYCL CALL POS` (its tool-axis
  position acts as a second datum shift on top of `Q203`, so moving both would move the hole
  twice) and `CYCL CALL PAT` (the points stand outside the block), and the points of
  `CYCLE800`. The definition is refused together with its call.
- **A mode argument** other than empty or 0 (`_AMODE`, `_DMODE`, `_GMODE`, `_AXN`), and a
  block that writes a drilling cycle and an arc code together (`G2 G81 …`).
- **An empty Sinumerik position on the tool axis** under a shift of `Z`, see above.
- **Another plane than XY**, or one that is not known: the tool axis is then not `Z` for
  sure.
- **A variable or an expression** where the shift would move a cycle position, or an axis
  word of a chosen address written as one inside a cycle block (`Z#101` under `G83`).
- **A pole and the moves around it, or an arc whose centre cannot be moved with its end
  point**, see "The Klartext pole and arc geometry" below.
- **A distance mode that is not known**: nothing before the block says `G90` or `G91`.
  Adding to an incremental word would add the offset twice, so a position word (an axis, its
  incremental twin, an arc centre, `R`) is moved only while the mode is known to be absolute.
  A feed, a dwell, a count or another word that is not a position does not depend on the
  mode and changes in any: `F200` plus 10 is `F210` under `G90`, under `G91` and with no
  distance mode written. A program that never writes `G90` falls under this
  unless the machine says what the control starts in
  ([Machines](machines.md#the-power-on-distance-mode)).
- **A code the database does not know** under the move letter (a `G` code), in a block it
  would otherwise change: it may be a machine position or a frame. A code it does not know
  in a block with nothing to change is listed once, as a note, with the number of blocks.

Words it leaves inside a block it does change are listed too, at information level: an
**incremental** word (`G91`, a lathe `U`/`W`, a Klartext `IZ`); a **variable** or an
expression (Okuma `X=V1+2`, Sinumerik `X=R1`); a **code whose words are values** (`G92`,
`G52`, `G10`, `CYCL DEF 7`, `TRANS`); a **count** reached through the arc centres; and a
word whose reading **depends on the machine**; and a **value of a cycle** of a chosen address
(the depths, allowances and taper of a Fanuc lathe cycle, which are not positions). A count you
choose on purpose still changes (`K` of `G83`). A Sinumerik `Z=AC(3.25)` is an absolute
position and is moved; `Z=IC(2)` is an incremental distance and is left.

A word that is no position of the chosen axis is never changed, whatever its letter. With the
address C chosen, the phase shift `C` of an Okuma thread cycle `G31` to `G33` is an angle, not
a move of the C axis, and stays as written.

At most 500 rows are listed, and the message says how many more there were. Its last
sentence names the machine ("Machine 'Lathe 2': numbers without a point are increments of
0.001 mm; X is a diameter.") or says "No machine chosen: words whose reading depends on the
machine are left alone."

#### Rotary axes, and tool centre point control

A rotary axis that is turned changes what a `Z` word means: with `B` at 90 degrees, a move
along `Z` is a move along the workpiece's `X`. So a chosen linear word is **refused while a
rotary axis that turns it stands turned, or may, and tool centre point control is off**. A
rotary position stays in force after the block that wrote it, so the blocks behind it are
refused too.

- **Under tool centre point control** (`G43.4`, `G43.5`, `M128`, `FUNCTION TCPM`,
  `TRAORI`) the numbers are the tool tip in the workpiece, whatever the rotary axes do. A
  shift there is right and is made. Tool centre point control is not a frame and does not
  stop a shift.
- **Which axis turns which**, by the usual convention: `A` and `B` turn `Z`, `B` and `C`
  turn `X`, `A` and `C` turn `Y`. On a lathe `C` does not turn `X`, so a lathe `Z` or `X`
  shift is not stopped by it.
- **An axis at zero is not turned.** An axis the program first writes as 0 stays out of the
  way. An axis first written to a value other than 0 counts as unknown from the start of
  the run up to that line, and so does an axis the program moves by an expression or an
  incremental move. An axis the program never writes does not exist for it.
- **On a machine position** (`L A0 C0 M92`) a literal 0 is zero, so a program that parks
  its axes at 0 on the machine does not lose its whole three-axis part.
- A cycle's tool-axis positions under a tilt are refused as well. The row says "moves B
  together with Z" when the block writes the turning axis itself.

A rotary position written without any frame (`G0 B90.` and then plain 2D moves) is judged
like any other block. On a table whose axis is not the shifted one, check such a program
by hand.

#### The Klartext pole and arc geometry

A shift on `X` or `Y` has to move **the pole** `CC` together with the points around it, or
the polar moves and arcs would be drawn about the old centre. An absolute `CC X+50 Y+50`
moves with the axes of the plane; an incremental `CC IX+10` is left. The pole and the moves
around it up to the next pole (`C`, `LP`, `CP`, `CTP`) are refused **together** when a pole
word is a variable or has no value, the plane is not known, or the run multiplies or
divides (the polar radii would stay). A shift of `Z` alone leaves the pole alone.

Arc centres written as absolute coordinates move with the end point: Sinumerik `I=AC(…)`,
`J=AC(…)`, `K=AC(…)` and the `CIP` intermediate point `I1=`, `J1=`, `K1=`. An arc whose
centre cannot be computed (`I=AC(R1)`) or cannot be changed while the end point is, is
refused.

A Klartext value that changes sign is written without its plus: `Z-2` plus 5 becomes `Z3`.
That is the editor's number format for the dialect, not something this script chose.

#### Not covered yet

The Sinumerik milling cycles `CYCLE61`, `POCKET3`, `POCKET4`, `SLOT1` and `SLOT2` and the
Klartext cycle 254 are refused as a whole because their positions in the plane have no role in
the database (a Z shift would otherwise move the depth and leave the positions). `CYCLE72` is
refused for the same reason: the contour it mills is named by its first argument and lies in a
subprogram or another part of the program, where the call cannot judge it. Klartext cycles
251 to 253, 256 and 257 move together with their call like cycles 200 to 209 under a shift (a
multiply or divide leaves them because of their sizes, see above). A Klartext cycle the
database still lacks does not replace the earlier definition in the modal state, so address
arithmetic refuses it with its calls; the same goes for cycle 20 and the pattern cycles 220 and
221. The fix for these is database content, not the script.

### Translate

Moves the path by a shift in X, Y and Z: the part sits 12 mm further along the table, or
a second vice takes the same program. It replaces the text as one undo step and ends with a
message that says what it moved and what it left, so read the message. It works on every
built-in dialect, milling and turning.

| Field | |
|---|---|
| **X shift**, **Y shift**, **Z shift** | The shift per axis, in the program's units (millimetres or inches). A shift of 0 leaves the axis alone. On a turning dialect the **X shift** is read the way your machine reads `X`, see below |
| **Decimal places** | *As written*, the only choice: each word keeps its own form and gets the decimals the shift needs. A shift is never rounded |

**What moves.** Every absolute position: the end point of a move, an absolute arc centre
(Sinumerik `I=AC(…)`, or `I`/`J` on a control whose centres are absolute), the Klartext pole
`CC`, and the position of a drilling cycle (the `X`/`Y` of a block under `G81`, a Klartext
`CYCL CALL POS`, the positions behind a Sinumerik `MCALL`). A shift of `Z` also moves the
cycle positions on the tool axis: the `R` plane of a Fanuc cycle under `G90`, Klartext's
`Q203`, Sinumerik's `RTP`, `RFP` and `DP`. It is the same rule as in
[What a Z shift moves in a cycle](#what-a-z-shift-moves-in-a-cycle).

A Klartext **`CYCL CALL POS`** writes a position of its own, and its Z adds to the surface
coordinate of the cycle (`Q203`). A shift in **X and Y** moves the call's X and Y. A shift in
**Z** is refused: moving both the call and the definition would move the cycle twice, and
moving only one would leave the other behind. The call and the definition it runs are listed
together. Shift Z in another way, or use [Address arithmetic](#address-arithmetic) on the
cycle's own parameters.

**What stays.** Incremental words (`G91`, a lathe `U` and `W`, a Klartext `IX`), incremental
arc centres (`I`, `J`, `K` on most controls), radii, and Klartext polar radii and angles. A
shift does not change a distance, an angle or a length, so none of them is touched. A
cycle moves **in one piece** with the blocks that run it. A tool offset number (Sinumerik
`D`) is never changed by any of the three, and neither is the value of a Fanuc `G10 L1` or
`L10` to `L13`, which writes a tool offset and no coordinate system.

**An increment after a drilling cycle.** After `G98` the tool leaves a drilling cycle at its
start level, after `G99` at the `R` plane. An incremental move along the tool axis that
follows (`G91 G99 G81 …`) is moved when the program wrote the level the cycle started from:
the shift moves both the level and the move, so the increment stays as written and ends in
the right place. From a level nobody wrote it is refused (`axis-unwritten`). A Sinumerik
cycle (also behind `MCALL`) and a Klartext cycle definition give their levels in their
parameters (`RTP`, `RFP`; `Q203`): the increment after them is moved only when those are
written as numbers.

**An empty level of a cycle.** A Sinumerik cycle reads a parameter left empty, or left out at
the end, as 0. A Z shift cannot move a value that is not written, so a cycle call with an
empty retract plane, reference plane or depth (`CYCLE81(10,,2,-10)`, `CYCLE81(,0,2,-10)`)
refuses a Z shift (`cycle-level-empty`). Write the level as a number. An empty depth whose
relative depth is written is fine: `CYCLE81(10,0,2,,5)` takes its depth from `DPR` (the same
for `FDEP` and `FDPR` of `CYCLE83`). A shift in X and Y alone does not touch the levels.

A program in inches, or a block that switches units, gets the shift converted
(25.4 mm to the inch) in the units the block states.

**Exact.** No word is rounded. A word keeps its form: a point stays a point, a word with no
point stays a whole number of increments of your machine, a leading zero or its absence
(`Z-.5`) is kept, and Klartext keeps its plus signs. A shift that a word cannot hold, such
as 0.0005 on a machine that counts in whole thousandths, refuses the run. A shift of
0, 0, 0 gives the program back unchanged, byte for byte, and a shift by *d* followed by a
shift by *−d* gives every value back.

Examples, on a Fanuc mill with no machine chosen (X 1.25, Y −2, Z 0.5):
`G0 X0. Y0. Z5.` becomes `G0 X1.25 Y-2. Z5.5`, `G1 Z-1.` becomes `G1 Z-0.5`, and
`G90 G81 X20. Y20. Z-5. R2.` becomes `G90 G81 X21.25 Y18. Z-4.5 R2.5`. A `G91 G1 X-10.`
stays as it is.

**On a lathe the X shift is read as the machine reads `X`.** On a machine that programs `X`
as a diameter (the usual case, and what gEdit assumes when no machine is chosen) an X shift
of 1 moves a diameter word by 1. On a machine that programs `X` as a radius it moves it by 1
as a radius, which is 2 on the diameter. A Sinumerik program that switches between `DIAMON`
and `DIAMOF` is moved by the reading in force at each word: a diameter shift of 1 moves a
`DIAMON` word by 1 and a `DIAMOF` word by 0.5. `U` and `W` are incremental and stay. The
message names the reading ("Moved by X1 (diameter) Z-0.5") and its last sentence says
whether the machine reads `X` as a diameter or a radius.

**A rotary axis.** A rotary move by a value other than 0 from a position gEdit does not know
counts as turned, like an absolute one, and with tool centre point control off a shift is
refused while the axis stands turned. A block that tilts the plane (`PLANE … TURN`, `MOVE`,
`G53.1`, `G53.6`, `CYCLE800`) leaves the rotary axes not known until the program writes
them. A Sinumerik `CYCLE800` with every angle at 0 (the swivel to the home position, which
many programs start with) ends the tilt and leaves the axes as gEdit knew them. A Klartext
`CYCL DEF 19` turns the rotary axes only when its `19.1` writes a feed `F` or a clearance
`ABST`; with angles alone gEdit takes the axes as they were. On a 5-axis machine with tool
centre point control, where the program coordinates turn with the table, a shift stays
allowed with the table turned. On a Fanuc mill that holds for the table coordinate system
(parameter 19696 bit 5 = 0), which gEdit assumes; check your machine. Translate says so once per
run, at the first block it moves under tool centre point control: an information row (*Block
under tool centre point control*) and a sentence at the end of the message, *Tool centre point
control: the shift assumes the table coordinate system (parameter 19696 bit 5 = 0). Check your
machine.* Nothing is refused for it.

**A Sinumerik incremental move after a shift.** With the control's setting `SD42440` at 1, an
incremental move also travels the change of the zero point that a `TRANS`, an `ATRANS` or a
work offset (`G54` to `G57`, `G500`) made since the axis was last written absolutely. A turn
or a mirror cannot carry that over, so Rotate and Mirror refuse such a move (*shift-increment*)
until the program writes the axis absolutely. gEdit does not know your setting and takes the
safe side. Two cases decide it block by block. A block that changes the work offset and moves
to an absolute position on an axis in the same block (`G54 G0 X0 Y0 Z100`) has taken the
change along on those axes, so the incremental moves after it are turned or mirrored as
written. A block that changes the work offset and moves incrementally itself (`G55 G91 G1 X5
Y5`) is refused, because its own increments travel the change of the offset too. A `TRANS`
written as data is no move and makes no axis absolute.

**Jumps** (all three). A jump, a loop or a block marked with `/` can reach a block with another distance
mode, plane, unit, frame or cycle than the lines above it have. Where it does, the block is
refused (`jump`). Where the state is the same, the program is moved as written.

**Returns and machine positions.** `G53`, `M91`, `SUPA` and an incremental return
(`G91 G28 Z0.`) are left as written and listed as information. A return through an
**absolute** intermediate point (`G90 G28 Z50.`) would be moved, so it refuses the run.

### Rotate

Turns the path of a **milling** program in the XY plane about a point, by an angle: a
fixture standing at 90 degrees, or a part machined on the other face. It replaces the text
as one undo step and ends with a message, like Translate.

| Field | |
|---|---|
| **Centre X**, **Centre Y** | The point the path turns about, in the program's units. Default 0 and 0 |
| **Angle (degrees)** | Counter-clockwise is positive, as the controls count it, seen from the positive end of Z. Required |
| **Decimal places** | Only for an angle that is not a multiple of 90. *As written* keeps each word's own decimals, with at least 3 in millimetres and 4 in inches; 3 or 4 writes every rounded word with a point with that many. A word without a point stays whole increments only on a machine that reads it in increments; on a machine that reads numbers as written it gets a point and 3 decimals (inches: 4) when it must be rounded |

**What turns.** Absolute positions about the centre. Incremental moves and arc centre
vectors (`I`, `J`) **turn too**: they are directions, and turning the path turns them.
Absolute arc centres turn like points, and so do the Klartext pole `CC` and the positions
of a cycle in the plane. The polar angle `PA` turns by the angle; `IPA` is a step and stays.

**What stays.** `G2` and `G3` (a rotation does not change the way round), radii with their
sign, the Sinumerik opening angle `AR=` and `TURN=`, the axes outside the plane (the `Z` of
a helix), and every cycle parameter on the tool axis. Also the corner and approach words
that are sizes: Klartext `CHF`, `RND` and the `LEN`, `R` and `CCA` of `APPR`/`DEP`
(`LT`, `LN`, `CT`, `LCT`), Sinumerik `CHF=`, `CHR=`, `RND=`, `RNDM=`, and the feeds `FRC=`
and `FRCM=`, and the smoothing distances `ADIS=` and `ADISPOS=`, and a Fanuc `H1` written without `G43`, which is the length offset number.

**`X` and `Y` are both written on every block that now moves in both.** A block that wrote
only `X` has to write a `Y` afterwards. gEdit takes it from where the tool is, in the
form of the `X` beside it. A block whose start gEdit does not know (the first move of the
program with no position before it, one after a machine position, one reached by a jump
with another position than the straight run has, or a cut from an axis the program has not
written yet) refuses the run.

**A rotary axis.** A rotary word that leaves its axis at 0 is accepted. A rotary axis that
moves to another angle, or stands at one, refuses the move. After a block that tilts the
plane (`PLANE … TURN`, `MOVE`, `G53.1`, `G53.6`, `CYCLE800`) the rotary axes count as not
known until the program writes them. A `PLANE` with every angle at 0, and `PLANE RESET`,
turn no axis for gEdit: it keeps what it knew about the rotary axes and does not assume the
home position the control turns them to (that depends on `M138` and the settings of the
machine).

**The workpiece blank.** A Klartext `BLK FORM` is left as written, with one information row
per run. Check the blank in the control's graphics.

**Pocket cycles with an angle** (Klartext 251, 253, 254, 256, 257) are refused with their
calls, see the table below.

A rotation by **360** degrees gives the program back byte for byte. A turning program
is refused: you can translate it, or mirror it in Z, but not rotate it. This includes an
Okuma milling program, which opens with the turning profile ([Dialects](dialects.md#milling-on-okuma-and-sinumerik)).

### Mirror

Mirrors the path of a program, for the other hand: in X, in Y, about a line at an angle,
and on a lathe in Z for the counter spindle. It replaces the text as one undo step and
ends with a message, like Translate.

| Field | |
|---|---|
| **Mirror** | *In X (about a line parallel to Y)*, *In Y (about a line parallel to X)*, *About a line at an angle*, or *In Z for the counter spindle (turning)*. The form starts on **Automatic**: Z on a turning program, X on a milling program. A turning program can only be mirrored in Z |
| **Point X**, **Point Y** | The point the mirror line goes through. *In X* flips the X values about the line through **Point X** (`X' = 2 × Point X − X`); *In Y* flips the Y values about the line through **Point Y**. Default 0 |
| **Line angle (degrees)** | Only for a line at an angle: its angle from the X axis, counter-clockwise positive. Every multiple of 45 degrees is exact (0, 45, 90 and so on) |
| **Mirror Z (turning)** | Only for the Z mirror: the Z the program is mirrored about (`Z' = 2 × Mirror Z − Z`). Default 0 |
| **Decimal places** | As for Rotate, only for a line at an angle that is not a multiple of 90 |

**What mirrors.** Absolute positions in the line, incremental moves and arc centre vectors
as directions, absolute centres, the Klartext pole and the positions of a cycle in the
plane. The polar angle `PA` becomes `2 × angle − PA`, and `IPA` changes sign. Radii keep
their value and sign (the arc spans the same angle), and so do `AR=`, `TURN=`, the
Klartext `CCA` and `LEN`, and the axes outside the plane.

**What swaps.** The arc direction and the compensation side swap, because a mirror turns
a path the other way round: `G2` and `G3`, `G41` and `G42`, in Klartext `RL` and `RR` and
`DR+` and `DR-`. gEdit reads which codes belong together from the code database of the
dialect, never from a list in the script, and writes the new code in the style of the one it
replaces (`G02` becomes `G03`). A block with a code that has no single opposite in the database (Fanuc `G41.2` to `G42.6`,
Okuma `G102` and `G103`) or an arc gEdit cannot check afterwards (`CT`, `CTP`, `CIP`)
refuses the run.

**What the result tells you.** One warning, at the first block it changed: *Mirroring
reverses the cutting direction: climb milling is now conventional milling, and the other way
round. Check the cutting data.* gEdit does **not** reverse the path to bring the cutting
direction back. A second warning appears when a helical move (an arc with a move along the
third axis) is mirrored: *a thread milled with it is now the other hand.* Mirroring twice
gives every value back.

An axis mirror writes only the words that were there. The first block of a selection is the one exception, see [Selections](#selections).

A Klartext **`BLK FORM`** is left as written, with one information row per run.

#### The Z mirror for the counter spindle

A lathe program written for the main spindle, turned into one for the counter spindle.
It works in the ZX plane (`G18`), which a turning dialect starts in. A program that
selects another plane is refused.

| | |
|---|---|
| **Flips** | Every absolute `Z` about **Mirror Z**; an incremental `Z` and `W` change sign; the arc centre word along Z (`K`) changes sign |
| **Changes sign** | `Y`, about the turning axis (`Y' = −Y`, whatever **Mirror Z** is), and so do an incremental `Y` and the arc centre word `J`. This is the default, *Y turns with Z*; with the machine setting *Counter spindle: Y stays* ([Machines](machines.md#defining-a-machine)) `Y`, an incremental `Y` and `J` are left as written, and `Z`, `W` and `K` still turn. Lathes of Fanuc, Okuma and Sinumerik have the setting |
| **Stays** | `X`, `U` and `I`, and the radii |
| **Swaps** | `G2` and `G3`, `G41` and `G42`, from the code database as above |

The Z mirror never reads `X`, so a diameter or a radius makes no difference to it, and
Sinumerik `DIAMON`, `DIAMOF` and `DIAM90` refuse nothing. A C axis word that leaves its axis
at 0 is accepted. A C word that moves the axis to another angle is refused: seen from the
counter spindle it turns the other way. In a selection, a first move that writes no Z, or
no Y while the tool stands away from Y0, is refused (`selection-start`), and so are a single
pass while the tool still stands where the lines above left it and a pass that takes its Z
from a block above the selection (see [Selections](#selections)).

Example, Z0: `G1 Z-10.` becomes `G1 Z10.`, `G2 X30. Z-15. R5.` becomes `G3 X30. Z15. R5.`,
`G3 X40. W-5. K-5. I0.` becomes `G2 X40. W5. K5. I0.`, and `G41` becomes `G42`.

**Always one warning:** *Mirrored for the counter spindle: the tool nose direction (the
cutting edge position in each tool's offset) is not in the program. Set it for the counter
spindle before this program runs.* The tool nose direction is a number in the tool's
offset on the control, not in the program, so gEdit cannot change it. Set it by hand.

**What it refuses, and why.** The result of these cycles is not just points, so mirroring
the numbers would make the cycle cut the wrong way:

- **Threads** — thread cutting moves and cycles (`G32`, `G33`, `G76`, the single threading
  pass `G92` or, in system B, `G78`, with or without a taper, and their relatives in each
  dialect). The hand of a thread follows from the travel along Z
  together with the direction the spindle turns. The mirror reverses the travel, and
  whether the counter spindle turns the same way seen from the part is a fact of the
  machine that the program does not state. Write the threads for the counter spindle by hand.
- **Roughing cycles** (`G71` to `G73`, the Okuma contour cycles). Their finishing allowance
  along Z has a direction, which depends on the contour. gEdit does not mirror them yet.
- **Other turning, grooving and drilling cycles** (Fanuc `G70`, `G74`, `G75`, `G83`
  to `G89`; Sinumerik `CYCLE92` to `CYCLE99`, `CYCLE930` and `CYCLE940` to `CYCLE952`;
  the Okuma cycles). Their parameters hold the side and the direction of the machining.
- **A chamfer or a corner round whose sign is a direction** (Okuma `G75`, `G76` with `L`):
  the sign of `L` gives the direction of the next move along the other axis, which a Z
  mirror reverses. Write it for the counter spindle by hand.
- **A single turning or facing pass with a taper** (`G90`, `G94`, `G77`, `G79` with `R`):
  the taper of one changes sign and the taper of another does not, and the database does not
  say which is which. The passes keep `R` until a block writes it again, so a facing pass
  (`G94`, `G79`, taper along Z) is refused too while a taper written above it is still in
  force, also when that block is above the selection. A taper that is not known counts as a
  taper: one that cannot be read, and any after a subprogram or macro call. A one-shot code
  other than a dwell (`G04`), or a plane code, ends the taper. `R0` is no taper, and a
  turning taper (`G90`, `G77`, along X) in force does not change sign under the Z mirror. The
  same pass without a taper is points and is mirrored. (Kept refused in this version. A later
  one may let `R` of `G90` and `G92` stay and change the sign of `R` of `G94` and `G79`; `G92`
  would stay refused as a thread.) A tapered threading pass (`G92`,
  `G78`) is not listed here: it is refused as a thread above, with that one reason.

The Z mirror is for turning programs only. A milling program is mirrored about a line in the
XY plane, and a turning program is not mirrored in X: both are refused with a row that says so.

### Rounding, exact and not

A result is **exact** when it comes out of decimal arithmetic on the written text:
translate; rotate by a multiple of 90 degrees; mirror in X or in Y, or about a line at any
multiple of 45 degrees (0, 45, 90, 135 and so on); and the Z mirror. No word is rounded. If the result does not fit the
form of a word (a point-less word that would need a fraction of an increment), the run is
refused instead of rounded.

Any other angle is **rounded**. Each word is computed and rounded half away from zero to its
own number of decimals, with at least 3 in millimetres and 4 in inches. A word with no
point stays a whole number of the machine's increments on a machine that reads it in
increments; on a machine that reads numbers as written it gets a point and 3 decimals (4 in
inches), like the absolute words around it. An incremental move is written as the difference
of the two rounded points it joins, so rounding does not add up along a path. The run lists
**one** information row, "rounded", at the first block with a rounded word, with the number of
rounded blocks.

Rounding can break an arc: a start and an end that were the same distance from the centre
may no longer be. So gEdit **reads the written program again** and checks every arc. The
start and the end must be the same distance from the centre within **0.002 mm (0.0001 inch)**,
and the chord of an arc written with a radius may exceed its diameter by no more. An arc
that fails refuses the run, at that arc: *after rounding, this arc's start and end are not
the same distance from its centre … Use more decimals or an angle of 90, 180 or 270.*
Choose **Decimal places** *4* and try again, or turn by a multiple of 90 (or mirror about a line at a multiple of 45).

Example, rotate by 30 degrees about X0 Y0: `G3 X0. Y10. I-10. J0.` becomes
`G3 X-5.000 Y8.660 I-8.660 J-5.000`, and a word that already had five decimals keeps them.

### What translate, rotate and mirror refuse, and list

They refuse **as a whole**. If one block cannot be moved, gEdit writes **nothing**,
hands the text back unchanged (so there is no undo step) and lists **every** block it
refused, so you see them all at once and not one after the other. A path moved except for
one block is a broken path. The message begins *Nothing was changed: N blocks cannot be
moved by …* and counts the reasons. In the **Results** panel there is one row per refused
block, with the block as written and the reason, and a click on a row jumps to the line.

This differs from [Address arithmetic](#address-arithmetic), which changes what it can judge
and lists the rest.

A row reads `<the block as written>: <reason>`. These are the reasons, in the words of the
rows. The second column is the id the Results panel and the scripts' test files use. Translate
words some of them in its own terms, for example for a cycle call with a position of its own
(see "What moves" under [Translate](#translate)).

**Frames, shifts and settings**

| Applies to | Id | A row says |
|---|---|---|
| All three | `frame` | A coordinate rotation, mirror, scaling, polar command or tilted plane is in force here; gEdit cannot tell where these positions are. Move the path without it, or cancel it first. |
| All three | `coordinate-shift` | This block sets or shifts the coordinate system: a local shift, a coordinate set, a data setting, or a write into a system variable. The positions after it are in another system, and gEdit cannot tell which. |
| All three | `intermediate-point` | The return to the reference point goes through this absolute intermediate point, which the transform would move; write it as an incremental zero return or check it by hand. |
| Rotate and mirror | `rotary-word` | A rotary axis moves to an angle other than 0 here, or stands at one; turning or mirroring the path would need its angle changed too, which gEdit does not do. |
| Translate | `rotary-turned` | A rotary axis stands turned here and tool centre point control is off, so a shift of the program is not a shift of these machine axes. |
| Rotate and mirror | `shift-increment` | An incremental move along an axis the program has not written absolutely since the zero point was shifted or the work offset changed (`TRANS`, `ATRANS`, `G54` to `G57`, `G500`); with the control's setting `SD42440` at 1 such a move also travels the change of the shift, which a turn or a mirror cannot carry over. Write the axis absolutely first. |

**The program around the block**

| Applies to | Id | A row says |
|---|---|---|
| All three | `call` | A subprogram or macro call: the called program's positions are not in this document, so it cannot be moved with the rest. |
| All three | `jump` | A jump, a loop or a block that may be skipped reaches this block with another distance mode, plane, unit, frame or cycle than the program written above it has, or jumps to a block gEdit cannot find; gEdit cannot tell which one is in force. |
| All three | `expression` | A variable or a calculation in a word the transform has to change; gEdit only changes written numbers. |
| All three | `machine-dependent` | This number is read differently on the machines of this control; choose the machine of this document. |
| All three | `distance-assumed` | The program does not say whether its positions are absolute or incremental before this block, and the machine sets no power-on mode; add G90 or G91 (or the control's form) at the top. |
| Translate | `axis-unwritten` | The shift moves an axis the program has not written before this block, so where a cut starts is not known. |
| Rotate and mirror | `position-unknown` | gEdit does not know where the tool stands at the start of this block (an axis not written yet, a machine position, a calculation, a jump, a tilted plane) and the transform needs that point. A cut that starts from an axis the program has not written yet is the same case. |
| All three | `unknown-code` | A code the database for this control does not know; it may change how the positions after it are read. |
| All three | `word-unknown` | A word gEdit cannot place: it may be a position, an angle or a direction, and it would be left as written. Rotate and mirror also give it for the **tool direction** `I`, `J`, `K` under Fanuc `G43.5`, `G41.6` or `G42.6` (until `G49` or `G40`), in the block that writes the code and in the blocks it governs, when the component lies along an axis the operation moves and is not 0: the path would turn and the direction would not. Translate leaves the direction as written, as a shift does not change it. |

**Selections**

| Applies to | Id | A row says |
|---|---|---|
| All three | `selection-inside` | The selection starts or ends inside a cycle or a block that runs over several lines; select the whole of it. |
| Mirror (in X, Y, a line and Z) | `selection-mode` | This block runs under an arc direction or a compensation side (G2/G3, G41/G42) set above the selection; the mirror would have to swap that code outside the selection. Start the selection at the block that sets it. |

**Cycles**

| Applies to | Id | A row says |
|---|---|---|
| All three | `cycle-not-reviewed` | A cycle whose parameters gEdit has not been told about (or one the database does not know); its positions could not be moved with the path. |
| All three | `cycle-position` | A cycle with positions of its own (a pattern, a pocket, a contour elsewhere) that gEdit does not move. |
| Rotate and mirror | `cycle-angle` | A cycle that turns or places what it cuts by an angle or a corner of its own (a pocket's angle, the corner the tool stands at); gEdit does not turn or mirror those values, so the cycle would cut in the old direction. |
| All three | `cycle-plane` | A cycle with a position on the tool axis while the working plane is not XY; the tool axis is not certain. |
| Translate | `cycle-level-empty` | A level of this cycle on the tool axis (its retract plane, reference plane or depth) is left empty, which the control reads as 0; a shift cannot move a value that is not written. Write the level as a number. |
| All three | `fk-contour` | A free contour (FK): its points depend on each other and on the elements around them; gEdit does not move them. |

**Arcs and numbers**

| Applies to | Id | A row says |
|---|---|---|
| Rotate and mirror | `arc-tangential` | A tangential arc or an arc through a point; gEdit cannot check it after the transform. |
| All three | `arc-unsupported` | An arc gEdit cannot compute (an arc by an L radius, a contour arc with the C axis). |
| Rotate and mirror | `swap-unknown` | This arc direction or compensation side has no single opposite code in the database, so the mirror cannot write it. |
| Rotate and mirror (not the Z mirror) | `arc-check` | After rounding, this arc's start and end are not the same distance from its centre (within 0.002 mm or 0.0001 in); a control rejects or misreads such an arc. Use more decimals or an angle of 90, 180 or 270. |
| All three | `resolution` | The result does not fit this word's form (its decimals, or whole increments of the machine) without rounding; give a shift the machine can write. |
| All three | `pole-unknown` | A move around the pole while the pole is not known or not moved with the path. |

**Planes and kinds of machine**

| Applies to | Id | A row says |
|---|---|---|
| Rotate and mirror | `plane` | The working plane is not the one this transform works in (XY on a milling program, ZX with G18 for the lathe Z mirror). |
| Rotate | `lathe-rotate` | A turning program cannot be rotated; translate it, or mirror it in Z for the counter spindle. |
| Mirror | `lathe-x-mirror` | A turning program can be mirrored in Z for the counter spindle, not in X. |
| Mirror, Z for the counter spindle | `mill-z-mirror` | The Z mirror for the counter spindle is for turning programs; a milling program is mirrored about a line in the XY plane. |

**The Z mirror for the counter spindle**

| Applies to | Id | A row says |
|---|---|---|
| Mirror, Z for the counter spindle | `thread` | A thread or tapping move or cycle: mirrored in Z it would cut the other hand of thread unless the counter spindle turns the other way, which the program does not say. Write the threads for the counter spindle by hand. |
| Mirror, Z for the counter spindle | `roughing-cycle` | A roughing cycle that works from a contour (its finishing allowance along Z has a direction); gEdit does not mirror it yet. |
| Mirror, Z for the counter spindle | `lathe-cycle` | A turning, grooving or drilling cycle; its parameters are not mirrored, so the cycle would work on the wrong side. |
| Mirror, Z for the counter spindle | `single-pass-taper` | A turning or facing pass with a taper (R): whether the taper changes sign depends on the cycle; write the taper for the counter spindle by hand. Also a facing pass under a taper written above it and still in force, or one that is not known. A tapered threading pass is a `thread` instead. |
| Mirror, Z for the counter spindle | `chamfer-sign` | A chamfer or a corner round whose sign gives the direction of the next move along the other axis; gEdit does not mirror it yet. Write it for the counter spindle by hand. |

**A run can also be refused as a whole.** These reasons belong to the run, not to a block:

| Applies to | Id | A row says |
|---|---|---|
| All three | `no-database` | This run had no code database for this control, so gEdit cannot tell a machine position, a frame or a cycle from a move. Nothing is moved. |
| All three | `selection-unprimed` | The lines above the selection were not sent, so the distance mode, the units, a frame and a cycle in force there are not known. Run it on the whole program. Rotate and mirror add the arc direction and the compensation side to that list. |
| Rotate and mirror | `selection-start` | The first move of the selection starts where the lines above leave the tool, and that point is not moved with the selection. An arc, an incremental move or (on a lathe) a move without Z, or without Y away from the turning axis, from there would miss the moved path. Start the selection at a block that moves to an absolute position, with Z on a lathe (and Y where Y is not 0). The Z mirror adds a single pass from there, and a pass that takes its Z from a block above the selection. |
| Translate | `selection-start` | The selection starts where the lines above it leave the tool, and that point is not moved with the selection. A move from there that does not go to a written position on every shifted axis, an arc, an incremental move, or a turning or facing pass (which goes back to that point) would miss the moved path, and so would a pass that takes its end point from a block above the selection. Start the selection at a block that moves to a position on every shifted axis, and give its first pass every value. |

**Information rows** do not stop a run. They list what is left as written:

| Row | |
|---|---|
| Machine position | A position in machine coordinates or an incremental return to the reference point; left as written |
| Word left | Translate only: a word gEdit cannot place; left as written (a shift does not change angles or lengths) |
| Block under tool centre point control | Translate on a Fanuc mill: the shift assumes the table coordinate system (parameter 19696 bit 5 = 0). One row per run, at the first block the shift moves under tool centre point control |
| Drilling R point (Series 15 format) | Translate on a Fanuc lathe set to the *Series 15 format*: the `R` of a drilling cycle is left as written, but on such a machine it can be an absolute position (parameter 5102 bit 6). If yours reads it as absolute, shift it too. Also when only X is shifted |
| Rounded | Rotate and mirror: **one row per run**, at the first block with a rounded word, with the count of rounded blocks |
| Blank | Rotate and mirror, Klartext: the workpiece blank (`BLK FORM`) is left as written. It only sets the blank that the control's graphics show. Check it there. One row per run |

**Warnings** are the climb-milling warning, the helix warning and the tool nose warning
above. They appear **only in a run that writes**. A refused run lists no warning.

**Pocket cycles with an angle.** A Klartext pocket cycle that turns what it
cuts by an angle of its own, or places it by a corner (cycles 251, 253, 254, 256 and 257:
the pocket angle and the corner the tool stands at) is refused by rotate and mirror
(`cycle-angle`), with its definition and every call, because the angle would stay as it was. A shift does not change an angle, so translate does not refuse them for it.

#### Selections

All three work on a selection or on the whole program. A selection is read **with the lines
above it**, so the distance mode, the plane, the units, a frame and a cycle in force are
known, and only the selected lines change. A selection is refused when:

- it starts or ends **inside a cycle** (a block of a cycle started or defined above it, a
  modal cycle still in force at its end, a definition in it that is called below it) or
  **inside a block written over several lines** (Klartext `~`, Okuma `$`). Select the whole
  of it. The single passes of a lathe (`G90`, `G92`, `G94`; system B `G77` to `G79`) count
  as such a cycle at the end: a selection that ends while they are in force, and in which the
  run changed something, is refused (`selection-inside`), because a pass below it would run
  from a moved start point or to a moved end point. End the selection after the block that
  ends the passes (a `G00` or `G01`);
- for a mirror, a block of the selection **runs under an arc direction or a compensation
  side set above it**, which would have to be swapped outside the selection. Start the
  selection at the block that sets it.

A selection from **line 1** is a selection too: its end is judged like any other. One that
starts lower needs the lines above it, and all three scripts refuse a run whose lines above
were not sent (`selection-unprimed`): run it on the whole program.

**The first move of a selection** starts where the lines above leave the tool, and that
point is not moved with the selection. Rotate and mirror therefore refuse a first move that
would miss the moved path (`selection-start`): an arc, an incremental move or an incremental
polar move, and on a lathe a move that does not write Z (and Y, where the tool stands away
from Y0). A move to an absolute position is allowed. It writes both plane axes, also for an
axis mirror, where the first block of the selection would otherwise write only the axis it
had. If you rotate the middle of a program, start the selection at such a block. The lines
before and after stay where they were.

Translate refuses the same way: the first block that moves the tool must go to a written
position on **every shifted axis** (with a Z shift, `G0 X10. Y10.` alone runs at the old
height), and an arc, an incremental move or a polar move from there is refused. An axis the
program has not written above the selection, or not since a return to the reference point
or another machine position, stands where the whole run leaves it too, so it need not be
written. Start the selection at a block that writes every shifted axis, or at the retract
before it.

When the first move does not write a shifted axis but the lines above wrote it as a number
(absolute mode), translate **adds the word**, shifted, as they wrote it, and an information
row says so ("Z55. added: the move started at the unmoved Z of the lines above"). It never
adds a diameter word. After a subprogram call, a cycle, a tool change (also a lone `T`), a
work offset, a tool length compensation or a lone `D`/`H`, the position is not known as a
number and the block is refused as before. A **cycle that runs while the tool axis still
stands at the level of the lines above** is refused too (`G98` and `G99` alike): start the
selection at the move that goes to the level, or include it.

**Single passes in a selection** (translate and the Z mirror). A single pass (`G90`, `G92`,
`G94`; system B `G77` to `G79`) goes back to the point it started from. While the tool still
stands where the lines above left it, a pass would go back to a point that is not moved, so
it is refused (`selection-start`), also when it writes nothing but `X`. A pass also takes the
end point it does not write from the pass before; one that takes a shifted (or, for the Z
mirror, its Z) end point from a block above the selection is refused. Start the selection at
the rapid before the passes, and end it after the block that ends them.

#### Undo

A run that writes is **one undo step**: a single Undo gives back the whole program. A refused
run changes nothing and has no undo step.

#### How long it may run

The three scripts are allowed 15 minutes (900 seconds), more than the other scripts, because
a rotation or an angled mirror of a program with several hundred thousand lines of arcs takes
minutes. A script that runs past the limit is stopped and the document is not touched.

#### What translate, rotate and mirror do not cover

Rotate and mirror work in the XY plane of a milling program, and the Z mirror in the ZX
plane of a lathe. Not covered: the other planes, rotating a lathe program, mirroring one in
X, five-axis programs, a program in a coordinate rotation, mirror, scaling or tilted plane,
subprogram and macro calls, positions that come from variables, Klartext free contours (FK) and
the arcs `CT`, `CTP` and `CIP` under rotate and mirror, Okuma arcs by an `L` radius, and the
cycles with positions of their own (pockets, patterns, `PATTERN DEF`), and the Klartext
pocket cycles with an angle under rotate and mirror. A block that starts with a keyword
gEdit does not know and that has no value (Klartext `TCH PROBE`, `FUNCTION …`, `DECLARE`,
`SEL`) is refused as a code the database does not know, and an assignment to a system
variable, or Klartext `FN 17`, as a coordinate shift. A scaling factor of 1 (Klartext cycles 11
and 26) ends the scaling, so it is no frame. A later version may allow some of them.
Under the Z mirror, also not covered: a roughing cycle with its contour in the selection.

## Where scripts live

| Folder | |
|---|---|
| The bundled folder, inside the application | Read-only. Hide it with `Settings ▸ Scripts ▸ Show the scripts that ship with gEdit`, then **Rescan** |
| **Your own folder**, `scripts`, in the folder that holds your settings ([Where things are](README.md#where-things-are)) | Created on first start. The settings dialog shows the path |
| **Extra folders** you add | `Settings ▸ Scripts ▸ Extra script folders`, or the **Add Folder** command. A shop can keep its scripts on a share this way |

Rules worth knowing:

- **One level of subfolders** becomes the groups on the Scripts tab. Deeper folders are
  ignored.
- A script **takes the place of** one with the same file name in an earlier folder: yours
  wins over a bundled one, an extra folder wins over both.
- `gedit_nc.py`, and any file whose name starts with `_` or `.`, is library code and is
  not listed as a script. A subfolder whose name starts with `_` or `.` is skipped too.
- A folder that is missing — an unmounted share, say — is not an error: its scripts are
  simply not listed until it is back and the list is read again (**Rescan**, or a restart),
  and the rest of the list works.
- **The list is read when it is built, and the header is checked again at every run.** After
  you add a script outside gEdit, use **Rescan**. If you change a script's `input` or
  `output` — in gEdit or outside it — and run it without a Rescan, gEdit notices, says
  *<script> was changed since the script list was loaded. Reloading the list and running it
  again.*, reloads the list and runs the script with its new header (the parameter form
  opens again, with what you had just entered). A script switched to `panel` can no longer
  replace the document with its old mode. The name, the description, the dialects and the form
  are only read when the list is built, so **Rescan** after changing those; `timeout` is read
  again at every run, and the code itself always runs as it is saved.
- **A script's file name** is a plain name: **New Script** refuses `/`, `\`, `:`, `<`, `>`,
  `"`, `|`, `?` and `*` ("Use a plain file name: none of / \ : < > " | ? * and no leading _
  or ."). On Windows a file that carries one of these characters is not offered as a script
  either.

[Packages](#script-packages) add a fourth place for scripts: one folder per package.

The script commands also include **New Script** (writes a commented template into your
folder, opens it for editing and lists it) and **Edit Script** (opens the source of a
script in your own folder or an extra folder; on a bundled script it offers **Copy and
edit** instead — the bundled file itself is never made writable).

## Script packages

A package is a folder that holds scripts, profiles and code files that belong together, for
example everything one shop uses for its lathes. It is copied in, not installed: gEdit never
downloads a package and has no "install from a link".

Packages live in the `packages` folder next to your settings ([Where things
are](README.md#where-things-are)); **Settings ▸ Packages** shows its path. One package is one
folder inside it:

```text
packages/
  shop-a/
    package.json        optional: name, version, description (a label only)
    scripts/            .py files, one level of group folders
    profiles/           *.json  your profiles, as in the profiles guide
    codes/              *.json  code files, templates included
```

**The folder name is the package.** Use lower case letters, digits, `.`, `_` and `-`, starting
with a letter or digit, at most 64 characters. A folder with another name is listed with the
reason and not read. A name that starts with `.` is skipped. `package.json` only supplies the
name shown on the page, the version and a description; a missing one is a note, a wrong entry
in it is ignored with a note, and nothing in it decides what loads. At most 32 packages are
read, and a folder that is a link is listed with an error and not followed: copy the package
in. If the `packages` folder itself is a link, gEdit lists no packages and says so. Files inside
a package follow the rules of your own files (plain names, at most 1 MB each, UTF-8 text, no
links). Over all packages together gEdit reads at most 32 MB per listing; a file beyond that is
listed as not read.

**The Packages page** shows one row for each package: its name, version, description, how many
scripts, profiles and code files it holds, a switch and any problems. **Reload** reads the folder
again. The switch takes effect at once, without a restart: a package that is off contributes
nothing, no script, no profile and no code file, and its script commands disappear from the
Scripts tab and the palette. The switch is the setting `packages.disabled`, a list of folder
names; a name in it with no folder is kept in case the folder comes back.

**Which one wins.** Where two sources have the same name, the nearer to you wins:

- **Scripts.** The order is the bundled scripts, the packages by name, your own folder, then your
  extra folders. A script replaces one with the same file name from an earlier source, so your
  own scripts beat a package's, and a package further down the alphabet beats an earlier one.
  The replaced script stays listed, marked as hidden behind the other.
- **Profiles and code files.** A package sits between the built-in files and your own. A profile
  of yours with the id of a package profile replaces it, with a notice. Two packages with a
  profile of one id: the first package by name loads, the second is reported. A package profile
  that uses the id of a built-in profile is reported and not loaded. Code files are laid over the
  built-in ones package by package, then yours, member by member, as for [your own code
  files](profiles.md); every changed meaning is shown as a notice. A profile may extend a
  profile from any layer below it.

A problem says where it is, for example *package shop-a: lathe.json*.

**A package script cannot be edited in place.** Its commands in the Scripts tab are listed
under the package's name. **Edit Script** offers **Copy to My Scripts** instead; the copy goes
to your own folder, shadows the original, and is yours to change. To change the package itself,
edit the files in its folder.

**Trust.** A package is as trusted as a script you wrote: its scripts run with your rights (see
[Security](#security)). Switching a package on is your decision, and nothing runs just because a
package is listed. A package that arrives in a [configuration
file](configuration.md#export-and-import) needs the trust tick when it holds scripts.

---

## Writing a script

**New Script** gives you a working template with the whole header commented. What follows
is the reference; the [script contract](../../src-tauri/resources/scripts/README.md) that
ships next to the bundled scripts has the same rules in full, for a developer.

### The header

A comment block at the top of the file. The content is TOML. gEdit reads it; your script
never has to.

```python
#!/usr/bin/env python3
# /// gedit
# name = "Scale lathe feeds"
# description = "Multiply F values by a percentage."     # the tooltip
# profiles = ["fanuc-lathe", "okuma-osp", "sinumerik"]   # omit = offered everywhere
# input = "selection-or-document"                        # document | selection | selection-or-document | none
# output = "replace"                                     # panel | replace | new-document | report
# timeout = 60                                           # seconds; omit = the setting
# envelope = true                                        # stdout is {"text", "message", "findings"}
#
# [[params]]
# id = "percent"
# label = "Percentage"
# type = "number"
# default = 100
# min = 1
# max = 500
# ///
```

An example. The bundled **Scale feed rates** declares no `profiles`, so it is offered on
every dialect.

`profiles` lists dialect ids — `fanuc-gcode`, `fanuc-lathe`, `heidenhain-klartext`,
`okuma-osp`, `sinumerik`, `sinumerik-mill` — compared exactly: a script for `fanuc-gcode` is
not offered on `fanuc-lathe`, and one for `sinumerik` is not offered on `sinumerik-mill`. An empty list means every dialect, and an id gEdit does not know is not
reported.

The block has to come first: only blank lines, a `#!` line (line 1) and a coding line
(line 1 or 2) may stand above it. Every line of it is a comment, it ends at `# ///`, and it
has to close within the first 64 KiB of the file. `name` is required. A key gEdit does not
know is ignored without a message, so a misspelt `ouput = "replace"` leaves the script in
panel mode. `documents` is accepted (`"active"`, `"all-open"` or `"pick"`), but a script
always gets the active document.

When gEdit refuses a header, the script is listed under its file name, runs in panel mode,
and its tooltip says that the header could not be read — not why. A script with no header
at all runs the same way: stdin in, raw output in the Script Output panel.

### Parameters

Each `[[params]]` block becomes one field of the form that opens before the run, and the
values arrive in the context as `params`. Fields are remembered per script.

| `type` | The field |
|---|---|
| `number`, `integer` | A number, with optional `min`, `max`, `decimals` |
| `text` | A line of text |
| `bool` | A checkbox |
| `choice` | One of `choices = [{ label = "...", value = ... }]` |
| `file`, `folder` | A path, picked with the system dialog |
| `address-list` | Check boxes over the `choices` you list; the value is the list of the checked values |

`label` is what the form shows, `help` the line under it, `default` the pre-filled value,
`required` whether it may be left empty.

Every field needs an `id` (ASCII letters, digits, `_` and `-`, not starting with a digit,
and not used twice), a `label` and a `type`. A field is optional unless it sets
`required = true`. A `choice` needs `choices`, and a `default` must suit the type.
Otherwise gEdit refuses the whole header, and the script runs in panel mode.

### What the script gets

- **stdin**: the input text, UTF-8, lines separated by LF. `gedit_nc.read_input()` gives
  it to you as a list of lines.
- **The environment variable `GEDIT_CONTEXT`**: the path of a JSON file, deleted after the
  run. `gedit_nc.load_context()` reads it.

```json
{
  "contract": 2,
  "document": { "path": "/jobs/part42.nc", "name": "part42.nc", "profile": "fanuc-lathe",
                "encoding": "windows-1252", "hasBom": false, "lineEnding": "crlf", "modified": true },
  "input":    { "scope": "selection", "startLine": 120, "endLine": 180,
                "precedingLines": ["%", "O1000 (BRACKET)", "..."] },
  "cursor":   { "line": 130, "column": 5 },
  "params":   { "percent": 90 },
  "profile":  { "id": "fanuc-lathe", "syntax": {}, "addresses": {}, "numbering": {} },
  "codes":    [ { "code": "G84", "group": "cycle", "pitchFeed": true } ],
  "machine":  { "id": "lathe-2", "name": "Lathe 2", "choice": "document",
                "params": { "numberInput": { "mode": "increment", "incrementMm": "0.001" },
                            "units": "mm", "diameter": "on",
                            "variants": { "gcodeSystem": "B" },
                            "modalInitial": { "feedmode": "G95" } },
                "source": { "numberInput": "machine", "units": "profile",
                            "diameter": "profile", "variants": { "gcodeSystem": "machine" },
                            "modalInitial": { "feedmode": "machine", "plane": "profile",
                                              "spindlemode": "profile" } } }
}
```

A number field left empty — and a choice with no default that nobody picked — is not in
`params` at all: read it with `params.get(…)`. An empty text, file or folder field arrives
as `""`, an unticked box as `false`, an empty address list as `[]`.

`profile` is the dialect and `codes` is its code database, so a script can ask what a
comment looks like, how blocks are numbered or what `G84` means **in this dialect** instead
of assuming Fanuc. `contract: 2` marks the shape; a script started without a context gets
`{}` and should fall back to defaults, or say what it is missing, rather than fail with a
traceback.

Both of them arrive with the document's [machine](machines.md) **already applied**: the
G-code system the machine is set to has picked the code database, its power-on modes are in
the profile, and `syntax.decimalPointSignificant` follows how that control reads numbers. A
script that only scales values never has to know that machines exist.

`machine` is the machine itself, for the scripts that do. `source` says where each parameter
came from — `"machine"`, `"detected"` or `"profile"` — so a script can tell a value it was
told from one it is assuming. A document with no machine still gets the member: the
dialect's documented defaults, except a G-code system gEdit detected in the program, and
the power-on feed mode that system brings, whose source is then `"detected"`; every other
source is `"profile"`. Read it with `gedit_nc.machine_params(context)`, which answers the
defaults, every source `"profile"`, for a context from an older version of gEdit that does
not carry the member at all.

`choice` is `"document"` (chosen for this program or remembered for its file; `id` is
`null` when that choice was "none"), `"default"` (the dialect's default machine) or
`"none"` (nothing chosen and no default set). Test `id`, not `choice`.

`input.precedingLines` is what makes a selection run trustworthy: the document lines above
`startLine`, so a script can work out the modal state — feed mode, the active cycle,
constant surface speed — that the selection is really written in. It is **absent** for a
whole-document run, which already sees everything, for a selection that starts on line 1,
and when more than 50,000 lines or about 4 MB of text stand above the selection. Read it
with `gedit_nc.preceding_lines(context)`, which answers `[]` in all of those cases and in
every case where the field cannot be trusted; a script that gets `[]` for a selection that
does not start on line 1 should say so rather than guess.

Also set for you: `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` (so comments with umlauts
survive on Windows), the working directory is the script's own folder (so a helper module
next to it imports), and `PYTHONPATH` is set to the bundled folder (so `import gedit_nc`
works from your own scripts too) — replacing one of your own, so keep helpers next to the
script or use a virtual environment's interpreter. `PYTHONDONTWRITEBYTECODE=1` keeps
`__pycache__` out of your folders.

Write **the result** to stdout and anything else to stderr.

### The output

`output = "replace"` or `"new-document"`: stdout is the new text.

**The trailing-newline rule, in full**, because half of it is a trap. One trailing newline
is dropped **only when the input did not end with one**. So `print("\n".join(lines))` is
right on a program whose file has no final newline, and adds a blank line at the end of one
that has — which is the normal case, and invisible to the person running it. The rule
cannot be better than that: always dropping would eat the real trailing blank line of an
echo written with `sys.stdout.write(stdin)`.

Write the result with **`sys.stdout.write("\n".join(lines))`**, which is correct either
way, or with `gedit_nc.envelope()`, whose `text` is used exactly as you gave it. The
example at the end of this page does the first.

`output = "report"`: stdout is JSON. `gedit_nc.report()` writes it for you:

```python
gedit_nc.report(
    title="Tool list",
    columns=[{"key": "tool", "label": "T"}, {"key": "line", "label": "Line"}],
    rows=[{"tool": 1, "line": 12}],
    message="8 tools, 2 without a description",
    findings=[{"line": 250, "severity": "warning", "message": "Feed move while the spindle is stopped"}],
)
```

A row or a finding that carries `line` is clickable. `severity` is `info`, `warning` or
`error`. `line` is a line number of the document, not of stdin: in a selection run add
`context["input"]["startLine"] - 1`. A finding needs `line` and `message`, or the whole
result is refused. At most 1000 findings and 5000 rows are taken, and the panel says how
many more there were.

`envelope = true` on a `replace` or `new-document` script: stdout is always JSON, so a
script can hand back new text **and** a summary **and** warnings together —
`gedit_nc.envelope(text, message, findings)`. This is how the bundled scale scripts report
the feeds they refused to touch.

### Channels in a script

On a machine with [channel settings](channels.md), the context has one more member,
`channels`. A document with no channels does not have it, so a script written before
channels existed runs unchanged, and `contract` stays 2.

```json
"channels": {
  "layout": "single-file",
  "self": null,
  "list": [ { "id": "a", "name": "Turret A", "ranges": [ { "startLine": 3, "endLine": 7 },
                                                         { "startLine": 13, "endLine": 14 } ] },
            { "id": "b", "name": "Turret B", "ranges": [ { "startLine": 8, "endLine": 12 } ] } ],
  "outside": [ { "startLine": 1, "endLine": 2 } ],
  "marks": [ { "id": "P10", "line": 5, "channel": "a", "partners": ["b"], "blocking": true } ]
}
```

- `layout` is `"single-file"` (one program, a section for each channel) or `"multi-file"`
  (one program for each channel).
- `self` is the channel this document is, in `multi-file`. In `single-file` it is `null`,
  because the document holds several.
- `list` has every channel the machine declares. In `single-file` each has `ranges`: every
  stretch of lines that belongs to it, in program order, empty if the channel was not found.
  In `multi-file` each has `file`, `path` and `open`.
- `outside` (`single-file`) holds the stretches that belong to no channel.
- `marks` are the waits found in **this document** only: the line, the channel the wait is
  in, the channels it waits for, and its number (`id`; `""` for a rule that only counts
  and has no code). `channel` is `""` for a wait outside every section. A script never
  receives the text of another file.

Line numbers are the document's, as everywhere in the context. In a run on a selection, the
`channels` member still describes the whole document, but the helpers below give only the
part of each channel inside the selection.

`gedit_nc` reads it for you. Each answers an empty result on a document without channels,
so a script that uses them also runs on a plain program:

| Call | Gives |
|---|---|
| `gedit_nc.channels(ctx)` | The member, or an empty one with the same keys (`"layout": "none"`, `"self": None`, and empty `list`, `outside` and `marks`), so any of them can be read without checking |
| `gedit_nc.channel_of(ctx, line)` | The id of the channel a line belongs to, or `None` |
| `gedit_nc.channel_lines(ctx, lines, channel_id)` | The lines of one channel: all of its sections joined in program order, which is what a control does when it splits a program into one program for each turret. Never a line from outside the channels |
| `gedit_nc.channel_line_numbers(ctx, lines, channel_id)` | The program line number of each line `channel_lines` gives, in the same order |
| `gedit_nc.outside_lines(ctx, lines)` | The lines that belong to no channel |
| `gedit_nc.outside_line_numbers(ctx, lines)` | Their program line numbers |
| `gedit_nc.sync_marks(ctx, channel_id=None)` | The waits found, of one channel or of all |

A script that works per channel groups its results with `channel_of`. A script that does
not care about channels needs no change.

### The library

`gedit_nc.py` sits next to the bundled scripts and is importable from yours: it reads the
context and the input, reads a line the way the dialect does (`tokenize_line`), keeps NC
numbers as decimal text rather than floats, follows what is modal (`ModalInterpreter`, and
the smaller `FeedModeTracker`), reads a word's number the way the machine does, and writes
the two JSON result shapes. Every public name, with what it is for, is listed in
[the library reference](../../src-tauri/resources/scripts/README.md#7-what-gedit_nc-gives-you);
the docstrings in the file have the detail.

On a dialect that defines a cycle once and calls it later (Klartext), `ModalInterpreter.state`
also carries `definedCycle` (the last `CYCL DEF`, which no call ends) and `modalCall` (the
`M89` that runs it after every positioning block); `defined_cycle` and `modal_call` read them.
`active_cycle` includes the defined cycle while a modal call runs it. `FeedModeTracker` is
unchanged. On the other dialects both are `None`.

The modal state also carries, since the checks and the arithmetic needed them, the
coordinate **frame** in force (`frame`: a tilted plane, a rotation, a mirror, a scaling, or
`None`) and **tool centre point control** (`tcp`: the code that switched it on, or `None`);
`RotaryState` follows where each rotary axis stands while tool centre point control is off,
and `position_of` says what a cycle parameter is to a shift of positions (an absolute
coordinate on the tool axis or not). The three bundled scripts use them; so can yours. A
code database entry can also carry a few optional members that the checks read, for example
`conflicts`, `alone` and `requires` ([the library reference](../../src-tauri/resources/scripts/README.md)
lists them all).

### Five rules that matter more than any feature

1. **A selection is a fragment of a modal language.** `G95` three hundred blocks above the
   selection still decides what every `F` in it means. Prime your tracker with
   `preceding_lines` + `prime_tracker`, and when they give you nothing, say so in a finding
   instead of assuming the top-of-program state.
2. **Work on tokens, not on a regular expression over raw lines.** `tokenize_line` knows
   what is a comment, a string, a variable and an expression *in this dialect*. A naive
   `re.sub` rewrites the `G1` inside `(FINISH G1 PASS)` and corrupts the program. Inside a word
   or a comment you already isolated a pattern is fine; how Python's `re` differs from the
   editor's find, and the NC examples, are on [Regular expressions](regex.md#in-a-script).
3. **Never widen or narrow a number by accident.** Use `scale_decimal` and `format_number`,
   never a float. They keep `10.` from becoming `10`, keep the precision each value was
   written with, and round the way the editor's own transformations do.
4. **Ask the code database what a value means, not a table of your own.** The same `F` is a
   feed, a thread pitch or a thread lead depending on what is in force, and the dialect's
   database in `context["codes"]` is what says which; the trackers read it for you.
5. **When you are not sure, leave the value alone and say so** in a finding on its line —
   the value, the reason, what to do. Refusing a feed costs one edit; scaling a thread lead
   scraps the part.

Write for Python 3.9 as well as for the newest release: no `match`, no `X | Y` outside
annotations, and `from __future__ import annotations` at the top. A script you share, like
the bundled ones, uses the standard library only; your own may use a virtual environment's
interpreter.

### Numbers, and the machine

`X50` is 50 mm on one control and 0.050 mm on the next, and which one it is depends on a
machine parameter rather than on the dialect ([Machines](machines.md)).

A script that only **scales** can ignore all of it. Multiplying is unit-free: the same
arithmetic is right in every reading, and `syntax.decimalPointSignificant` already follows
the machine. A script that **compares** a value with a limit, or **computes** with one, has
to ask: `machine_params` for the machine, `number_class_of` for what kind of number the word
is in this block, `resolve_value` for what it is worth — decimal text in millimetres,
inches, degrees or seconds, or nothing when the reading depends on a machine nobody chose —
and `write_back` to put a value back into the word in its own form: a point stays a point,
a point-less word stays a count, and you are told when it had to round.
[The library reference](../../src-tauri/resources/scripts/README.md#why-your-script-needs-the-number-rules)
has the whole loop as a worked example that runs as it stands.

**Never divide by a thousand yourself, and never assume a point-less word is a count.** The
machine decides, and where no machine was chosen gEdit refuses to decide for it. Say so in a
finding instead.

### A minimal example

```python
#!/usr/bin/env python3
# /// gedit
# name = "Remove optional stops"
# description = "Delete every line that contains M1 outside a comment."
# output = "replace"
# ///
from __future__ import annotations

import sys

import gedit_nc


def main() -> int:
    context = gedit_nc.load_context()
    if not context.get("profile"):
        print("Run this from gEdit: it needs the dialect.", file=sys.stderr)
        return 1
    cp = gedit_nc.compile_profile(context["profile"])
    kept = []
    state = None
    for line in gedit_nc.read_input():
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        if any(t.kind == "word" and gedit_nc.normalize_code(t.text) == "M1" for t in tokens):
            continue
        kept.append(line)
    sys.stdout.write("\n".join(kept))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### Running another program from a script

A script is an ordinary program, so it can start another one: the shop's own formatter, a
checker that reads the NC text, a converter. gEdit has no "external commands" feature of its
own; this is how you get one. The example passes the selection through a tool and replaces
it with what the tool prints.

```python
#!/usr/bin/env python3
# /// gedit
# name = "Format with the shop tool"
# description = "Pass the selection through the shop's own formatter and replace it with the result."
# input = "selection-or-document"
# output = "replace"
# timeout = 60
# ///
from __future__ import annotations

import subprocess
import sys

import gedit_nc

TOOL = ["/opt/shop/bin/ncformat", "--stdin", "--stdout"]   # your program and its arguments


def main() -> int:
    lines = gedit_nc.read_input()
    try:
        done = subprocess.run(
            TOOL,
            input="\n".join(lines),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=45,          # shorter than the script's own `timeout`
        )
    except (OSError, subprocess.TimeoutExpired) as err:
        print("Could not run %s: %s" % (TOOL[0], err), file=sys.stderr)
        return 1
    if done.returncode != 0 or not done.stdout.strip():
        print(done.stderr or "The tool returned nothing.", file=sys.stderr)
        return 1
    sys.stdout.write(done.stdout.rstrip("\n"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Four habits keep it safe:

- **A list of arguments, never `shell=True`.** A file name or a program fragment must never
  be read as a command line.
- **A timeout on the child, shorter than the script's own.** Stopping a script ends the
  programs it started as well, but a child that hangs should fail with a clear message of
  its own instead of waiting for the script's limit.
- **A failure ends the script with an error.** A non-zero exit means gEdit applies nothing
  and shows what the script wrote on its error output; an empty result in `replace` mode is
  refused too. Never print half an answer.
- **The tool runs with your rights**, like the script. Read it before you trust it with a
  program, and see [Security](#security).

---

## Security

This is the honest version, because a comfortable one would be misleading.

**A script is an ordinary program with your rights.** It can read and write any file you
can, and reach the network. gEdit cannot sandbox it, and does not pretend to.

What gEdit does guarantee:

- **Nothing runs by itself.** Not on open, not on save, not on a timer. A script runs
  because you asked for it.
- **Only scripts in the listed folders run**, named by an id the editor validates: no
  path outside a script folder, no `..`, no symlink out of one, and no shell — the
  interpreter is started directly with the script as an argument, so a file name can never
  be read as a command line.
- **Bundled scripts are never writable.** The scripts that ship with gEdit are the scripts
  that run.
- **A run is bounded**: a time limit, a **Stop** button, capped output (64 MiB of result,
  1 MiB of error output), and it is killed when the app exits. The processes the script
  started are stopped with it, on Windows too; only a program the script left running after
  it finished by itself stays.

What that does **not** mean: it bounds *which file* runs, for how long and how much it may
say — it says nothing about what is **in** that file. The interpreter and the script
folders are ordinary settings; anything that can change your settings file can point gEdit
at a different interpreter, and **New Script** creates a writable, runnable file by
design.

So the rule is the one at the top of this page: **only run scripts you trust.** Read a
script before you run it, the same way you would read a macro somebody mailed you. They
are short, and they are meant to be read.

## When something does not work

| | |
|---|---|
| The Tools and Scripts tabs say "Python 3.9 or newer was not found, so the script commands are off" | No Python, or one older than 3.9. Set `Settings ▸ Scripts ▸ Python interpreter` to the interpreter's path |
| A script is not on the Tools or Scripts tab | It may be for other dialects (`profiles` in its header), it may be hidden behind a file of the same name in a later folder, its name or its subfolder's name starts with `_` or `.`, it sits more than one folder deep, or the bundled scripts are hidden. Use **Rescan** after adding it |
| It appears under its file name, and the tooltip says the header could not be read | gEdit refused the header (see [The header](#the-header)); it then runs in panel mode and shows raw output only. Fix it, then **Rescan** |
| *The program changed while the script ran* | You typed in the document while it ran, so nothing was applied. Run it again, or take **Open in new tab** |
| *<script> was changed since the script list was loaded* | You edited the script's `input` or `output` and ran it without Rescan. gEdit reloads the list and runs it again with the new header; nothing to do |
| New Script says *Use a plain file name* | The name has one of `/ \ : < > " | ? *` or starts with `_` or `.` |
| It is stopped every time | It needs longer than the time limit: raise `Settings ▸ Scripts ▸ Script timeout` (up to an hour), or set `timeout` in the script's header (up to a day) |
| Nothing comes back at all | Look in the **Script Output** panel: whatever the script wrote to its error output is there |
