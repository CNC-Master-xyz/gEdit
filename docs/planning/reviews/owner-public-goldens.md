# Review: the goldens of the owner's published programs

The twenty programs you published at github.com/CNC-Master-xyz/NC-Code are in `tests/fixtures/nc/owner-public/`, byte for byte as published. Two kinds of golden are built on them, and both carry `"ownerReviewed": false` until you have read them (plan §9.2): which profile each program has to open with ([expected/detect/owner-public.json](../../../tests/fixtures/expected/detect/owner-public.json)), and what its program map shows ([expected/outline/owner-public/](../../../tests/fixtures/expected/outline/owner-public/)). Where gEdit got a program wrong, the golden holds the right answer and the test runs it as an expected failure, so a golden is never a recording of a mistake. These programs are published, so naming them here is fine.

How to work through it:

1. Open the program in gEdit. Check that the profile in the status bar is the one the row names (the detected one, with no machine chosen).
2. Open the program map (the outline) and compare its rows with the row's tool changes: line, tool number and, where the program names the tool in a comment, its name. The line numbers are lines of the file.
3. Tick the row when both are right. Write what is wrong beside the row and leave it empty otherwise.
4. When a section is fully ticked, a later batch changes `ownerReviewed` to `true` in those files. Ticking does not change a golden by itself.

The two long programs (the 99,156-line `5X_MILLING_VECTOR.H` and the 44,629-line `5X_MILLING.NC`) are checked the same way; read the first tool change and the last rows of the map.

## Fanuc mill (3)

| Done | Program | Opens as | Program map to check | Source and goldens |
|---|---|---|---|---|
| [ ] | `2.5D_MILLING.NC`: A 2.5D part with four tools: face milling, pocketing, a contour and chamfering; `T1 M6` with the next tool preselected in the block after it, `G43 … H`, `G69` and `G54` in the header, `M2`. | Fanuc mill (`fanuc-gcode`) | 22 map rows; 4 tool rows: T1 (line 9), T2 (line 225), T3 (line 642), T4 (line 751) | [program](../../../tests/fixtures/nc/owner-public/fanuc-gcode/2.5D_MILLING.NC); [outline golden](../../../tests/fixtures/expected/outline/owner-public/fanuc-gcode/2.5D_MILLING.NC.json) |
| [ ] | `5-Axis.NC`: A short simultaneous 5-axis program on B and C with one tool, `T2 M6` and `M6 T0` at the end, no comments. | Fanuc mill (`fanuc-gcode`) | 3 map rows; 1 tool row: T2 (line 4) | [program](../../../tests/fixtures/nc/owner-public/fanuc-gcode/5-Axis.NC); [outline golden](../../../tests/fixtures/expected/outline/owner-public/fanuc-gcode/5-Axis.NC.json) |
| [ ] | `5X_MILLING.NC`: 5-axis milling at constant Z with one ball mill and tool centre point control (`G43.4`), 44,629 lines. | Fanuc mill (`fanuc-gcode`) | 6 map rows; 1 tool row: T1 (line 9) | [program](../../../tests/fixtures/nc/owner-public/fanuc-gcode/5X_MILLING.NC); [outline golden](../../../tests/fixtures/expected/outline/owner-public/fanuc-gcode/5X_MILLING.NC.json) |

## Fanuc lathe, system A (2)

Both programs open with G-code system A (`detected` in the golden).

| Done | Program | Opens as | Program map to check | Source and goldens |
|---|---|---|---|---|
| [ ] | `TURN.NC`: The same part for a lathe whose control writes Fanuc-style ISO code with codes of its builder, every block ended with `;`: 3-digit `T` words, `G76` in one block, and the builder's own cycles for polar milling, radial drilling and radial tapping. | Fanuc lathe, system A (`fanuc-lathe`) | 15 map rows; 13 tool rows: T1 (line 7), T2 (line 161), T3 (line 193), T4 (line 213), T4 (line 267), T5 (line 273), T5 (line 310), T6 (line 316), T6 (line 353), T7 (line 359), T7 (line 657), T8 (line 663) and 1 more | [program](../../../tests/fixtures/nc/owner-public/fanuc-lathe/TURN.NC); [outline golden](../../../tests/fixtures/expected/outline/owner-public/fanuc-lathe/TURN.NC.json) |
| [ ] | `TURN_1.NC`: A turning part with eight tools, without `%`: OD roughing and finishing under `G50 S`, `G96`/`G97` and `G99`, a two-block `G76` thread, and driven tools under `G98` on the C axis: face and side drilling (`G83`, `G87`), polar-coordinate milling (`G12.1`) and side tapping (`G88`, the feed written as speed × pitch). | Fanuc lathe, system A (`fanuc-lathe`) | 44 map rows; 8 tool rows: T01 (line 5), T02 (line 162), T03 (line 195), T04 (line 217), T05 (line 275), T06 (line 316), T07 (line 357), T08 (line 664) | [program](../../../tests/fixtures/nc/owner-public/fanuc-lathe/TURN_1.NC); [outline golden](../../../tests/fixtures/expected/outline/owner-public/fanuc-lathe/TURN_1.NC.json) |

## Heidenhain Klartext (6)

| Done | Program | Opens as | Program map to check | Source and goldens |
|---|---|---|---|---|
| [ ] | `2.5D_MILLING.H`: The 2.5D part: `CYCL DEF 7` and `247`, `PLANE SPATIAL`/`PLANE RESET`, `BLK FORM`, `* -` section headings, `TOOL CALL` with a `TOOL DEF` preselect, a speed-only `TOOL CALL S…`; numbers with a **decimal comma** (`X241,781`). | Klartext (`heidenhain-klartext`) | 22 map rows; 4 tool rows: T1 (line 14), T2 (line 234), T3 (line 673), T4 (line 784) | [program](../../../tests/fixtures/nc/owner-public/heidenhain-klartext/2.5D_MILLING.H); [outline golden](../../../tests/fixtures/expected/outline/owner-public/heidenhain-klartext/2.5D_MILLING.H.json) |
| [ ] | `5-Axis-1.H`: An older-style program: `CYCL DEF 19` tilting, datum shifts with `IX+Q1`, `F MAX` and `R F` written apart, numbers ending in a comma (`X+25,`), `STOP M30`. | Klartext (`heidenhain-klartext`) | 5 map rows; 1 tool row: T1 (line 10) | [program](../../../tests/fixtures/nc/owner-public/heidenhain-klartext/5-Axis-1.H); [outline golden](../../../tests/fixtures/expected/outline/owner-public/heidenhain-klartext/5-Axis-1.H.json) |
| [ ] | `5X_MILLING.H`: 5-axis at constant Z with `M128 F…`, decimal comma. | Klartext (`heidenhain-klartext`) | 6 map rows; 1 tool row: T1 (line 14) | [program](../../../tests/fixtures/nc/owner-public/heidenhain-klartext/5X_MILLING.H); [outline golden](../../../tests/fixtures/expected/outline/owner-public/heidenhain-klartext/5X_MILLING.H.json) |
| [ ] | `5X_MILLING_VECTOR.H`: Sweep finishing with `LN` blocks and normal and tool vectors (`NX…TZ`), decimal comma, 99,156 lines. | Klartext (`heidenhain-klartext`) | 6 map rows; 1 tool row: T1 (line 14) | [program](../../../tests/fixtures/nc/owner-public/heidenhain-klartext/5X_MILLING_VECTOR.H); [outline golden](../../../tests/fixtures/expected/outline/owner-public/heidenhain-klartext/5X_MILLING_VECTOR.H.json) |
| [ ] | `DRILLING.H`: Drilling, tapping, reaming and boring with five tools: cycles 200–203, 206 and 209 as `~` continuation blocks with `;` parameter comments, `CYCL CALL`, `M99` repeats; decimal comma in the Q values (`Q239=1,5`, a pitch). | Klartext (`heidenhain-klartext`) | 28 map rows; 5 tool rows: T1 (line 14), T2 (line 128), T3 (line 230), T5 (line 264), T4 (line 292) | [program](../../../tests/fixtures/nc/owner-public/heidenhain-klartext/DRILLING.H); [outline golden](../../../tests/fixtures/expected/outline/owner-public/heidenhain-klartext/DRILLING.H.json) |
| [ ] | `Demo_1.H`: A 3+2 program with decimal points: `;` comment blocks, `CALL LBL` to datum and swivel labels after `M30`, `PLANE SPATIAL … TURN MB MAX FMAX SEQ-`, `F AUTO`, a speed-only `TOOL CALL`. | Klartext (`heidenhain-klartext`) | 110 map rows; 1 tool row: T1 (line 14) | [program](../../../tests/fixtures/nc/owner-public/heidenhain-klartext/Demo_1.H); [outline golden](../../../tests/fixtures/expected/outline/owner-public/heidenhain-klartext/Demo_1.H.json) |

## Okuma (4)

The three milling programs are for a machining-centre control and gEdit has only the Okuma turning profile, so they open with it. Their map shows no tool changes today (the turning tool rule wants a four- or six-digit `T` word); the golden is the map the program means. Check that `T1 M6` and the tool numbers listed are right.

| Done | Program | Opens as | Program map to check | Source and goldens |
|---|---|---|---|---|
| [ ] | `2.5D_MILLING.min`: The 2.5D part for the machining-centre control: `G15 H1` work offsets, `G56 H1` length offsets, `T1 M6`, no header and no program number. | Okuma (`okuma-osp`) | **Known gap, the golden holds the right answer:** 4 tool changes, T1 (line 6), T2 (line 222), T3 (line 638), T4 (line 747). gEdit shows none today. | [program](../../../tests/fixtures/nc/owner-public/okuma-osp/2.5D_MILLING.min); [_known-gaps.json](../../../tests/fixtures/expected/outline/owner-public/_known-gaps.json) |
| [ ] | `5X_MILLING.min`: 5-axis at constant Z between `G169` and `G170`. | Okuma (`okuma-osp`) | **Known gap, the golden holds the right answer:** 1 tool changes, T1 (line 6). gEdit shows none today. | [program](../../../tests/fixtures/nc/owner-public/okuma-osp/5X_MILLING.min); [_known-gaps.json](../../../tests/fixtures/expected/outline/owner-public/_known-gaps.json) |
| [ ] | `DRILLING.min`: Drilling, tapping (`G84`), reaming and boring cycles over modal hole positions, and a tapping pass with chip breaking written out as single `G1` moves between `M3`/`M4`/`M5` reversals, 5,044 lines. | Okuma (`okuma-osp`) | **Known gap, the golden holds the right answer:** 5 tool changes, T1 (line 6), T2 (line 73), T3 (line 4982), T5 (line 5008), T4 (line 5027). gEdit shows none today. | [program](../../../tests/fixtures/nc/owner-public/okuma-osp/DRILLING.min); [_known-gaps.json](../../../tests/fixtures/expected/outline/owner-public/_known-gaps.json) |
| [ ] | `TURN.min`: The turning part for the OSP lathe: `G140`, six-digit `T010101`, `G50 S`, `G96`/`G97`, `G95`, the one-block thread cycle `G71 … F2`, and driven tools with `SB=`, `M13`, `G101` and the tapping cycle `G184`. | Okuma (`okuma-osp`) | 44 map rows; 8 tool rows: T01 (line 6), T02 (line 163), T03 (line 192), T04 (line 209), T05 (line 268), T06 (line 290), T07 (line 313), T08 (line 617) | [program](../../../tests/fixtures/nc/owner-public/okuma-osp/TURN.min); [outline golden](../../../tests/fixtures/expected/outline/owner-public/okuma-osp/TURN.min.json) |

## Sinumerik turning (1)

| Done | Program | Opens as | Program map to check | Source and goldens |
|---|---|---|---|---|
| [ ] | `TURN_1.mpf`: The turning part: `SETMS(1)`/`SETMS(2)`, `LIMS=`, `DIAMON`, `G95`/`G96`, `L131`, `CYCLE97` threading, and driven tools with `S2=`, `CYCLE81` and `CYCLE84`. | Sinumerik turning (`sinumerik`) | 65 map rows; 8 tool rows: T1 (line 6), T2 (line 162), T3 (line 189), T4 (line 204), T5 (line 259), T6 (line 302), T7 (line 346), T8 (line 648) | [program](../../../tests/fixtures/nc/owner-public/sinumerik/TURN_1.mpf); [outline golden](../../../tests/fixtures/expected/outline/owner-public/sinumerik/TURN_1.mpf.json) |

## Sinumerik milling (4)

| Done | Program | Opens as | Program map to check | Source and goldens |
|---|---|---|---|---|
| [ ] | `2.5D_Milling.mpf`: The 2.5D part: `%_N_1_MPF` and `;$PATH=`, `CYCLE800` without arguments, `T1 D1` then `M6` with the next tool preselected, `CR=` arcs. | Sinumerik milling (`sinumerik-mill`) | 24 map rows; 4 tool rows: T1 (line 9), T2 (line 227), T3 (line 646), T4 (line 758) | [program](../../../tests/fixtures/nc/owner-public/sinumerik-mill/2.5D_Milling.mpf); [outline golden](../../../tests/fixtures/expected/outline/owner-public/sinumerik-mill/2.5D_Milling.mpf.json) |
| [ ] | `5X_Milling.mpf`: 5-axis at constant Z under `TRAORI`. | Sinumerik milling (`sinumerik-mill`) | 8 map rows; 1 tool row: T1 (line 9) | [program](../../../tests/fixtures/nc/owner-public/sinumerik-mill/5X_Milling.mpf); [outline golden](../../../tests/fixtures/expected/outline/owner-public/sinumerik-mill/5X_Milling.mpf.json) |
| [ ] | `DRILLING.mpf`: Drilling, tapping, reaming and boring with `MCALL CYCLE81`–`CYCLE86 (…)`, a blank before the bracket, the feed in a block of its own before each call, `G75` fixed-point retracts. | Sinumerik milling (`sinumerik-mill`) | 33 map rows; 5 tool rows: T1 (line 8), T2 (line 746), T3 (line 2406), T5 (line 2435), T4 (line 2457) | [program](../../../tests/fixtures/nc/owner-public/sinumerik-mill/DRILLING.mpf); [outline golden](../../../tests/fixtures/expected/outline/owner-public/sinumerik-mill/DRILLING.mpf.json) |
| [ ] | `Demo_1.mpf`: A 3+2 program without the transfer header: a `;` comment header, `WORKPIECE(…)`, `T="…" D1` and `M6`, `CYCLE800(…)` swivels, `MSG("…")`. | Sinumerik milling (`sinumerik-mill`) | 32 map rows; 1 tool row: T"TEST_KOM" (line 21) | [program](../../../tests/fixtures/nc/owner-public/sinumerik-mill/Demo_1.mpf); [outline golden](../../../tests/fixtures/expected/outline/owner-public/sinumerik-mill/Demo_1.mpf.json) |

## The three files behind them

The files that hold the goldens carry the mark themselves. Read each once.

| Done | File | What to look at |
|---|---|---|
| [ ] | [expected/detect/owner-public.json](../../../tests/fixtures/expected/detect/owner-public.json) | The 20 profile names against the programs above, the two `gcodeSystem: A` entries for the Fanuc lathe programs, and `knownGaps` being empty. |
| [ ] | [expected/outline/owner-public/_known-gaps.json](../../../tests/fixtures/expected/outline/owner-public/_known-gaps.json) | The three Okuma milling programs: the tool changes listed as line and tool are the ones you expect (`2.5D_MILLING.min` four tools, `5X_MILLING.min` one, `DRILLING.min` five). The reason says gEdit's turning tool rule is why the map is empty. |
| [ ] | [expected/owner-public/known-gaps.json](../../../tests/fixtures/expected/owner-public/known-gaps.json) | The notes and the three Okuma milling entries (fix: the machining-centre profile). No unknown token is listed for any of the 20 programs. |

## Counts

20 program rows and 3 file rows: **23** rows.
