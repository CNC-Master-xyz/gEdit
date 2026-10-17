# Review: the built-in templates

49 templates, in six sets. Each one ships marked "review pending" and says so in the Insert tab, in completion and in the form. This page is your list for reading them.

How to work through it:

1. Open a program of the dialect, go to the Insert tab (or type the start of the label on an empty line and press `Tab`) and insert the template.
2. Read the text it wrote against what your control accepts. Every number in a template is a sample, so check the order of words and the codes, not the values.
3. When it is right, tick the box here. When it is wrong, write what is wrong next to the row (or tell the next session); do not tick it.
4. The sign-off in the program is removing the `"review": "pending"` line of the template in its code file. You do not have to do that by hand: when a set is fully ticked, a later batch removes the marks of those entries.

The plan names the decisions to confirm in [P3b known gap 2](../phase-3-implementation.md#p3b-write-with-templates). Where a row says "the plan names it", that decision is what to look at first.

| Set | Templates |
|---|---|
| Fanuc mill | 10 |
| Fanuc lathe (system A) | 8 |
| Fanuc lathe, system B | 2 |
| Heidenhain Klartext | 10 |
| Okuma | 8 |
| Sinumerik (turning and milling) | 11 |
| **Total** | **49** |

## Fanuc mill

Set `fanuc.json`, 10 templates.

| Done | Template | What it inserts | Source named in the plan | What to check |
|---|---|---|---|---|
| [ ] | `program-start`: Program start | Tape mark, program number and a safe-start line: | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The safe-start line and the header against what your control accepts; the sample values are samples. |
| [ ] | `tool-change`: Tool change | Changes to the tool with M6, starts the spindle at the start position and comes down to the approach height with the tool length offset (G43 H). | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The tool-call order, offsets and spindle start against your control; every speed and position is a sample. |
| [ ] | `drill`: Drilling (G81) | Feeds to the hole bottom and pulls out at rapid. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `drill-dwell`: Drilling with dwell (G82) | Like G81, with a dwell at the hole bottom for a clean flat bottom or a counterbore. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `peck-drill`: Peck drilling (G83) | Drills in pecks and pulls out to the R level after each one, so the chips leave the hole. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `chip-break-drill`: Chip-breaking drilling (G73) | Drills in pecks and backs off a short way between them to break the chip. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `tapping`: Rigid tapping (G84) | Switches rigid tapping on with M29 and the speed, then taps. | the plan names it: `M29` is a machine setting and the feed is the formula pitch x speed under `G94` | Whether `M29` is the rigid tapping code on your machine, and whether pitch x speed under `G94` is the feed it wants. |
| [ ] | `boring`: Boring (G85) | Feeds to the hole bottom and feeds back out, which leaves a cleaner wall than a rapid retract. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `tool-end`: Tool end | Coolant and spindle off, Z to the reference point (G91 G28 Z0.), back to absolute positions, and an optional stop before the next tool. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The retract and the cancel codes against your control; sample positions. |
| [ ] | `program-end`: Program end | Coolant and spindle off, Z and then X and Y to the reference point, end of program and the closing tape mark. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The closing codes (spindle, coolant, `M30`/`M2`/`M02`, the closing mark) in the order your post writes them. |

## Fanuc lathe (system A)

Set `fanuc-lathe.json`, 8 templates.

| Done | Template | What it inserts | Source named in the plan | What to check |
|---|---|---|---|---|
| [ ] | `program-start`: Program start | Tape mark, program number, a safe-start line (units, no nose radius compensation, feed per revolution with G99) and both axes to the reference point. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The safe-start line and the header against what your control accepts; the sample values are samples. |
| [ ] | `tool-start`: Tool start | The speed limit (G50 S), the turret station with its offset and a comment, constant cutting speed with the spindle direction, the approach and... | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The tool-call order, offsets and spindle start against your control; every speed and position is a sample. |
| [ ] | `rough-finish`: Roughing and finishing (G71, G70) | Moves to the cycle start point, roughs along Z in two blocks, the contour between the two numbered blocks, and the finishing pass over the same... | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `threading`: Threading (G76) | Multi-pass threading in two blocks: | the plan names it: the `G76` finish allowance `R` is written with a point | The two `G76` blocks, the packing of `P`, and `R` written with a point; whether your control reads it so. |
| [ ] | `grooving`: Grooving (G75) | Plunges into the diameter in pecks and steps along Z for a wide groove. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `face-drill`: Drilling on the face (G83) | Drills on centre along Z in pecks of Q and cancels the cycle with G80. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `tool-end`: Tool end | Back to the tool change position at rapid with the offset cancelled (station and 00), coolant off and an optional stop. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The retract and the cancel codes against your control; sample positions. |
| [ ] | `program-end`: Program end | Spindle off, end of program and the closing tape mark. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The closing codes (spindle, coolant, `M30`/`M2`/`M02`, the closing mark) in the order your post writes them. |

## Fanuc lathe, system B

Set `fanuc-lathe-b.json`, 2 templates.

| Done | Template | What it inserts | Source named in the plan | What to check |
|---|---|---|---|---|
| [ ] | `program-start`: Program start | G-code system B: | the plan names it: the system B program start avoids `U`/`W` | That the safe-start line is accepted (units, `G40`, `G95`, `G91 G28 X0. Z0.`, `G90`) and that the machine takes no `U`/`W` there. |
| [ ] | `tool-start`: Tool start | G-code system B: | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The tool-call order, offsets and spindle start against your control; every speed and position is a sample. |

## Heidenhain Klartext

Set `heidenhain.json`, 10 templates.

| Done | Template | What it inserts | Source named in the plan | What to check |
|---|---|---|---|---|
| [ ] | `program-start`: Program start | BEGIN PGM with the name and the unit, and the stock as a box (BLK FORM) for the control's graphics. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The safe-start line and the header against what your control accepts; the sample values are samples. |
| [ ] | `tool-call`: Tool call | Calls the tool along Z with its speed, then moves up to a safe height at rapid without radius compensation and starts the spindle. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The tool-call order, offsets and spindle start against your control; every speed and position is a sample. |
| [ ] | `drill`: Drilling (cycle 200) | Defines drilling cycle 200 and calls it at the first hole with M99. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `universal-drill`: Universal drilling (cycle 203) | Defines cycle 203: | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `rigid-tap`: Rigid tapping (cycle 207) | Defines rigid tapping cycle 207 and calls it at the first hole with M99. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `centering`: Centering (cycle 240) | Defines centering cycle 240, to a diameter or to a depth, and calls it at the first hole with M99. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `line`: Straight move (L) | A straight move to the coordinates you fill in; an empty one is left out. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `circle`: Circle around a centre (CC, C) | Sets the circle centre (CC) and moves on the arc to the end point (C); the radius is the distance from the centre to the start point. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `stop`: Program stop | Stops the program; the operator continues with NC start. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `program-end`: Program end | Moves up at rapid with coolant off, ends the program with M30 and closes it with END PGM, whose name and unit have to match BEGIN PGM. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The closing codes (spindle, coolant, `M30`/`M2`/`M02`, the closing mark) in the order your post writes them. |

## Okuma

Set `okuma.json`, 8 templates.

| Done | Template | What it inserts | Source named in the plan | What to check |
|---|---|---|---|---|
| [ ] | `program-start`: Program start | The optional tape header, the program name, a description and the spindle speed limit (G50 S). | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The safe-start line and the header against what your control accepts; the sample values are samples. |
| [ ] | `tool-start`: Tool start | Moves to the index position, indexes the turret (nose radius offset, tool, offset), starts constant cutting speed and approaches with coolant. | the plan names it: the Okuma tool word is the six-digit form | The six-digit tool word and the order: index position, nose radius offset, tool, offset; the constant cutting speed lines. |
| [ ] | `face-drill`: Face drilling (G74) | Drills along Z in pecks of D with G74 (X0 is a centre hole) and returns to the start position. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `threading`: Threading (G71) | The whole thread from one block: | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `lap-rough-finish`: LAP roughing and finishing (G85, G87) | The finished contour between G81 and G80 (fill in the blocks between the two contour points), the roughing call G85 and the finishing call G87. | the plan names it: the contour is written before the call, and LAP is an option of the control | The contour between `G81` and `G80`, then the `G85`/`G87` calls; whether your machine has LAP at all. |
| [ ] | `live-drill`: Driven-tool drilling (G181) | C-axis on (M110), driven tool on (SB= with M13), feed per minute, the drilling cycle at the first hole (add more C positions after it), cancel with... | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `tool-end`: Tool end | Back to the index position with coolant off and an optional stop. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The retract and the cancel codes against your control; sample positions. |
| [ ] | `program-end`: Program end | Spindle off, end of program and, if wanted, the % that ends a program on tape. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The closing codes (spindle, coolant, `M30`/`M2`/`M02`, the closing mark) in the order your post writes them. |

## Sinumerik (turning and milling)

Set `sinumerik.json`, 11 templates.

| Done | Template | What it inserts | Source named in the plan | What to check |
|---|---|---|---|---|
| [ ] | `program-start`: Program start | A description, the safe-start line for turning or milling, the units and the work offset. | the plan names it: the Sinumerik program start is shared by turning and milling | Both safe-start lines (turning and milling) and the work offset against what your control accepts. |
| [ ] | `tool-start`: Tool start | Selects the tool by name with its cutting edge, starts constant cutting speed with the speed limit LIMS= and approaches with coolant. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The tool-call order, offsets and spindle start against your control; every speed and position is a sample. |
| [ ] | `stock-removal`: Stock removal (CYCLE95) | Roughs and finishes along a contour that a subprogram or a labelled section describes, with the three feeds as arguments. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `threading`: Thread turning (CYCLE99) | Cuts a straight thread in several passes. | the plan names it: the 29 arguments of `CYCLE99` and the fixed literals (`_NSP 0`, `_NUMTH 1`, `_MID 0`, `_GDEP 0`, `_PIT1 0`, `_FDEP 0`, `_GST 1`, `_GUD 0`, `_IFLANK 0`, `_DMODE 0`, `_AMODE 0`) | Insert it on a cycle screen of your control and compare every argument and the fixed literals with the screen; the order of the 29 arguments. |
| [ ] | `tool-end`: Tool end | Back to the tool change position with coolant off and an optional stop. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The retract and the cancel codes against your control; sample positions. |
| [ ] | `tool-change`: Tool change | Loads the tool with M6, activates its cutting edge D, starts the spindle and approaches the start position. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The tool-call order, offsets and spindle start against your control; every speed and position is a sample. |
| [ ] | `drill`: Drilling (CYCLE81) | Sets the drilling feed, makes CYCLE81 modal with MCALL, drills the first hole and ends the modal call. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `drill-dwell`: Drilling with dwell (CYCLE82) | Like CYCLE81 with a dwell at the bottom, for a counterbore or a flat bottom. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `peck-drill`: Deep-hole drilling (CYCLE83) | Pecks to the final depth, breaking the chip or pulling out after each peck. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `tapping`: Rigid tapping (CYCLE84) | Taps with the spindle under position control; the pitch and the speeds are arguments of the cycle, not the feed in force. | none named for this one; the plan asks for the whole set to be read (P3b known gap 2) | The cycle's parameter order, defaults and required words on your control; every sample value is a sample. |
| [ ] | `program-end`: Program end | Coolant and spindle off and the end of the program. | the plan names it: the Sinumerik program end is shared by turning and milling | The closing lines for both turning and milling. |

