# gEdit

An editor for CNC programs as a CAM system writes them: reading, checking, comparing and changing NC code for one machine and control at a time.

## Programs

**Block**:
One line of an NC program (`N30 G1 X10.`).
_Avoid_: block for a group of lines (see Change)

**Change**:
In compare, a group of lines in which the two programs differ.
_Avoid_: changed block, hunk, diff block

## Cycles and time

**Drilling cycle**:
A cycle that drills, pecks, dwells or bores at each position it is given.
_Avoid_: canned cycle, fixed cycle

**Expand**:
To replace a cycle with the rapid and feed blocks it makes.
_Avoid_: explode, unroll, resolve

**Motion data**:
A machine's rapid rates, rapid kind, top feed and tool-change time, as its documentation gives them.
_Avoid_: kinematics, machine parameters

**Limits**:
A machine's top spindle speed and its travel per axis.

**Estimated time**:
A lower bound of a program's running time, from its lengths and the machine's motion data; never a measured cycle time.
_Avoid_: cycle time, run time

**Not estimated**:
A part of a program the estimated time leaves out, named with its lines.

## Channels

**Channel**:
One of a machine's parallel program streams, each running its own part of the program at the same time.
_Avoid_: path, turret, system (use the machine's own word only when quoting a dialect: "Fanuc path 2 is channel 2")

**Section**:
The lines of one channel inside a single program, from one section start to the next.
_Avoid_: run, range, block

**Section start**:
The line that opens a section and names its channel (`G13`, `$1`).
_Avoid_: channel switch, junction

**Header**:
The lines of a program with sections that come before the first section start.

**Lines outside channels**:
Lines that belong to no channel.
_Avoid_: header (the header is only the part before the first section start)

**Shared line**:
A line that belongs to more than one channel.

## Waits

**Wait**:
A code that makes channels meet: each named channel stops there until the others arrive (`M901P12`, `WAITM(1,1,2)`).
_Avoid_: sync mark, sync code ("wait code" is fine in running text)

**Mark**:
A wait, or the code that answers one (`SETM`), as a point the channels are lined up at.
_Avoid_: sync mark

**Partners**:
The channels a wait names, by its `P` digits or its list; a channel that is not named does not stop.

**Matched**:
Said of a wait whose partners' marks are lined up with it; otherwise it is **unmatched**.
_Avoid_: paired, synced

## Views

**Editor group**:
One editor area of the window, showing one document; the window holds up to four.
_Avoid_: pane (for a group outside the channel view), split

**Split view**:
Editor groups arranged side by side, showing any documents or the same document twice, with no lining up.

**Channel view**:
The view that shows one channel per pane, scrolling together and lined up at the waits; opened with Channels Side by Side.
_Avoid_: side-by-side view, channel split

**Channel pane**:
An editor group inside the channel view, showing the lines of one channel.

**Aligned view**:
The compare view that faces the two programs line by line, with fillers where one side has no line.
_Avoid_: side by side (that is the compare layout opposite to inline)
