# Expand Drilling Cycles goldens (P4.7)

The format is the geometry goldens' (`../README.md`, "The drilling and time goldens"): each folder
holds `input.nc`, `params.json` (`peckRetract`, `peckClearance`), `case.json` (the profile, and the
selection where there is one), optional `preceding.nc`, then `expected.nc` with `envelope.json`
or `refused.json`. `tests/python/test_expand_cycles.py` runs every folder, walks each written
program with the path tracker (every hole of the input reached in order, the same end point) and
compares the extents of `expected.nc` with those of `input.nc` (X23) where the input's report
resolves them. Every program here is synthetic and carries the `WRITTEN FOR GEDIT` marker.

**The schemas** are the shipped ones (`src/lib/data/codes/*.json`, written by P4.6), read from
the resolved databases. Until the Wave A integration the cases ran with test schemas of their
own; where the two disagreed the integration settled each difference from the manuals (Klartext
203 and `CYCLE83` with `VARI=0` have no schema, `CYCLE81` dwells by `DTB`, `CYCLE86` turns the
spindle on in `SDIR` before it drills and leaves it oriented, and a peck counts from the surface
where the cycle has one).

| Case | Dialect | What it shows |
|---|---|---|
| `fanuc-g81-g98-g99` | Fanuc mill | `G81` under `G98` and `G99`, the blocks that run it again, the comment kept, `G1` written back after `G80` |
| `fanuc-g81-incremental-repeat` | Fanuc mill | `G91` with `K3` and `K2`: increments copied, the initial level kept over the blocks |
| `fanuc-g83-g73-pecks` | Fanuc mill | the deep peck with the form's clearance, the high-speed peck with its retract, `G98`/`G99` |
| `fanuc-g83-incremental` | Fanuc mill | the deep peck under `G91` with `K2` |
| `fanuc-g82-g85-g86-g89` | Fanuc mill | the dwell copied as `G4 P…`, the feed out, the spindle stop and restore, a cycle code changed at the initial level |
| `fanuc-pecks-no-form` | Fanuc mill | refused: the two form fields empty (Q4-9) |
| `fanuc-tapping-no-schema` | Fanuc mill | refused: a tapping cycle, a cycle without a schema (`G87`) |
| `fanuc-return-assumed` | Fanuc mill | refused: no `G98`/`G99` (the owner, 2026-10-19) |
| `fanuc-radius-comp`, `fanuc-distance-assumed`, `fanuc-start-unknown` | Fanuc mill | refused for the state the cycle runs in; a cycle code changed below its initial level |
| `fanuc-expression-machine-dependent` | Fanuc mill | refused: a variable, a point-less word with no machine |
| `fanuc-plane-frame` | Fanuc mill | refused: a cycle under `G68`, a cycle in `G18` |
| `fanuc-depth-direction-param-unknown` | Fanuc mill | refused: a bottom above the R point, a `Q` in `G81`, `G0` in a cycle block |
| `fanuc-selection-*` | Fanuc mill | a selection with the whole cycle; refused: a cycle started above, one still in force at the end, a mode to restore below, no lines above |
| `lathe-refused` | Fanuc lathe | refused: a turning program |
| `klartext-200-calls` | Klartext | cycle 200 by `M99`, `CYCL CALL POS` (its `Z` shifts the surface), `M89`, `CYCL CALL`; the feed written back; renumbered |
| `klartext-201-reaming` | Klartext | cycle 201: in at `Q206`, the dwell as cycle 9, out at `Q208`; cycle 200 with `Q211=0.0` and `Q395=+0` (a default compared as a number) and its pecks counted from the surface |
| `klartext-201-retract-zero` | Klartext | cycle 201 with `Q208=0` and `Q208=+0.0`: out at the plunging feed `Q206`, as the manual says (the owner, 2026-10-20; the schema's `feedOutZero`), so the out move writes no feed of its own |
| `klartext-call-forms` | Klartext | refused: `CYCL CALL PAT`, `CYCL CALL POS` with the tool below the surface |
| `klartext-refusals` | Klartext | refused: a value off its default, cycle 206, cycle 203 (no schema: its full retract runs at `Q208`), cycle 201 with a plunging feed `Q206=0` (its `Q208=0` alone would mean the plunging feed) |
| `klartext-selection-renumber`, `klartext-selection-to-end` | Klartext | refused: a selection that does not reach `END PGM`; written: one that does |
| `sinumerik-cycle81-mcall`, `sinumerik-cycle81-incremental` | Sinumerik | `MCALL CYCLE81(…)`: the positioning blocks stay, `G1` written back, moves under `G91` |
| `sinumerik-cycle83-vari` | Sinumerik | `CYCLE83` with `VARI=1`: the pecks counted from `RFP`, `FDEP` and `FDPR`, `FRF=0`, `_AXN=3` and `_DMODE=1` (values the manuals prove equal to the default) |
| `sinumerik-cycle82-cycle86` | Sinumerik | the dwell as `G4 F…`; `CYCLE86`: the spindle on in `SDIR` first, the oriented stop `SPOS=`, the lift-off |
| `sinumerik-cycle85-cycle89` | Sinumerik | `CYCLE81` with its dwell, `CYCLE85` in at `FFR` and out at `RFF` with the feed written back, `CYCLE89` |
| `sinumerik-dp-dpr` | Sinumerik | `DPR` wins over `DP` unless it is 0 |
| `sinumerik-refusals` | Sinumerik | refused: `VARI=2`, `VARI=0` (no schema), `FRF=0.5`, `_DMODE=2`, an empty `SDIS`, `CYCLE84`, a variable |
| `fanuc-calls-under-cycle` | Fanuc mill | refused (fix batch 1, NC-1): `M98` and `GOTO` while `G81` is in force; `K0` without a position stores the data and drills nothing |
| `fanuc-cycle-block-refusals` | Fanuc mill | refused: `K0` with a position (the owner's question Q1), `K10000` (more than 9999 repeats, CODE-1), `G43` in the cycle block (NC-16), `G86` under `M4` (Q2) |
| `fanuc-k0-data-kept` | Fanuc mill | a cycle block with `K0` and no position stays as written, block number and all (fix batch 7, the owner's answer G): it stores the values and drills nothing, an information row says so; the first move written after it carries `G0` (it ends the cycle on the control, as `G80` does) and the feed in force; a `K0` block with `M8` stays as written too |
| `fanuc-block-skip` | Fanuc mill | refused (NC-2, NC-2b): a skipped block that runs the cycle, a skipped block that would get `G1` back, a skipped cycle block |
| `sinumerik-mcall-refusals` | Sinumerik | refused under `MCALL` (NC-10, NC-1): a block with only `F`, only `S`, only `G0`, and the pattern `HOLES1(…)` |
| `sinumerik-levels-refused` | Sinumerik | refused (NC-3, NC-7b, NC-9): `SDIS` below 0, `RTP` below `RFP`, `DPR=0` with no `DP`, `CYCLE86` without `SDIR` |
| `sinumerik-call-move-lift-off` | Sinumerik | a block with its own move and the call keeps the move as its own line (NC-4); `CYCLE86` with `RPAP=2` goes back from the lift-off in the plane only (NC-5) |
| `klartext-levels-refused` | Klartext | refused (NC-3, NC-7): `Q200` below 0, `Q204` below 0, `Q201=0`, `Q201` above 0 |
| `klartext-jump-and-skip` | Klartext | refused: an `FN 9` jump under `M89` (NC-1), a skipped `CYCL CALL` (NC-2) |
| `klartext-call-pos-feed` | Klartext | the `F` of `CYCL CALL POS` is the feed of the move to the cycle's start for that block only (fix batch 3, NC-6): the next move gets the feed in force before the calls, `F500`, back |
| `sinumerik-own-motion-restore` | Sinumerik | `G1` goes back on the first block that moves at the motion code in force (fix batch 5), not on `G74` (a block of its own) or `G75` (rapid), which move on their own (a Sinumerik `G53` block moves at the code in force and gets it: `RestoreTargetTest`) |
