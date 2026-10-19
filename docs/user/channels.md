# Channels

Some controls run more than one program at the same time. A lathe with two turrets cuts
with both. A Fanuc lathe with two paths runs path 1 and path 2. A Sinumerik has channels.
Each of these streams of blocks is a **channel** here, whatever your control calls it.

The channels run on their own, and now and then one waits for another. The waits are
ordinary codes in the program, such as `M901 P3`. If one channel waits and the other never
answers, the machine stops, or worse, cuts at the wrong time. A post that writes the two
streams makes that mistake easily, and the mistake is hard to see in 4,000 lines.

gEdit can show you the channels apart and check that the waits fit each other. This page
says how to set that up, what you see afterwards, and what the check can and cannot tell
you.

| In this page | |
|---|---|
| [What gEdit does with a channel, and what it does not](#what-gedit-does-with-a-channel-and-what-it-does-not) | Read this first |
| [Switching it on](#switching-it-on) | A preset, or by hand |
| [Layout one: all channels in one program](#layout-one-all-channels-in-one-program) | A worked example |
| [Layout two: one program for each channel](#layout-two-one-program-for-each-channel) | A worked example |
| [The wait codes](#the-wait-codes) | The list, the `P` word, the preview and the error messages |
| [What kind of wait it is](#what-kind-of-wait-it-is) | Three kinds, and why the choice matters |
| [Presets, and what to check on your machine](#presets-and-what-to-check-on-your-machine) | Starting points, all marked "verify" |
| [Seeing the channels](#seeing-the-channels) | The status bar, the program map, the keys |
| [Check Wait Codes](#check-wait-codes) | What it finds, and what to do about each finding |
| [The channel view](#the-channel-view) | One pane for each channel, lined up at the waits |
| [Split into Channel Documents](#split-into-channel-documents) | One document for each channel, and merging them back |
| [In a script](#in-a-script) | |
| [Known limits](#known-limits) | |

---

## What gEdit does with a channel, and what it does not

gEdit does **five** things with channels:

1. It finds out which lines belong to which channel, or which file is which channel.
2. It shows them apart: in the program map, in the status bar, in the tool list.
3. It finds the **wait codes** and lets you jump from a wait to the wait that answers it.
4. It compares the waits of the channels and tells you where they do not fit.
5. It shows the channels in the **channel view**, lined up at the waits ([below](#the-channel-view)).

gEdit does **not**:

- **Run the channels or know how they run.** It does not know what a wait does, how long it
  takes, or what the other channel may do meanwhile. A machine setting says where the
  channels are and which lines are waits. That is all it says.
- **Reorder anything.** The program stays exactly as it is. Nothing is moved from one
  channel to the other, and nothing is written for you.
- **Synchronize anything.** gEdit never adds, removes or renumbers a wait. It tells you
  what does not fit and you decide.
- **Show a time axis.** The panes are lined up at the wait codes, not at the clock. A line
  that takes long and a line that takes no time are one line high.
- **Open files by itself.** For a program with one file per channel, gEdit looks whether the
  other files are there, and tells you. You open them yourself, or pick them in the file
  dialog that **Channels Side by Side** opens.

So the check is a second pair of eyes on **what is written**: the numbers of the waits and
the order they are written in. It is not a simulation, and a clean result is not a proof
that the program runs. [Check Wait Codes](#check-wait-codes) says what that means in
detail.

Everything on this page is **off** until you give a machine channel settings. A program on a
machine without them, or with no machine, looks and works as before.

---

## Switching it on

Channels are a setting of the [machine](machines.md), because they belong to your control
and your post, not to the dialect. They are offered for the Fanuc lathe, Okuma and Sinumerik
(turning and milling).

1. `Settings ▸ Machines`, pick the machine (or add one), and scroll to **Channels**.
2. Either choose a **preset** under *Start from a preset* and press **Use this preset**, or
   fill the settings in by hand as described below.
3. Check **Try these settings on a program** (paste a part of a program and see what gEdit
   finds), then **Save**.

The settings are described step by step in [Machines](machines.md#channels). The next
sections say what to put in them.

A preset is a **starting point**. Read [the presets](#presets-and-what-to-check-on-your-machine)
before you rely on one.

---

## Layout one: all channels in one program

Some posts write both channels into **one** program, one section after the other. On an
Okuma two-turret control, `G13` starts the lines for turret A and `G14` the lines for
turret B:

```
O1000 (TWIN TURRET)
G00 X200. Z200.
G13
T0101
G00 X52. Z2.
P10
G01 Z-40. F0.2
G14
T0202
G00 X30. Z2.
P10
G01 Z-20. F0.1
G13
G00 X200. Z200.
G14
G00 X200. Z200.
M30
```

In the Channels step this is:

| Field | Value |
|---|---|
| **How are the channels stored?** | *All in one program, one section for each turret* |
| **The channels** | `a`, name "Turret A", also written as `G13` · `b`, name "Turret B", also written as `G14` |
| **A section starts at the line matching** (Advanced) | A pattern that finds `G13` and `G14` and calls the part it found the channel: `(?<![A-Z0-9.])(?<channel>G0?1[34])(?![\d.])` |
| **Wait codes** | `P1-P9999`, kind *Order numbers*, turrets named by *Every turret* |

Read the example like this.

- The first two lines, above the first `G13`, belong to **no channel**. They are the
  program's header.
- `G13` starts a section for turret A. It runs until the next section starts. `G14` starts
  one for turret B.
- **A channel may start a section as often as the program needs.** Turret A has two
  sections here, lines 3–7 and 13–14. gEdit joins them in the order they appear and treats
  them as one channel. In the program map you see one entry for turret A, with the tools and
  waits of both sections.
- Without a **section end**, a section runs to the next start, or to the last line. If you
  give a pattern for the end, the lines between an end and the next start belong to no
  channel. gEdit shows them as **Outside the channels**: think of a subprogram written
  after the sections that both channels call. They are never counted for a channel and are
  never in a split copy. They are not a problem.
- A start line may name **several channels** in one go, such as `+S1/S3`. Give the
  separator (`/`) under Advanced. That section then counts for each of them.

If a start pattern has no `(?<channel>…)` in it, the first start is the first channel in
your list, the second is the second, and so on. That works only if the program starts the
channels once each, in order.

### Aliases

One channel usually has **more than one name**. A turret is "Turret A" in your reports, `a`
in the settings, `G13` in the program, and maybe `G013`, because the control reads leading
zeros. On a Sinumerik a wait names its partners as `WAIT_K1`, the file is called `…_1`,
the setting is `1`. The field **Also written as** is where you list the other spellings, so
gEdit knows that all of them are the same channel. Separate them with commas. Capitals do
not matter, and a spelling can belong to one channel only.

---

## Layout two: one program for each channel

Other posts write one **file** for each channel. On a Fanuc two-path lathe the path number
is often at the end of the extension:

`SHAFT.NC1`

```
O1001 (SHAFT PATH 1)
T0101
G00 X52. Z2.
M901 P3
G01 Z-40. F0.2
M902 P3
M30
```

`SHAFT.NC2`

```
O1002 (SHAFT PATH 2)
T0202
G00 X30. Z2.
M901 P3
G01 Z-20. F0.1
M902 P3
M30
```

In the Channels step:

| Field | Value |
|---|---|
| **How are the channels stored?** | *One program for each path* |
| **The channels** | `1`, "Path 1" · `2`, "Path 2" |
| **File names match** (Advanced) | A pattern for the name with the shared part as `(?<stem>…)` and the path number as `(?<channel>…)`: `^(?<stem>.+)\.[A-Za-z]*-?(?<channel>\d{1,2})$` |
| **The other files are named** (Advanced) | `{{stem}}.NC{{channel}}`: `{{stem}}` is the shared part, `{{channel}}` the other path's number, both with two braces |
| **Wait codes** | `M900-M999`, kind *Numbered waits*, paths named by *The P word as a bit sum*, a wait without a P word means *Every path* |

Open `SHAFT.NC1` and the status bar says which channel it is and whether the other file
exists (see [Seeing the channels](#seeing-the-channels)). gEdit finds the other file by
building its name from the pattern. It looks in the **same folder only**, and looks only
whether the file is there. It does not read it.

gEdit does not open files by itself. A program you did not ask for is not opened, and
nothing outside the folder of the program in front of you is looked at. To open the other
channels, click the channel in the status bar and choose **Open the other channels…**. The
file dialog opens in the same folder. Pick the files you want.

### When the names do not tell

Not every post names the files alike. Three more ways:

- **A name for each channel.** Each channel in the list has its own *File name* field:
  `{{stem}}.MPF` for one and `{{stem}}_GS.MPF` for the other, for example. This is the way when
  the names share no common pattern.
- **A marker in the program.** Some posts write the channel into the header,
  `(PATH 2)` or `;CHANNEL 2`. Give a pattern for that line under Advanced, "A line in the
  program names its path". gEdit looks in the first 400 lines. A marker **wins** over the
  file name. If the two disagree, gEdit uses the marker and says so. If the header names a
  channel gEdit does not know, or two channels, no channel is set for that file and the
  status bar says so.
- **By hand.** Click the channel in the status bar (or use **Assign to Channel…** in the
  palette, `F1`) and choose *Assign this document to Path 2*. gEdit remembers this for the
  file, like the machine of a file, also after a restart. *Remove the assignment* goes back
  to what the name and the program say. Your assignment beats the marker and the name.

If a machine has several files and nothing that tells them apart, the Channels step says:
*Nothing here tells gEdit which file is which channel. Open the files and assign each one to
its channel by hand.* That is how the Sinumerik preset starts.

---

## The wait codes

A wait is a code in the program that stops one channel until the other has got there. Which
codes are waits is **different on every machine and every post**. The machine builder
chooses them. That is why gEdit ships no list of its own. You tell it, once, in the machine.
(The presets are a start, and they are marked "verify".)

### Writing the codes

The field **Wait codes** takes a plain list of codes and ranges:

```
M900-M999, M300
```

- Separate the items with a comma, a semicolon or a blank. `M900-M999 M300` is the same.
- A range is `M900-M999`. `M900-999` is allowed, too.
- Every item starts with the **address letter** that your control uses for waits. On a
  Fanuc that is `M`. On an Okuma, `M` or `P`. On a Sinumerik, `M`.
- Leading zeros do not matter: `M0101` is `M101`.
- A blank after the letter is allowed, as in a program: `M 900` is `M900`.

Under the field a live **preview** says what gEdit understood, for example *Matches M900 …
M999, M300 · 101 codes in all*. Look at it every time. If the preview is not what you
meant, the codes are not either.

If an item is wrong, the field says which one and why, quoting it:

| You see | What it means |
|---|---|
| Enter at least one code, for example M100-M199. | The field is empty |
| “M3OO”: not a number. | A letter `O` where a zero belongs |
| “M199-M100”: the range runs backwards. | The first number is higher |
| “G4”: wait codes on this control use M. | The letter is not one this control uses for waits |
| “100”: a code starts with its address letter, for example M100. | The letter is missing |
| “M100-P200”: both ends of a range need the same letter. | |
| “M99999”: a code is at most …. | The number is too long |
| Use at most … codes or ranges. | Too many items; use a range |
| “to”: write a range with a dash, for example M900-M999. | A word between two codes; a range is written with `-` |

### Matching rules

gEdit reads a block the way the control does.

- `M901`, `M0901` and `M 901` are the same wait.
- `M901.5` is **not** a wait (it is another code), and neither is `M9010` if that is not in
  your list, `M901=1` or `#901`.
- A wait in a **comment** or in a **string** is not a wait.
- A wait on a block-skip line (`/M901`) **is** a wait. gEdit cannot know whether the skip is
  on.
- One block makes one wait. If two of your rules match the same line, the first rule wins.

### Which channels a wait names

A wait does not just stop. It waits **for** certain other channels. The programs tell the
control with the `P` word, and gEdit needs to know how to read it. The setting is the
list under *Paths named by* and has three ways to do it:

**1. The `P` word as path numbers.** Each digit of the `P` word is a path.

| Written | Means |
|---|---|
| `M901 P12` | paths 1 and 2 |
| `M901 P123` | paths 1, 2 and 3 |
| `M901 P0` | path 10 |

**2. The `P` word as a bit sum.** The paths count 1, 2, 4, 8 … and the `P` word is their
sum.

| Written | Means |
|---|---|
| `M901 P3` | paths 1 and 2 (1 + 2) |
| `M901 P5` | paths 1 and 3 (1 + 4) |
| `M901 P7` | paths 1, 2 and 3 (1 + 2 + 4) |

Which of the two your control reads is a parameter of the control. The manual tells you;
see [the presets](#presets-and-what-to-check-on-your-machine).

**3. No `P` word.** Some controls say a wait without `P` means a certain set of paths. Tell
gEdit in *A wait without a P word means*:

- *Every path*: the wait is for all of them.
- *These paths*: you pick which.
- *No partner (reported as not matched)*: a wait without `P` is a mistake on this control,
  and gEdit reports it as one.

This is only used for a line **without** a `P` word. A `P` word gEdit cannot read (`P12.`,
`P#1`, or `P1 2` with a blank between the digits), or two different `P` words in one block,
are reported as a wait that names an unknown channel. They are never read as "no P".

Whichever way you choose, the path a wait is in may be listed too, or not. `M901 P3` in
path 1 is the same as `M901 P2`. gEdit ignores the channel's own number when it looks for
the answer.

On a Fanuc control the waits that meet must also be **written alike**: every path of one wait
names the same paths, and either all of them have a `P` word or none has. `M901 P123` in
path 1 against `M901 P12` in path 2 stops the control with an alarm, and so does `M901`
without `P` against `M901 P3`, although both mean paths 1 and 2. Check Wait Codes checks
this (the finding *Different channels*, below) for every wait rule whose partners are a `P`
word: the Fanuc presets and a rule you build on the machine page. A Sinumerik `WAITM` need
not list the same channels in every channel, so its preset does not.

A channel number is read by its value, as the control reads it: `WAITM(1,01,02)` names
channels 1 and 2.

There are two more, simpler choices in the same list. **Every path** says every wait waits
for every other channel, and **These paths** says it waits for the ones you name. They are
right when the control has no `P` word at all.

A last way sits under **Advanced**: *Found by a pattern on the line*. It is for posts where
the partners are not a `P` word, for example a Siemens `WAITM(1,1,2)` where the channel
numbers are the last two arguments. See [Regular expressions](regex.md).

### Stops and ends

On some controls a program stop or end (`M00`, `M01`, `M02`, `M30`, and `M99` where the
profile treats it as an end) lets a channel wait for the others, because the program as a
whole finishes only when all the channels arrive. Tick **Stops and ends count as waits**,
and gEdit counts the stops and ends of each channel, and compares the numbers. Leave it off
when you are not sure. An optional stop (`M01`) in one channel only is reported when it is
on.

### When the codes are not plain words: Advanced

Not all posts write a wait as a code word. A Sinumerik wait is `WAITM(3,1,2)`. For that,
**Advanced** has two other ways to find the codes: a *start and some digits* (`M1` followed
by two or three digits) and a *pattern* (a regular expression with the wait's number as
`(?<mark>…)`). The patterns are yours to write, because the wait codes differ by machine
and by builder, and gEdit has no right answer to ship. The page
[Regular expressions](regex.md) explains patterns with NC examples, and the **Help with
patterns** link on the Channels step tells you where to find it. Use the tester to see what a pattern finds.

Most machines never need Advanced.

### A builder's own cycle: an Advanced example

Some machines do not wait with `M` codes or `WAITM` at all. The builder's cycle package has a
cycle, and a call of it is the wait. Say your Sinumerik post writes

```
N120 SYNC_C(3)
N130 G1 X20 F0.2
N140 SYNC_C(4)
```

in both channels. `SYNC_C` is the builder's name (here an invented one); the number in
brackets is the mark. To let gEdit see these as waits:

1. On the Channels step, under **Wait codes**, add a block for the builder's waits. In *What is
   checked* choose **Numbered waits**: the same number must meet in the same order in the
   other channel.
2. Open **Advanced** and set *These codes are found by* to **A pattern**.
3. In the *Pattern* field write `\bSYNC_C\((?<mark>\d+)\)`. The part in `(?<mark>…)` is the
   number gEdit pairs; the rest says which line is a wait. Where the number may be a name or a
   variable (`SYNC_C(_M)`), use `(?<mark>\w+)`.
4. Press **Try these settings on a program**, paste the part above, and check that the tester
   shows two waits, 3 and 4, and in the other channel the same two.

The pattern is yours to write and to check: the cycle's name and the way it counts are the
builder's. [Regular expressions](regex.md) explains patterns with NC examples. A call in a
comment or a string is not a wait, as everywhere else.

---

## What kind of wait it is

The check can only conclude something if it knows **what kind** of wait it is looking at.
Pick the one in *What is checked* that fits how the codes work on your control. Picking the
wrong one makes the check report errors in a **correct** program.

| In the settings | Use it when | What the check can conclude |
|---|---|---|
| **Numbered waits**: the same number must meet in the same order in the other path | A wait has a number, and the other path has to have the same number, such as `M901` in path 1 and `M901` in path 2 | For each number: the other path has it too, as often, and in the same order. A number may be used again and again; that is normal |
| **Waits without a number**: every path needs the same number of them | The wait is always the same code, such as `M100` on an Okuma, and a wait in one channel needs a wait in the other | Both sides have the same **count** |
| **Order numbers**: a number must not go down inside a path, and may be missing on one side | The number says which comes first, not which meets which, such as the `P` code of an Okuma | In one channel the numbers only go up. A number on one side only is fine |

Example. Path 1 has `M901 M902 M901` and path 2 has `M901 M902 M901` too. As *Numbered
waits* that is clean. As *Order numbers* it would be reported, because the number goes down
from `M902` to `M901`. The program is right, and the setting was wrong.

---

## Presets, and what to check on your machine

A preset fills the Channels step with a set of settings taken from the control's
documentation. It is only a **starting point**:

- It is offered on the Channels step and **never applied by itself**. gEdit applies one
  only when you press *Use this preset*. If the machine already has channel settings you
  are asked first: *Replace the channel settings below with this preset?*
- It is copied into the machine. You can change everything afterwards.
- **Every preset is marked "verify".** Nobody has confirmed it against your machine. The
  label of each preset says what it assumes. Read it to the end.

| Control | Preset | What it assumes | What to check |
|---|---|---|---|
| Fanuc lathe | **Two paths, one file per path** (two presets) | Files with the path number at the end of the extension; waits `M900-M999` (one builder's range, not Fanuc's); `P` as a bit sum, or as path numbers (`P12`); a wait without `P` means paths 1 and 2; the paths of one wait must name the same paths | Which `P` form the control reads. The wait range: `M900-M999` is a **builder's choice**, not Fanuc's. Look at your own programs and your machine's documentation. The manual describes the range as set by parameters (8110 and 8111) and the `P` form by parameter 8103 bit 1. Whether a stop or end counts as a wait |
| Fanuc lathe | **Three paths** (two presets) | As above, with `P` as path numbers or as a bit sum | Which form the control reads. With three or more paths a wait without `P` is an error on the control, so the presets report it |
| Fanuc lathe | **Two paths, files tied by hand** | No file-name rule; waits `M900-M999` written **without `P`**: a wait with no `P` means paths 1 and 2, and a `P`, when written, names path numbers (`P12`) | That your post writes the waits with no `P`. Open the files and assign each to its path by hand (see [When the names do not tell](#when-the-names-do-not-tell)) |
| Fanuc lathe | **Three paths, files named `<name>_<path>`, no `P` means 1 and 2** | Files `PART_1.ISO`, `PART_2.ISO`, `PART_3.ISO`; waits `M190-M199`; `P` as path numbers (`P123` is all three); a wait without `P` means paths 1 and 2. **Careful:** the file-name rule also catches a version file such as `SHAFT_2.NC`, which it reads as path 2 | That the range and the "no `P` = 1 and 2" are what your machine does. Where your folders hold version files, do not use a file-name rule; assign the files by hand |
| Fanuc lathe | **Two heads, `M100-M197`** | Files tied by hand ("Head 1", "Head 2"); the waits are `M100-M197`, the same code in both head programs, written without `P` (paths 1 and 2). On this kind of machine `M198` calls a program on an external device and is **no wait**; `M199` is not one either | That the codes your post uses for the heads are in `M100-M197` |
| Okuma | **Two turrets in one program** | `G13` or `G013` starts turret A, `G14` or `G014` turret B, as often as needed; `P` codes in order (smaller number first); `M100` by count | That your post writes the turret starts that way. That the `P1-P9999` range is what your post uses |
| Sinumerik | **Two channels in one archive file** | Channel 1 starts at `%_N_1_0_MPF`, channel 2 at `%_N_2_0_MPF`; the archive's other sections (`%_N_1_7_MPF` tool data and the like) belong to no channel. The waits are the same as in the next row | That your archive numbers its channel sections that way |
| Sinumerik | **Two channels, one program per channel, named `<name>_C1.MPF`, `<name>_C2.MPF`** | The files are tied by the `_C<n>` in the name; the waits are as in the next row. A machine that synchronises its channels through its builder's own cycle needs [Advanced rules](#a-builders-own-cycle-an-advanced-example) | That your files are named that way. That the machine uses `WAITM` and not a cycle of the builder |
| Sinumerik | **Two channels as tagged sections of one file** | `<PROG_BEGIN_C1>` starts channel 1, `<PROG_BEGIN_C2>` channel 2, and a `<PROG_END_…>` line ends the section; other tagged sections belong to no channel. The waits are as in the next row | That your post writes the tags that way |
| Sinumerik | **Two channels, one program per channel** | `WAITM` and `WAITMC` with a mark number (a number or a variable such as `_M`, paired by its text); `SETM` answers a `WAITM` of its mark in the other channel, `CLEARM` answers nothing; neither is checked itself, and both are reached with Next/Previous Sync Point but not listed in the map; `WAITE` not counted; no rule for the file names | That your post writes the mark numbers and channel numbers in the order the preset reads them. Add a file-name rule or assign the files by hand |

**A file-name rule belongs to a machine, never to a default.** A rule such as "the path
number after the last underscore" reads `PART_2.ISO` as path 2. It reads `SHAFT_2.NC`, the
second version of a program, as path 2 as well; in a folder of real programs a good part of
the names ending in `_<n>` are versions and not channels. That is why no profile ships such a
rule on its own, and why the presets that carry one say so in their label. Use one only for
the machine whose folders you know, and check with the tester that it does not claim the
version files. When in doubt, leave the rule out and assign the files by hand.

**What to check, in short.**

1. Take a program of your machine that you know runs. Paste a part into the tester (*Try
   these settings on a program*) and see that the sections, the waits and their partners
   are what you know them to be.
2. Run [Check Wait Codes](#check-wait-codes) on a program that runs correctly. It must say
   that everything matches. If it reports findings on a correct program, then the preset
   (or one of its kinds of wait) is wrong for your machine. That tells you what to change.
3. Run it on a program that you know is wrong, and see that it finds the mistake.

---

## Seeing the channels

### The status bar

On a program with channels, the status bar has a **Channel** item. It says:

| You see | It means |
|---|---|
| **Channel: Turret A** | The cursor is in a section of Turret A |
| **Outside the channels** | The cursor is in lines that belong to no channel |
| **Path 1 (1 of 2), Path 2 not open** | One file for each channel; this is path 1; the other file exists but is not open |
| **Path 2 not found** | gEdit looked in the folder and the other file is not there |
| **Path 2 could not be checked** | gEdit could not look in the folder: the folder did not answer in time (a network share, say), or the computer did not allow it. It does not mean the file is missing |
| **Channel: not set** | A program of a machine with one file per channel that no rule recognises. Click it to assign it |
| **Channel rules are broken** | The channel settings of the machine have a mistake; see [Machines](machines.md#channels) |
| **Channels: too slow to read** | gEdit could not read the program for channels in time (half a second), usually because the computer was busy. It tries once more a second later, and again after your next edit. Until then the program shows no channels, and Check Wait Codes says *not checked* |

Hover it for what was used to find the channel: the sections of the program, the file name,
the marker or your assignment. **Click** it for a list: each channel (choosing one takes you
to its lines or its tab), **Open the other channels…**, **Assign this document to** a
channel, and **Remove the assignment**.

### The hover on a wait code

When a machine lists a code as a wait, hovering it says so: for a machine with `M190-M199`
as waits, the hover on `M198` reads *Wait code on this machine (Lathe 3)*, followed by the
name of the rule it belongs to. The machine's list wins over the code database. A code
such as `M198`, which the database may describe as something else on another control
(a call of a program on an external device), is shown as a wait **on a machine that says it
is one**, and with its database text on every other machine. The *Required: P* line of the
database is left out there, because on your machine the rule says how a wait without `P`
is read. Only plain code lists answer this way; a wait found by a start-and-digits rule or
a pattern is not explained in the hover.

For the same reason, the program checks *Missing word* and *Alone in its block* do not
report a wait-code line.

### The program map

The map groups the program by channel. Each channel has its tools and its wait codes under
it, all of its sections together in program order. Codes that do not wait (a Sinumerik
`SETM` or `CLEARM`) are not listed there; `Alt+F7` reaches them. A channel with more than 250
wait codes shows them as one entry with their number, on its first wait (*10000 wait codes (Alt+F7 steps through them)*);
`Alt+F7` and `Shift+Alt+F7` step through them one by one. Thousands of entries would make the
map too slow to keep up with your typing. The lines that belong to no channel are
under **Outside the channels**. Click an entry to jump to it. A program without channels
shows the map as before.

### Keys

| Keys | |
|---|---|
| `Alt+F7` | **Next Sync Point**: the next wait of the channel the cursor is in. At the last one it starts over from the first and says so. In lines that belong to no channel it steps over the waits of all channels |
| `Shift+Alt+F7` | **Previous Sync Point** |
| `Cmd/Ctrl+Alt+P` | **Go to the Matching Mark**: with the cursor on a wait, jump to the wait in the other channel that answers it. A wait is answered by the same code with the same `P`: an `M901 P12` meets the `M901 P12` of the other channel, never an `M901 P123`. The first of them in one channel meets the first in the other, the second the second ([the rule](#how-the-waits-line-up) is the one the channel view uses). With one file for each channel it switches to the other tab. If that channel is not open it says so and moves nothing |

On macOS, `Cmd+Alt+P` is the editor's own key for *Preserve Case* in the find box. gEdit
takes it over there. The button in the find box still works. On Windows and Linux the
editor's key is `Alt+P`, which gEdit leaves alone.

All the commands are also on the ribbon (**NC** tab, group **Channels**) and in the palette
(`F1`, start typing "Channels"). The palette also has **Channel…** (same as clicking the
status item), **Assign to Channel…** and **Test Channel Rules on Document**, which writes
what the settings find in the open program into the Results panel.

---

## Check Wait Codes

**Tools ▸ Channels ▸ Check Wait Codes** compares the waits of the channels with each other
and lists the places that do not fit. It reads what is written. Run it with the program in
front of you; with one file for each channel, **open all the channels first**. A channel
that is not open is not checked, and the report says so.

The report is in the Results panel, titled *Wait codes, Lathe 2: 3 to look at* or *Wait
codes, Lathe 2: all match*. Click a row to jump to that line, in the right file. Under the
list are two lines: *Checked: …* and *Not checked (not open or not found): …*.

If a sibling file has another machine than the one in front of you, the report says so:
*Path 2 is set to machine “Lathe 3”. It was checked with the rules of “Lathe 2”.* and offers
**Use “Lathe 2” for Path 2** (then it checks again) or **Leave as it is**. A check always
uses the rules of the program you started it from.

If the check takes too long, it stops and the report says *The check took too long and was
stopped; the findings below are incomplete.* If the program itself could not be read in time,
nothing is checked and the report is titled *Wait codes, Lathe 2: not checked*, with the reason;
run it again in a moment.

### What it finds, and what to do about each

Say path 1 and path 2, with `M901 P3`-style waits.

| Finding | In words | What to do |
|---|---|---|
| **Missing** — *M903 in Path 1 waits for Path 2, but Path 2 has no M903 that waits for Path 1.* | A wait has no answer | Look for the wait in the other channel. It may be missing, or it may be written with another number or a `P` word that does not name this channel |
| **Count differs** — *M904: Path 1 waits on it 3 times for Path 2, Path 2 has 2; both need the same number.* | Both have the number, but not as often. The row points at the first wait the other channel has no answer for | Find the extra wait, or the missing one. Check the line it points at and the one in the other channel |
| **Count differs (rule)** — *Wait codes 1: Path 1 has 3, Path 2 has 2; both sides need the same number.* | For waits without a number: different totals | As above |
| **Count differs (stops and ends)** — *Stops and ends: Path 1 has 2, Path 2 has 1; both sides need the same number.* | One channel has a stop or end more | Is the extra `M01` or `M30` meant? |
| **Count not checked** — *M904: Path 1 has it 3 times for Path 2, Path 2 has 2, but it is inside a loop or a jump, so the count is not checked.* | The counts differ, but a wait of that number sits between a jump target and a backward jump (a loop) in its channel. How often it runs is not written anywhere | **Nothing is wrong that gEdit can see.** Count the passes of the loop by hand |
| **Different channels** — *M901 in Path 1 waits for Path 1, Path 2, Path 3, but the M901 in Path 2 it meets (line 12) waits for Path 1, Path 2; both must name the same channels.* | A wait rule with a `P` word (the Fanuc presets, or a rule of your own): the two waits that meet name different paths, or one has a `P` word and the other has none. The control stops with an alarm | Write the same `P` word in every path of that wait |
| **Other order** — *M902 (line 40) and M903 (line 52) are in the other order in Path 2 (lines 61 and 58). 2 more out of order.* | Both channels have the waits, but not in the same order. With the control, each would wait for the other | Swap them in one channel. The finding reports the first pair; the *more* (only there when there are more) says how many further pairs are the other way round |
| **Order not checked** — *The order of M902 and M903 against Path 2 is not checked: a jump target or a backward jump lies between them.* | The order is not as written, but a jump target or a backward jump (`GOTO` back, `M99 P`, the end of a loop) lies between the two waits, so gEdit cannot say what runs first | **Nothing is wrong that gEdit can see.** Check the order by hand. With *Count not checked* these are the cases where the check refuses to judge |
| **Not increasing** — *P20 comes after P30 (line 12) in Turret A; the numbers must increase.* | For order numbers: a number below the one before it | Correct the number, or the order |
| **Names no other channel** — *M905 in Path 1 names no other channel, so nothing can answer it.* | The wait's `P` word (or the line) names only its own channel, or none | Look at the `P` word. It should name the other channel. With a wait without `P`, see [which channels a wait names](#which-channels-a-wait-names) |
| **Unknown channel** — *M906 in Path 1 names “4”, which is not a channel of this machine.* | The wait names a channel the machine does not have. If it names several, one finding lists them all | A typing mistake in the `P` word, or a channel missing in the setting |
| **Outside every channel** — *M901 on line 3 is outside every channel section.* | A wait in lines that belong to no channel | A wait before the first section or after a section end. Is it in the right place? |

### What the check cannot tell you

- **It reads written numbers and written order, not what the machine does.** It does not
  know what a wait does at the control, how long it takes, or whether the control accepts
  that order of waits.
- **A clean result is not a proof.** It means that every wait has an answer with the same
  number and in the same order (and, with the Fanuc presets, written for the same paths).
  The paths can still wait in a way that blocks each other for reasons the text does not
  show.
- It does not follow a call into another file, and it cannot judge the order across a
  jump target or a backward jump. It says so for each pair.
- It cannot count the passes of a loop. A wait inside a loop (between a jump target and a
  backward jump in its channel) is compared by its number only: if the counts differ it
  says *Count not checked*, and a wait that a loop runs a different number of times in
  each channel than written is not seen.
- It does not compare a channel whose file is not open.
- A number is **allowed to repeat**. A post that writes the same `M902` ten times in both
  channels is normal and is not reported as long as both have it ten times.
- Codes that are not set to wait (a Sinumerik `SETM` or `CLEARM`) are never checked
  themselves. A `SETM` answers a `WAITM` of its mark in another channel, so that wait is not
  reported as missing; how often and in which order a `SETM` answers is not judged, because
  the mark stays set until it is cleared.

---

## The channel view

**Channels Side by Side** (NC tab, group **Channels**; palette: *Channels: Channels Side by Side*) opens
the **channel view**: the channels of a program in **channel panes** next to each other, **one pane for each
channel**, up to four. The panes are lined up at the wait codes: a wait and the wait that answers it
stand at the same height, and the shorter channel gets empty space until the longer one catches up.
It has no key. It is offered when the program's machine has channel settings, and not while a comparison
is open.

The channel view is not the [split view](README.md#two-panes-split-editor). The split view shows
documents in editor groups with no lining up; the channel view shows the channels of one program,
lined up. The two exclude each other.

It works for both layouts:

- **All channels in one file.** Each channel pane shows the sections of one channel. The panes are
  made from the program itself, so what you type in a pane is typed in the program.
- **One file for each channel.** Each channel pane shows one of the open channel files. gEdit first
  looks for the other files of the program. If some exist and are not open, the status bar says
  *Choose the other channel files to open beside this one.* and the file dialog opens in the
  folder of the document. Pick the files (several at once). gEdit opens **nothing by itself**. If
  you pick nothing, it says *No files were opened. Showing the channels that are open.* and goes on
  with the files that are open.

Run the command again while the view is open to open it afresh. A channel file you opened since
joins the view then. When it opens, the status bar says *The channel view shows 3 channels.*

The view does not open, and says why, when:

| You see | What it means |
|---|---|
| This program has no channels, so there is nothing to show in the channel view. | The machine has channels, the program has no sections |
| Only one channel of this program was found. The view needs at least two. | One section name is all there is |
| Open at least two channel files to open the channel view. | One file for each channel, and fewer than two are open |
| This program took too long to read for channels, so channels are off for it. | See *Channels: too slow to read* in [the status bar](#the-status-bar) |

### The bar and the channel panes

Above the panes is a bar. It says which layout the view reads (*Channel sections of one program*
or *One file per channel*) and counts the waits:

- **N of M waits lined up.** And, when there are some, **N waits have no partner**.
- **Not shown: Turret C, Turret D.** The view shows the first **four** channels in the order the
  machine declares them. The bar names the rest.
- **N lines are in no channel and are not shown.** The lines outside channels, between the
  sections, are in no pane.

The button at the right end of the bar closes the view.

Every pane has a header with the name of its channel (with one file for each channel, also the
file's name). The lines of a pane are the lines of its channel, but the **line numbers are those
of the program**, so a number in a pane is the line you would reach in the whole program. The
header of the program (the lines above the first section start) is in every pane. A pane has no code
folding, and its outline is empty. The minimap follows the setting *Show minimap*, one for each pane. Every
pane has its own overview ruler.

**Word wrap is off** in every pane of the channel view, with one file for each channel as well as
with sections, whatever the setting says. A wrapped line is taller than one line and would put
the lining up at the waits out of step. The setting you chose comes back when the view closes.

If a channel is no longer in the program (you deleted its last section, say), its pane stays,
empty and read-only, titled *Turret B (no longer in the program)*. **Undo** brings the section
back, and the pane with it. If no section is left at all, the view closes with a message; so it
does if the program takes too long to read, or if the channels of the machine change.

### How the waits line up

A wait carries a `P` word. It lists the channels that take part, as digits (when the
machine reads the `P` word as digits; see [Which channels a wait names](#which-channels-a-wait-names)).
A wait meets the same code with the same `P` in the channels the `P` names, and
**the first of them meets the first, the second the second**. Two synthetic examples:

```
Channel 1:  M901P12      Channel 2:  M901P12      Channel 3:  (nothing)
Channel 1:  M910P123     Channel 2:  M910P123     Channel 3:  M910P123
```

- `M901P12` meets in channels 1 and 2 **only**. Channel 3 is not named, takes no part and does
  not stop. It gets no line-up point for it.
- `M910P123` meets in all three channels. The pane that gets there first waits for the other two.

A different `P` is a different wait: `M901P12` does not meet `M901P123`. This is gEdit's rule,
and it holds for **every wait written with a `P` word**, also for a wait rule you built yourself on
the machine page. A wait with no `P` word meets only a wait with no `P` word (every rule with a `P` word): `M901`
against `M901 P3` is unmatched, as Check Wait Codes reports it. If a channel the `P`
names **and that is shown** has no matching wait, the wait is **unmatched** in all the channels
that have it. A channel the `P` names that is **not shown** (more than four channels) is
not judged.

**A Sinumerik `WAITM` lists its channels** (`WAITM(1,1,2,3)`), and the lists need not be the
same in every channel. Those waits are paired **channel by channel**, as Check Wait Codes does: the
n-th wait of channel 1 that names channel 2 meets the n-th wait of channel 2 that names channel 1. A
`SETM` of the same mark number in a named channel **answers** the wait, so the wait needs no
matching `WAITM` there and is not red.

A few waits are **not judged**, and get no red mark:

- **A wait inside a loop or a jump** (between a jump target and a backward jump) whose number differs
  between the channels, when each channel has that wait at least once (a channel without it is
  still unmatched, *missing*, even inside a loop). How often a loop runs is not written anywhere. This is the same as
  *Count not checked* in Check Wait Codes; the view only shows where you are working.
- A wait **whose other channels are not shown**.

A wait that names a channel the machine **does not declare** (`M901 P14` on a machine with three
channels) is unmatched: the control would wait for ever.

When the channels have the same waits in a different order, the view keeps the longest run of waits
that are in the same order in both and marks the others unmatched (with three or four channels it
drops the wait that crosses the most others first). Two waits on one line whose partners are on
different lines cannot both be lined up: the second is unmatched.

The marks stand in the margin of the pane, and in its overview ruler. **Hover a mark** and it says
why:

| Mark | Hover |
|---|---|
| matched | *Waits with Turret B, line 120; Turret C, line 98* |
| unmatched | *Turret C has no matching wait for "M910P123"* |
| unmatched | *This wait names no other channel, so nothing can meet it.* |
| unmatched | *This wait names channel 4, which this machine does not have. The control would wait here for ever.* |
| unmatched | *This wait comes in another order here than in the other channels, so it is not lined up.* |
| unmatched | *Another wait on this line is already lined up with a different line, so this one is unmatched.* |
| not judged | *This wait is inside a loop or a jump, so how often it runs is not checked here.* |
| not judged | *A SETM in Turret B answers this wait, so it needs no matching wait there.* |

A wait that needs no partner in view gets no mark: a code that does not block, a numbered wait
that is in one channel only, a wait whose other channels are not shown. This is what *Check Wait
Codes* also checks. It is not a simulation.

### Scrolling, editing, undo

- **The panes always scroll together.** Whichever pane the mouse is over takes the wheel and the
  others follow. There is no leading pane to choose. The lining up at the waits decides how
  they follow.
- **You can edit in every pane, in its own channel's lines.** An edit goes to the program (or to the
  channel's file), and the other panes are lined up again. A whole new line (text ending in Enter)
  typed or pasted at the start of a **section start** line (`G13`, `$1`), other than the first
  section's, goes to the end of the section above it, so it stays in your channel. The same at
  the first section start, or characters typed in front of a section start, are refused (below).
- **A pane edit that would move lines to another channel is refused.** Typing characters in front of a section
  start, taking one out, typing a new one, or, on a machine whose sections have an end line,
  typing that end line in the middle of a section or adding a line after it, would hand lines to
  a different channel. (Without an end line a section runs to the next start, so typing `M30` or
  Enter after its last line moves nothing and is allowed.)
  gEdit does not apply the edit, puts the pane back as it was and says: *A pane only edits its own
  channel's lines. To end a section early or add lines after its end, edit the program itself.* The
  refused edit is no step of the view's undo. Deleting a whole section's lines in its pane, or lines
  inside a section, is fine.
- **There is one undo history for the view**, not one for each channel. With all channels in
  one file it is the program's own history. With one file for each channel it holds only the edits
  made **while the view is open**: the history starts when the view opens, and what you typed
  before is not on it. After the view closes, each file has its own history again.
  A file that is **reloaded from disk** is one step of the view's history: Undo takes the reload
  back. Only a file whose document was replaced by another one drops its steps. An undo
  of a step for a file that was changed outside the view says *That file was changed outside the
  view. Close the channel view to undo in that file.*
- **Save stays per file.** With one file for each channel, each channel file is saved on its
  own, as before. With all channels in one file there is one file, the program.
- **The active pane** is the one with the keyboard. It has a coloured border in the accent
  colour of the theme, and the status bar, the inspector and the program map show **that**
  channel's line. `F6` and `Shift+F6` move to the next and the previous pane.
- **A selection across channels is refused.** A line command, a clean-up or a script that works on
  the selection stops with *The selection runs over the lines of another channel. Select within one
  section.* if a selection in a pane covers lines of another channel. The same goes for
  *New Template from Selection*.

### Closing it

**Close Split** (View tab, group **Editor**), the button in the bar and the **X** in a pane header
close the view. Closing a pane of three leaves two, and the remaining panes keep scrolling together
and showing only their own channel's marks. When one is left, the view ends. The
program stays as it is.

While the view is open, **Split Editor** and **Split Editor Down** are off, and the channel view
cannot be opened while a comparison is open.

---

## Split into Channel Documents

On a program with all channels in one file, **Split into Channel Documents** (NC tab, group
**Channels**) makes **one new document for each channel**: the lines above the first
section (the header, `%`, the `O` number), then all of the channel's sections in order.
Lines that belong to no channel, between the sections, are not copied.

Use it to read one turret's program from start to end, to print it, or to work on one
channel alone. It writes no file. gEdit asks once per session to make sure you know. The new
documents are untitled, with names such as `SHAFT — Turret A`. gEdit remembers which
documents it made from which program until you quit.

### Merge Channels Back

**Merge Channels Back** (NC tab, group **Channels**; offered on the program that was split
and on each of its channel documents) writes the changes you made in the channel documents
back into the program, each into the lines of its own channel. It asks nothing first and is
**one undo step** of the program: **Undo** takes all of it back.

- A line you changed stays where it was. A line you added goes right after the line above it
  in the same channel, so a line added at the end of a section stays in that section. A
  line you deleted is deleted in the program.
- A channel document you closed is skipped, and so is one you did not change.
- Lines the program has outside every channel are never touched.
- A shared section (`+S1/S3`) is the same lines in each channel that shares it. If two
  documents changed the same shared line in two ways, nothing is merged.

gEdit **refuses the whole merge** and changes nothing, saying why, when:

- **The program changed in the lines of a channel you are merging** since the split (or the
  last merge). Merge before you edit that channel in the program, or split again. Changes in
  the lines of another channel, or between the channels, do not matter.
- **The lines at the top of a channel document changed** (the header, before the first
  section). They belong to every channel. Change them in the program. Lines added between
  the header and the first section count as the header.
- **Two channel documents changed the same shared line differently**, or only one of them
  changed a line the channels share: a shared line is the same line in every channel, so the
  change has to be made in the program (the message says *shared lines*).
- **The merge would move lines into another channel.** A section start or a wait that opens a
  section was typed into, or taken out of, a channel document, so the program would read
  differently afterwards. Take it out of the document, or make the change in the program.

After a merge the channel documents and the program are in step again, so you can go on
editing and merge again. If you undo a merge in the program, merge again brings the same
changes back from the documents.

It is not offered for a machine with one file for each channel; they are separate documents
already.

---

## In a script

A script gets the channels of the document it runs on. A script that scales feeds has no
use for it and does not change. A script that wants one channel's lines can ask for
them. See [Scripts](scripts.md#channels-in-a-script). The bundled
[Tool list](scripts.md#tool-list) groups its rows by channel.

---

## Known limits

- **A wait code written as an argument of a call is read as a wait.** `G65 P9010 M901`
  passes `M901` to a macro. It is no wait for the control, but gEdit reads `M901` as a wait
  if it is in your list. If that gives findings on a correct program, the macro calls are
  the reason. Take the code out of the list or use a pattern that does not match the call.
- **A channel is compared with the channels that are open.** gEdit does not open files for
  you.
- **One mark per `SETM` or `CLEARM`.** `SETM(5,6)` is read as mark 5 only, so a `WAITM(6,…)`
  that only it answers is reported as missing. Write one mark per `SETM` if you want the check
  to see it.
- **A line longer than 1,000 characters is not read for channels and wait codes.** NC
  blocks are far shorter; such a line is usually a data block. gEdit says how many lines it
  skipped (*… lines longer than 1000 characters were not read …*), never silently.
- **A broken pattern costs the channels, not the machine.** If a pattern in the channel
  settings is not valid, the machine keeps all its other settings. Only the channels are
  off, and the page says what is wrong.
- **The channel view shows four channels at most**, the first four in the order the machine
  declares them, and the bar names the rest. The speed of the view is proven for two panes on
  programs of 300,000 lines, not for three or four.
- **A program with sections of one channel in several places** shows them in one pane, in
  program order. Lines in no channel are not shown.
- **The presets are documented defaults, not facts about your machine.**
