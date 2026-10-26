# Review: machine facts

Facts only your machines can say. Nothing here is needed now: every default of [P2 section 8.8](../phase-2-implementation.md#88-machine-parameters-per-profile-the-defaults-none-assumes) stays marked as assumed, and a machine you set up overrides it. Each row names where in gEdit the answer goes.

How to work through it:

1. Open **Settings > Machines**, add or edit the machine of the control (see [Machines](../../user/machines.md#defining-a-machine)).
2. Find the fact on the control (its parameter list or manual), set it in the field named in the row, and tick the box.
3. Where a row says "no field", the fact is not a gEdit setting yet: write the answer next to the row (or tell the next session), then tick.
4. Check one real program with the machine chosen and with "none" (F7, the tool list) after the first machine of each control.

Control families: 12 Fanuc lathe facts, 8 Okuma, 7 Sinumerik, 4 Heidenhain, 31 rows in all; P4b adds 5 Fanuc mill facts, 3 Heidenhain facts and 8 facts of the Motion and limits page (all machines), 47 rows in all; the manual check adds 10 more at the end (57 rows).

## Fanuc lathes (12)

The fields are on the machine form of a Fanuc lathe; see [The Fanuc lathe](../../user/machines.md#the-fanuc-lathe) and [syntax-fanuc section 4.1](../syntax/syntax-fanuc.md#41-profiles-the-same-code-means-different-things).

| Done | Fact | Where in gEdit |
|---|---|---|
| [ ] | G-code system, A or B, per machine | Machine form: **G-code system** |
| [ ] | How the control reads numbers: calculator or increments, and the increment system | Machine form: **How the control reads numbers** |
| [ ] | The two feed parameters that read a number without a point | Machine form: **How the control reads numbers** (the preset's feed rows); if your control matches no preset, no field |
| [ ] | Power-on feed mode (per minute or per revolution) | Machine form: **Feed mode at power-on** |
| [ ] | Power-on constant surface speed or direct rpm | Machine form: **Spindle-speed mode at power-on** |
| [ ] | Power-on plane | Machine form: **Plane at power-on** |
| [ ] | In system B, whether `U` and `W` are incremental (default yes, verify) | Machine form: **U, W, V and H move incrementally** |
| [ ] | On a Y-axis lathe, whether `V` and `H` are incremental | Machine form: **U, W, V and H move incrementally** (choice "U, W, V and H") |
| [ ] | How many offset digits the `T` word carries (without a machine: four digits read 2 + 2, five digits 2 + 3) | Machine form: **Tool word: offset digits** |
| [ ] | Which M number starts rigid tapping | No field; write the answer here |
| [ ] | Whether your posts ever write `E` (inch thread lead) | No field; write the answer here |
| [ ] | What the control does with lower-case comments (its code table has none) | No field; write the answer here |

## Fanuc mills (5), added in P4b

Not settings of the machine form: write the answer next to the row. They decide what [Expand Drilling Cycles](../../user/scripts.md#expand-drilling-cycles), [Statistics and Time](../../user/scripts.md#statistics-and-time) and the channel checks may assume.

| Done | Fact | Where in gEdit |
|---|---|---|
| [ ] | After `G86` stops the spindle at the bottom of the hole and the tool is out again, in which direction does the spindle restart: the one in force before the cycle (`M3` or `M4`), or always `M3`? The expansion writes the direction in force and refuses when none is known | No field; write the answer here |
| [ ] | Parameter 3405 bit 1: does your control count a dwell in revolutions when feed per revolution is in force? gEdit reads a `G4` as seconds (`X`) or increments (`P`) only, and counts only seconds in the time estimate | No field; write the answer here |
| [ ] | Parameter 3404 bit 2: does `M198 P` mean a file number on your control? With the bit off and a program on a Handy File or floppy disk, the `P` of `M198` is a file number; with a memory card or data server it is a program number. gEdit reads the `P` of `M198` as a program number everywhere: the channel checks, and Renumber Blocks (an `M198` is a call like `M98`, so an `M99 P` in the program it names is rewritten for it). Write which of the two your control does | No field; write the answer here |
| [ ] | Is `M96` reassigned (the M number of the interrupt macro call can be moved by a parameter), and to which number? gEdit reads `M96 P…` as an interrupt call: it never proves which program an `M99 P` returns to (an interrupt returns into whichever program it interrupted), and a bare `M96` calls nothing. If your control moved the interrupt to another M number, Renumber Blocks does not know it | No field; write the answer here |
| [ ] | Does the Fanuc mill start in direct rpm (`G97`) after a reset? The profile data does not say; the speed marks of the time estimate and the checks "read as rpm" until it does | No field; write the answer here |

## Okuma (8)

See [Okuma: the unit system scales every number](../../user/machines.md#okuma-the-unit-system-scales-every-number) and [syntax-okuma section 10](../syntax/syntax-okuma.md#10-open-questions--verify-on-real-cam-output).

| Done | Fact | Where in gEdit |
|---|---|---|
| [ ] | Confirm the 1 mm unit system on each machine (your programs are consistent with it) | Machine form: **How the control reads numbers** (unit 1 mm) |
| [ ] | How many tool offsets each lathe has (about 64 here; 200 or more is the "three-digit offsets" choice) | Machine form: **Tool word: offset digits** |
| [ ] | Whether the machines have `G142` and `G143` | No field; write the answer here |
| [ ] | After `G141`, whether a plain `S` drives the sub spindle (kept as the main spindle's speed until you answer) | No field; write the answer here |
| [ ] | Which Okuma machines are machining centres, which control they run, and whether you can supply its programming manual | No field; write the answer here |
| [ ] | On the machining centres: what `G16 H0`, `G71 Z`, `M54`, the `P` of the drilling cycles and `G169`/`G170` do, and whether a five-digit `N` is accepted | No field; write the answer here |
| [ ] | Whether you have a B-axis multi-tasking turning centre | No field; write the answer here |
| [ ] | Power-on feed mode, positioning and spindle-speed mode of each machine | Machine form: **Feed mode**, **Positioning** and **Spindle-speed mode at power-on** |

## Sinumerik (7)

See [Sinumerik: diameter programming and the rest](../../user/machines.md#sinumerik-diameter-programming-and-the-rest) and [syntax-sinumerik section 10](../syntax/syntax-sinumerik.md#10-open-questions--verify-on-real-cam-output).

| Done | Fact | Where in gEdit |
|---|---|---|
| [ ] | Tool management on or off (then `T="NAME"`, and `T=<n>` is a magazine place) | Not a setting; gEdit reads both forms. Write the answer here |
| [ ] | A turret `T` or `M6` for the tool change | Machine form (Sinumerik milling): **Tool change** |
| [ ] | A spindle encoder (`CYCLE840` ENC) | No field; write the answer here |
| [ ] | The real reset state (the control's own is G17/G94/DIAMOF; gEdit assumes G18/G95/DIAMON for turning) | Machine form: **Plane at power-on**, **Feed mode at power-on**, **X is a diameter at power-on** |
| [ ] | The `CYCLE832` version | No field; write the answer here |
| [ ] | Which machines run ISO mode (`G291`; two programs in your Siemens folder look like it) | No field; the program is read with a Fanuc profile (choose it by hand) |
| [ ] | Which Fanuc reading the ISO-mode machines emulate | No field; write the answer here |

## Heidenhain (7)

Klartext has no machine fields, so these are written down, not set. See [syntax-heidenhain section 10](../syntax/syntax-heidenhain.md#10-open-questions--to-verify-on-real-cam-output). Where it matters, the answer becomes a profile of your own ([Your own profiles](../../user/profiles.md)).

| Done | Fact | Where in gEdit |
|---|---|---|
| [ ] | Control generation and NC software number per machine (decides Q395, the legacy-code check and the TCPM form) | No machine form for Klartext; write the answer here (a profile of your own later) |
| [ ] | Whether cycle 19 reads spatial or axis angles | No field; write the answer here |
| [ ] | The dialog language, and whether the turning option is present | No field; write the answer here |
| [ ] | One CAM drilling program from each machine, to see whether the posts write Q395 | Put it in `tests/real/` (never committed) |
| [ ] | The NC software number of each machine, 07 or 08 and later (added for P4b): the manuals do not settle whether the dwell `Q211` of cycles 200 and 201 is read the same on both; the expansion and the time estimate take it as seconds | No field; write the answer here |
| [ ] | Does your control show the dwell of cycle 9 under its German text (`VERWEILZEIT`, `V.ZEIT`)? The data names the lines in English only, so a German program's dwell is not timed | No field; put a German sample in `tests/real/` (never committed) |
| [ ] | Is a position written with `M92` in machine coordinates on your control (so the travel check can judge it)? | No field; write the answer here |

## Motion and limits, all machines (8), added in P4b

Every value is optional and none is assumed. Set them on the page **Motion and limits** of the machine form ([Motion and limits](../../user/machines.md#motion-and-limits)), from the machine's data sheet or parameter list. A machine without them still works; the time estimate, the peck values of the expansion and the two limit checks then say *not set* and stay silent.

| Done | Fact | Where in gEdit |
|---|---|---|
| [ ] | The unit of the machine's rates and travel (mm or inch) | Machine form, Motion and limits: **Units** |
| [ ] | The rapid rate of each axis, per minute (degrees per minute for a rotary axis) | Motion and limits: **Rapid rate** of each axis |
| [ ] | Whether a rapid move runs as a straight line (all axes arrive together) or each axis at its own rate | Motion and limits: **How a rapid move runs** |
| [ ] | The top cutting feed | Motion and limits: **Top cutting feed** |
| [ ] | The time of one tool change | Motion and limits: **Tool change time** |
| [ ] | The two peck settings of the control: the retract of `G73` and the clearance of `G83` | Motion and limits: **Retract of a high-speed peck**, **Clearance of a deep peck** |
| [ ] | The top spindle speed of the main spindle and of each other spindle | Motion and limits: **Top spindle speed** |
| [ ] | The travel of each axis in machine coordinates, lowest and highest; on a lathe the X travel as a diameter | Motion and limits: **Travel** |

## Added by the manual check (2026-10-26), per machine

The manual-check fix round made these readings choices or marked them "verify". Each default stays until your machine says otherwise.

| Done | Fact | Where in gEdit |
|---|---|---|
| [ ] | Fanuc lathe: how the control reads a number without a point in a feed per revolution and a thread lead (0.0001 mm/rev by default, 0.01 mm/rev in the Series 15 format) and in a feed per minute (parameters 1404 bit 2 and 0001 bit 1) | Machine form: **Point-less feeds** |
| [ ] | Fanuc mill: whether a feed per revolution without a point counts in 0.001 mm/rev (parameter 1405 bit 1) | Machine form: **Point-less feeds** |
| [ ] | Fanuc lathe: whether a short `T` word (`T12`) is the station (the default, verify) or tool 0 with offset 12, as the manual says for two-digit offsets | Machine form: **Tool word: offset digits** (no field for the short word itself; write the answer here) |
| [ ] | Fanuc lathe: turret (the `T` word changes the tool) or tool changer (`T` selects, `M6` changes; parameter 5040 bit 3) | Machine form: **Tool change** |
| [ ] | Fanuc mill: is the `T` on the `M6` line the tool loaded or the next tool | Machine form: **T on the M6 line** |
| [ ] | Sinumerik turning and milling: does `T` change the tool, or `M6` (machine data 22550) | Machine form: **Tool change** |
| [ ] | Lathes: does `Y` turn with `Z` when a program is mirrored for the counter spindle | Machine form: **Counter spindle** |
| [ ] | Okuma: is a `P` word with a minus sign (`P-10`) a wait both turrets need, outside the order | The **Two turrets in one program** preset (a `P-10` rule, to be confirmed) |
| [ ] | Fanuc mill with a tilted plane and tool centre point control: is parameter 19696 bit 5 = 0 (the table coordinate system), as translate assumes | No field; write the answer here |
| [ ] | Fanuc: the presets for Nakamura-Tome (two and three units) and the Star SV-20: do the wait codes and the `P` form match your machine | Channels step: the three new presets |
