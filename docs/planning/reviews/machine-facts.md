# Review: machine facts

Facts only your machines can say. Nothing here is needed now: every default of [P2 section 8.8](../phase-2-implementation.md#88-machine-parameters-per-profile-the-defaults-none-assumes) stays marked as assumed, and a machine you set up overrides it. Each row names where in gEdit the answer goes.

How to work through it:

1. Open **Settings > Machines**, add or edit the machine of the control (see [Machines](../../user/machines.md#defining-a-machine)).
2. Find the fact on the control (its parameter list or manual), set it in the field named in the row, and tick the box.
3. Where a row says "no field", the fact is not a gEdit setting yet: write the answer next to the row (or tell the next session), then tick.
4. Check one real program with the machine chosen and with "none" (F7, the tool list) after the first machine of each control.

Control families: 12 Fanuc lathe facts, 8 Okuma, 7 Sinumerik, 4 Heidenhain, 31 rows in all.

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

## Heidenhain (4)

Klartext has no machine fields, so these are written down, not set. See [syntax-heidenhain section 10](../syntax/syntax-heidenhain.md#10-open-questions--to-verify-on-real-cam-output). Where it matters, the answer becomes a profile of your own ([Your own profiles](../../user/profiles.md)).

| Done | Fact | Where in gEdit |
|---|---|---|
| [ ] | Control generation and NC software number per machine (decides Q395, the legacy-code check and the TCPM form) | No machine form for Klartext; write the answer here (a profile of your own later) |
| [ ] | Whether cycle 19 reads spatial or axis angles | No field; write the answer here |
| [ ] | The dialog language, and whether the turning option is present | No field; write the answer here |
| [ ] | One CAM drilling program from each machine, to see whether the posts write Q395 | Put it in `tests/real/` (never committed) |
