# Review: the code data filled in from the manuals

184 entries of the code databases carry `"review": "pending"`. Bug-fix round 1 filled them in from the manuals (the record is [bugfix-round-1.md](../bugfix-round-1.md#manual-sources-of-the-data), section 6 lists the manuals and pages). The app does not show the mark; removing it is the sign-off.

How to work through it:

1. Hover the code in a program of the dialect (or read its entry in the code file named above each group) and read the label and the description against your control.
2. Where a row has an **Open question**, that is what the manuals left open; answer it from your machine. Tick the row when the entry is right; if it is wrong, write what is wrong beside it and do not tick.
3. The source column is what the round recorded. The record names the manual and the pages by topic, not per entry; where the page of one entry is not recorded, the row says so.
4. When a dialect is fully ticked, a later batch removes the marks.

The record in bugfix-round-1.md section 7 counts the entries differently (10 Okuma, 24 Sinumerik, 24 Klartext, "the Fanuc entries"); these are the counts in the data today (151 before the v1.2.0 NC fix round, 33 added):

| Dialect | File | Entries |
|---|---|---|
| Fanuc mill | `fanuc.json` | 25 |
| Fanuc lathe (system A) | `fanuc-lathe.json` | 15 |
| Fanuc lathe, system B | `fanuc-lathe-b.json` | 4 |
| Heidenhain Klartext | `heidenhain.json` | 56 |
| Okuma | `okuma.json` | 23 |
| Sinumerik (turning and milling) | `sinumerik.json` | 61 |
| **Total** | | **184** |

The 49 templates have their own page: [templates.md](templates.md).

## Added in the v1.2.0 NC fix round

33 entries are new to the review in the NC fix round of v1.2.0 (the fix round marked them `"review": "pending"` because it gave them lengths, tapers or a description). The 24 entries of this round that were already on the page are not repeated: their rows below carry a **Changed in v1.2.0** note. Three readings are open questions the round could not settle from the manuals: Klartext 240 `Q344`, the Sinumerik chamfer widths `_FS`, and the Okuma `G31`/`G33` taper `I` in force. A fourth is a question about the lathe single passes: does ending the cycle mode with `G00` or `G01` clear the pass's `X`, `Z` and `R`? gEdit keeps `R` and distrusts the end point, which is the cautious reading.

### Fanuc mill: added in v1.2.0 (1)

File `fanuc.json`.

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G10` | Data setting | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read that `L1` and `L10` to `L13` write a tool offset and `L2` and `L20` a work offset (the entry now says so), and the label and hover text. Translate, rotate and mirror let a tool-offset write pass and still refuse a work-offset write, a variable for `L`, and (on the lathe) a `G10` without `L`. |

### Fanuc lathe (system A): added in v1.2.0 (3)

File `fanuc-lathe.json`.

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G90` | Turning pass | Fanuc lathe system manual (B-63944GE-1/02) (section for this entry not recorded) | Read the taper `R` (a difference in radius, along X), that X, Z and R stay in force for the next pass blocks, and the label and hover text. **Open question:** whether a `G00` or `G01` clears X, Z and R of the pass (gEdit keeps R and distrusts the end point; the extents use this). |
| [ ] | `G92` | Threading pass as a cycle | Fanuc lathe system manual (B-63944GE-1/02) (section for this entry not recorded) | Read the taper `R` (along X), that X, Z and R stay in force, and the label and hover text. A taper thread is refused by the lathe Z mirror as a thread. **Open question:** the same as for `G90` (does `G00`/`G01` clear X, Z and R). |
| [ ] | `G94` | Facing pass | Fanuc lathe system manual (B-63944GE-1/02) (section for this entry not recorded) | Read the taper `R` (a difference along Z), that X, Z and R stay in force, and the label and hover text. **Open question:** the same as for `G90`. |

### Fanuc lathe, system B: added in v1.2.0 (3)

File `fanuc-lathe-b.json`.

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G77` | Turning pass | Fanuc lathe system manual (B-63944GE-1/02) (section for this entry not recorded) | As `G90` of system A: the taper `R` along X, X, Z and R in force, the label and hover text. **Open question:** does `G00`/`G01` clear X, Z and R. |
| [ ] | `G78` | Threading pass as a cycle | Fanuc lathe system manual (B-63944GE-1/02) (section for this entry not recorded) | As `G92` of system A. **Open question:** does `G00`/`G01` clear X, Z and R. |
| [ ] | `G79` | Facing pass | Fanuc lathe system manual (B-63944GE-1/02) (section for this entry not recorded) | As `G94` of system A: the taper `R` along Z. **Open question:** does `G00`/`G01` clear X, Z and R. |

### Heidenhain Klartext: added in v1.2.0 (14)

File `heidenhain.json`.

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `CR` | Arc by radius | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the radius `R` (marked as a length in the plane: refused under a multiply unless `R` is chosen), the sign rule, the label and hover text. |
| [ ] | `RND` | Corner rounding | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the radius `R` (a length in the plane), the label and hover text. |
| [ ] | `CHF` | Chamfer | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the number written behind `CHF` (the length of the chamfer, a length in the plane), the label and hover text. |
| [ ] | `APPR LT` | Approach on a tangential line | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the words `LEN`, `R` and `CCA` (lengths and an angle that keep their values under rotate and mirror), the label and hover text. |
| [ ] | `APPR LN` | Approach on a perpendicular line | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the words `LEN`, `R` and `CCA` (lengths and an angle that keep their values under rotate and mirror), the label and hover text. |
| [ ] | `APPR CT` | Approach on a tangential arc | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the words `LEN`, `R` and `CCA` (lengths and an angle that keep their values under rotate and mirror), the label and hover text. |
| [ ] | `APPR LCT` | Approach on a line and a tangential arc | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the words `LEN`, `R` and `CCA` (lengths and an angle that keep their values under rotate and mirror), the label and hover text. |
| [ ] | `DEP LT` | Departure on a tangential line | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the words `LEN`, `R` and `CCA` (lengths and an angle that keep their values under rotate and mirror), the label and hover text. |
| [ ] | `DEP LN` | Departure on a perpendicular line | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the words `LEN`, `R` and `CCA` (lengths and an angle that keep their values under rotate and mirror), the label and hover text. |
| [ ] | `DEP CT` | Departure on a tangential arc | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the words `LEN`, `R` and `CCA` (lengths and an angle that keep their values under rotate and mirror), the label and hover text. |
| [ ] | `DEP LCT` | Departure on a line and a tangential arc | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the words `LEN`, `R` and `CCA` (lengths and an angle that keep their values under rotate and mirror), the label and hover text. |
| [ ] | `CYCL DEF 208` | Bore milling cycle | TNC 640 cycle programming manual (10/2017) (section for this cycle not recorded) | Read the parameter names and order, the diameter to mill `Q335` and the pre-drilled diameter `Q342` (lengths in the plane), the label and hover text. |
| [ ] | `CYCL DEF 240` | Centring cycle | TNC 640 cycle programming manual (10/2017) (section for this cycle not recorded) | **Open question:** that the centring diameter `Q344` counts as a size of the part whenever it is not 0 (gEdit refuses a multiply then; it matters only with `Q343` = 1, centring to a diameter). Read the parameter names, the label and hover text. |
| [ ] | `CYCL DEF 262` | Thread milling | TNC 640 cycle programming manual (10/2017) (section for this cycle not recorded) | Read the parameter names and order, the thread diameter `Q335` (a length in the plane), the label and hover text. |

### Okuma: added in v1.2.0 (5)

File `okuma.json`.

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G31` | Thread pass along Z | OSP-P200L/P20L programming manual (3rd ed., 2007) (section for this entry not recorded) | **Open question:** that the taper `I` stays in force for the next pass blocks, as the entry says (gEdit refuses a multiply of X while it is in force). Read the chamfer `L` and the label and hover text. |
| [ ] | `G32` | Face thread pass | OSP-P200L/P20L programming manual (3rd ed., 2007) (section for this entry not recorded) | Read the taper `K` (along Z), the chamfer `L`, the label and hover text. |
| [ ] | `G33` | Thread pass along Z | OSP-P200L/P20L programming manual (3rd ed., 2007) (section for this entry not recorded) | **Open question:** that the taper `I` stays in force for the next pass blocks. Read the chamfer `L` and the label and hover text. |
| [ ] | `G102` | Contour arc with the C axis, clockwise | OSP-P200L/P20L programming manual (3rd ed., 2007) (section for this entry not recorded) | Read the arc radius `L` (a length in the plane), that the arc is the one under 180 degrees, the label and hover text. |
| [ ] | `G103` | Contour arc with the C axis, counter-clockwise | OSP-P200L/P20L programming manual (3rd ed., 2007) (section for this entry not recorded) | As `G102`. |

### Sinumerik (turning and milling): added in v1.2.0 (7)

File `sinumerik.json`.

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `CHF` | Chamfer at the corner | Sinumerik 840D sl NC programming manual 06/2019 (page for this entry not recorded) | Read that `CHF=` is the length of the chamfer itself (a size in the plane), the label and hover text. |
| [ ] | `CHR` | Chamfer at the corner, by its leg | Sinumerik 840D sl NC programming manual 06/2019 (page for this entry not recorded) | Read that `CHR=` is the width along the move (a size in the plane), the label and hover text. |
| [ ] | `RND` | Rounding at the corner | Sinumerik 840D sl NC programming manual 06/2019 (page for this entry not recorded) | Read the radius (a size in the plane), the label and hover text. |
| [ ] | `RNDM` | Rounding at every corner | Sinumerik 840D sl NC programming manual 06/2019 (page for this entry not recorded) | Read that it rounds every following corner until `RNDM=0` (gEdit refuses a multiply for every moving block while it is not 0), the label and hover text. |
| [ ] | `CR` | Arc radius | Sinumerik 840D sl NC programming manual 06/2019 (page for this entry not recorded) | Read the sign rule (negative for the longer arc), that it is a size in the plane, the label and hover text. |
| [ ] | `FRC` | Feed of the chamfer or rounding | Sinumerik 840D sl NC programming manual 06/2019 (page for this entry not recorded) | Read that it is a feed and not a length (the transforms keep it), the label and hover text. |
| [ ] | `FRCM` | Feed of the chamfers and roundings | Sinumerik 840D sl NC programming manual 06/2019 (page for this entry not recorded) | Read that it holds until the next `FRCM=` and that 0 goes back to the path feed, the label and hover text. |

## Fanuc mill

File `fanuc.json`, 25 entries (24 below, 1 in [the v1.2.0 section](#added-in-the-v120-nc-fix-round)).

### Fanuc mill: Motion, reference positions and coordinate system (9)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G2` | Circular move, clockwise | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the radius `R` is marked as a length in the plane. Rotate, mirror and translate keep it; address arithmetic leaves a block with `R` as written under a multiply or divide unless `R` is chosen. Read the description of `R`. |
| [ ] | `G3` | Circular move, counter-clockwise | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the radius `R` is marked as a length in the plane (as for `G2`). |
| [ ] | `G5.4` | HRV3 or HRV4 servo control, on or off | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), section 4.14 (NURBS), pp. 118-122 | Read the label and hover text against your control. |
| [ ] | `G6.2` | NURBS interpolation | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), section 4.14 (NURBS), pp. 118-122 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G29` | Return from the reference point | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), sections 6.1 and 6.2 (reference position returns), pp. 159-166 | **Open question:** Whether G29 returns from a machine position (what the entry says). Read parameter names, order and units, what it sets in force, which words are axes, the label and hover text against your control. |
| [ ] | `G30.1` | Return to the floating reference point | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), sections 6.1 and 6.2 (reference position returns), pp. 159-166 | Read parameter names, order and units, what it sets in force, which words are axes, the label and hover text against your control. |
| [ ] | `G52` | Local coordinate system | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read how it shifts or frames the coordinates, which words are axes, the label and hover text against your control. |
| [ ] | `G53.1` | Turn the tool axis to the tilted plane | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read the label and hover text against your control. |
| [ ] | `G92.1` | Work coordinate system preset | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read how it shifts or frames the coordinates, which words are axes, the label and hover text against your control. |

### Fanuc mill: Compensation (G40-G49 family) (12)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G41` | Cutter radius compensation, left | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G42` | Cutter radius compensation, right | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G41.2` | Five-axis cutter radius compensation, left | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G41.3` | Five-axis cutter compensation on the leading edge | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G41.4` | Five-axis cutter radius compensation, left, older code for a machine with a turning table | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G41.5` | Five-axis cutter radius compensation, left, older code for a machine with a turning head and a turning table | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G41.6` | Five-axis cutter radius compensation, left, tool direction by I, J, K | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G42.2` | Five-axis cutter radius compensation, right | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G42.4` | Five-axis cutter radius compensation, right, older code for a machine with a turning table | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G42.5` | Five-axis cutter radius compensation, right, older code for a machine with a turning head and a turning table | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G42.6` | Five-axis cutter radius compensation, right, tool direction by I, J, K | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G43.1` | Tool length offset along the tool axis | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | **Open question:** That G43.1 stays off the lathe (it is not in the lathe sets). Read parameter names, order and units, what it sets in force, the label and hover text against your control. |

### Fanuc mill: Control flow (3)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `GOTO` | Jump to a block | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `DO` | Loop body start | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read the jump or branch behaviour, the label and hover text against your control. Also marked `verify` in the data. |
| [ ] | `END` | Loop body end | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read the jump or branch behaviour, the label and hover text against your control. Also marked `verify` in the data. |

## Fanuc lathe (system A)

File `fanuc-lathe.json`, 15 entries (12 below, 3 in [the v1.2.0 section](#added-in-the-v120-nc-fix-round)).

### Fanuc lathe (system A): Compensation (G40-G49 family) (2)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G41` | Nose radius compensation, tool left | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read what it sets in force, the label and hover text against your control. |
| [ ] | `G42` | Nose radius compensation, tool right | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read what it sets in force, the label and hover text against your control. |

### Fanuc lathe (system A): Motion, reference positions and coordinate system (3)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G50.3` | Work coordinate system preset | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read how it shifts or frames the coordinates, which words are axes, the label and hover text against your control. |
| [ ] | `G68.1` | Coordinate system rotation | Fanuc lathe system manual (B-63944GE-1/02), section 5.9, pp. 246-248 | Read parameter names, order and units, how it shifts or frames the coordinates, which words are axes, the label and hover text against your control. |
| [ ] | `G69.1` | Coordinate system rotation off | Fanuc lathe system manual (B-63944GE-1/02), section 5.9, pp. 246-248 | Read how it shifts or frames the coordinates, the label and hover text against your control. |

### Fanuc lathe (system A): Lathe cycles G70-G76 (7)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G70` | Finishing pass along the profile | Fanuc lathe system manual (B-63944GE-1/02), section 4.2 (multiple repetitive cycles), pp. 49-89 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G71` | Roughing cycle along Z | Fanuc lathe system manual (B-63944GE-1/02), section 4.2 (multiple repetitive cycles), pp. 49-89 | Read parameter names, order and units, what it sets in force, which words are axes, the label and hover text against your control. |
| [ ] | `G72` | Roughing cycle along X (facing) | Fanuc lathe system manual (B-63944GE-1/02), section 4.2 (multiple repetitive cycles), pp. 49-89 | Read parameter names, order and units, what it sets in force, which words are axes, the label and hover text against your control. |
| [ ] | `G73` | Pattern repeating cycle | Fanuc lathe system manual (B-63944GE-1/02), section 4.2 (multiple repetitive cycles), pp. 49-89 | Read parameter names, order and units, what it sets in force, which words are axes, the label and hover text against your control. |
| [ ] | `G74` | Face pecking cycle | Fanuc lathe system manual (B-63944GE-1/02), section 4.2 (multiple repetitive cycles), pp. 49-89 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G75` | Grooving cycle along X | Fanuc lathe system manual (B-63944GE-1/02), section 4.2 (multiple repetitive cycles), pp. 49-89 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G76` | Multi-pass threading cycle | Fanuc lathe system manual (B-63944GE-1/02), section 4.2 (multiple repetitive cycles), pp. 49-89 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |

## Fanuc lathe, system B

File `fanuc-lathe-b.json`, 4 entries (1 below, 3 in [the v1.2.0 section](#added-in-the-v120-nc-fix-round)).

### Fanuc lathe, system B: Motion, reference positions and coordinate system (1)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G92.1` | Work coordinate system preset | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read how it shifts or frames the coordinates, which words are axes, the label and hover text against your control. |

## Heidenhain Klartext

File `heidenhain.json`, 56 entries (42 below, 14 in [the v1.2.0 section](#added-in-the-v120-nc-fix-round)).

### Heidenhain Klartext: Program, stock and radius compensation (5)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `BLK FORM` | Stock definition | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read which words are axes, the label and hover text against your control. |
| [ ] | `RL` | Radius compensation, left | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read what it sets in force, the label and hover text against your control. |
| [ ] | `RR` | Radius compensation, right | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read what it sets in force, the label and hover text against your control. |
| [ ] | `VC` | Cutting speed (turning) | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read what it sets in force, the label and hover text against your control. |
| [ ] | `PATTERN DEF` | Pattern definition | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read parameter names, order and units, the label and hover text against your control. |

### Heidenhain Klartext: FN functions and labels (6)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `LBL` | Label | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `FN 9` | Jump if equal to | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `FN 10` | Jump if not equal to | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `FN 11` | Jump if greater than | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `FN 12` | Jump if less than | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `FN 17` | Write system data | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read how it shifts or frames the coordinates, the label and hover text against your control. |

### Heidenhain Klartext: Cycles (CYCL DEF) (18)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `CYCL DEF 7` | Datum shift | TNC 640 cycle programming manual (10/2017) (section for this cycle not recorded) | Read which words are axes, the label and hover text against your control. |
| [ ] | `CYCL DEF 8` | Mirror image | TNC 640 cycle programming manual (10/2017) (section for this cycle not recorded) | Read how it shifts or frames the coordinates, which words are axes, the label and hover text against your control. |
| [ ] | `CYCL DEF 10` | Rotation | TNC 640 cycle programming manual (10/2017) (section for this cycle not recorded) | Read how it shifts or frames the coordinates, the label and hover text against your control. |
| [ ] | `CYCL DEF 11` | Scaling factor | TNC 640 cycle programming manual (10/2017) (section for this cycle not recorded) | Read how it shifts or frames the coordinates, the label and hover text against your control. |
| [ ] | `CYCL DEF 19` | Working plane (older tilt cycle) | TNC 640 cycle programming manual (10/2017), section 10.9, pp. 313-316 | Read parameter names, order and units, how it shifts or frames the coordinates, which words are axes, the label and hover text against your control. |
| [ ] | `CYCL DEF 26` | Scaling factor per axis | TNC 640 cycle programming manual (10/2017) (section for this cycle not recorded) | Read parameter names, order and units, how it shifts or frames the coordinates, which words are axes, the label and hover text against your control. |
| [ ] | `CYCL DEF 251` | Rectangular pocket | TNC 640 cycle programming manual (10/2017), sections 5.2-5.7, pp. 161-193 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the side lengths, diameters, corner radii and stock sizes of the cycle are marked as lengths in the plane (a multiply or divide of X or Y refuses the cycle and its calls). |
| [ ] | `CYCL DEF 252` | Circular pocket | TNC 640 cycle programming manual (10/2017), sections 5.2-5.7, pp. 161-193 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the side lengths, diameters, corner radii and stock sizes of the cycle are marked as lengths in the plane (a multiply or divide of X or Y refuses the cycle and its calls). |
| [ ] | `CYCL DEF 253` | Slot milling | TNC 640 cycle programming manual (10/2017), sections 5.2-5.7, pp. 161-193 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the side lengths, diameters, corner radii and stock sizes of the cycle are marked as lengths in the plane (a multiply or divide of X or Y refuses the cycle and its calls). |
| [ ] | `CYCL DEF 254` | Circular slot | TNC 640 cycle programming manual (10/2017), sections 5.2-5.7, pp. 161-193 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the side lengths, diameters, corner radii and stock sizes of the cycle are marked as lengths in the plane (a multiply or divide of X or Y refuses the cycle and its calls). |
| [ ] | `CYCL DEF 256` | Rectangular stud | TNC 640 cycle programming manual (10/2017), sections 5.2-5.7, pp. 161-193 | **Open question:** `Q338` against `Q386` in this cycle. Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the side lengths, diameters, corner radii and stock sizes of the cycle are marked as lengths in the plane (a multiply or divide of X or Y refuses the cycle and its calls). |
| [ ] | `CYCL DEF 257` | Circular stud | TNC 640 cycle programming manual (10/2017), sections 5.2-5.7, pp. 161-193 | **Open question:** `Q338` against `Q386` in this cycle. Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the side lengths, diameters, corner radii and stock sizes of the cycle are marked as lengths in the plane (a multiply or divide of X or Y refuses the cycle and its calls). |
| [ ] | `CYCL DEF 14` | Contour | TNC 640 cycle programming manual (10/2017), sections 7.1-7.9 (SL cycles), pp. 222-246 | Read the label and hover text against your control. |
| [ ] | `CYCL DEF 21` | Pilot drilling (SL) | TNC 640 cycle programming manual (10/2017), sections 7.1-7.9 (SL cycles), pp. 222-246 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `CYCL DEF 22` | Clearing out (SL) | TNC 640 cycle programming manual (10/2017), sections 7.1-7.9 (SL cycles), pp. 222-246 | **Open question:** That `Q208` is optional. Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `CYCL DEF 23` | Floor finishing (SL) | TNC 640 cycle programming manual (10/2017), sections 7.1-7.9 (SL cycles), pp. 222-246 | **Open question:** That `Q208` is optional. Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `CYCL DEF 24` | Side finishing (SL) | TNC 640 cycle programming manual (10/2017), sections 7.1-7.9 (SL cycles), pp. 222-246 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `CYCL DEF 25` | Contour train | TNC 640 cycle programming manual (10/2017), sections 7.1-7.9 (SL cycles), pp. 222-246 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |

### Heidenhain Klartext: Tilted plane, transformations and special M functions (13)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `PLANE SPATIAL` | Tilt the working plane by spatial angles | TNC 640 Klartext programming manual (10/2017), pp. 611-613 | Read parameter names, order and units, how it shifts or frames the coordinates, the label and hover text against your control. |
| [ ] | `PLANE PROJECTED` | Tilt the working plane by projection angles | TNC 640 Klartext programming manual (10/2017), pp. 611-613 | Read parameter names, order and units, how it shifts or frames the coordinates, the label and hover text against your control. |
| [ ] | `PLANE EULER` | Tilt the working plane by Euler angles | TNC 640 Klartext programming manual (10/2017), pp. 611-613 | Read parameter names, order and units, how it shifts or frames the coordinates, the label and hover text against your control. |
| [ ] | `PLANE VECTOR` | Tilt the working plane by two vectors | TNC 640 Klartext programming manual (10/2017), pp. 611-613 | Read parameter names, order and units, how it shifts or frames the coordinates, the label and hover text against your control. |
| [ ] | `PLANE POINTS` | Tilt the working plane through three points | TNC 640 Klartext programming manual (10/2017), pp. 606-607 | Read parameter names, order and units, how it shifts or frames the coordinates, the label and hover text against your control. |
| [ ] | `PLANE RELATIV` | Tilt the working plane further by one angle | TNC 640 Klartext programming manual (10/2017), pp. 611-613 | Read parameter names, order and units, how it shifts or frames the coordinates, the label and hover text against your control. |
| [ ] | `PLANE AXIAL` | Tilt the working plane by axis angles | TNC 640 Klartext programming manual (10/2017), pp. 611-613 | Read parameter names, order and units, how it shifts or frames the coordinates, which words are axes, the label and hover text against your control. |
| [ ] | `PLANE RESET` | Reset the tilted working plane | TNC 640 Klartext programming manual (10/2017), pp. 611-613 | Read parameter names, order and units, how it shifts or frames the coordinates, the label and hover text against your control. |
| [ ] | `TRANS DATUM` | Datum shift | TNC 640 Klartext programming manual (10/2017) (page for this entry not recorded) | Read which words are axes, the label and hover text against your control. |
| [ ] | `M128` | Keep the tool tip on the path | TNC 640 Klartext programming manual (10/2017), pp. 625-626 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `M140` | Retract along the tool axis | TNC 640 Klartext programming manual (10/2017), p. 501 | Read parameter names, order and units, the label and hover text against your control. |
| [ ] | `MOVE` | Tilt with a compensating move | TNC 640 Klartext programming manual (10/2017) (TURNDATA SPIN, pp. 682-683, is the recorded turning source; this entry's page not recorded) | Read the label and hover text against your control. |
| [ ] | `TURN` | Tilt the rotary axes only | TNC 640 Klartext programming manual (10/2017) (TURNDATA SPIN, pp. 682-683, is the recorded turning source; this entry's page not recorded) | Read the label and hover text against your control. |

## Okuma

File `okuma.json`, 23 entries (18 below, 5 in [the v1.2.0 section](#added-in-the-v120-nc-fix-round)).

### Okuma: G codes (15)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G2` | Arc, clockwise | OSP-P200L/P20L programming manual (3rd ed., 2007), code table and section 15-1, p. P-331; OSP-P300 programming manual (6th/22nd ed.) G-code lists | Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the radius `L` is marked as a length in the plane. |
| [ ] | `G3` | Arc, counter-clockwise | OSP-P200L/P20L programming manual (3rd ed., 2007), code table and section 15-1, p. P-331; OSP-P300 programming manual (6th/22nd ed.) G-code lists | Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the radius `L` is marked as a length in the plane. |
| [ ] | `G20` | Home position return | OSP-P200L/P20L programming manual (3rd ed., 2007), code table and section 15-1, p. P-331; OSP-P300 programming manual (6th/22nd ed.) G-code lists | Read parameter names, order and units, what it sets in force, which words are axes, the label and hover text against your control. |
| [ ] | `G21` | Tool-change home position return | OSP-P200L/P20L programming manual (3rd ed., 2007), code table and section 15-1, p. P-331; OSP-P300 programming manual (6th/22nd ed.) G-code lists | **Open question:** Whether G21 is at rapid or not (the entry claims no motion now). Read parameter names, order and units, which words are axes, the label and hover text against your control. |
| [ ] | `G41` | Nose radius compensation, tool left | OSP-P200L/P20L programming manual (3rd ed., 2007), code table and section 15-1, p. P-331; OSP-P300 programming manual (6th/22nd ed.) G-code lists | Read what it sets in force, the label and hover text against your control. |
| [ ] | `G42` | Nose radius compensation, tool right | OSP-P200L/P20L programming manual (3rd ed., 2007), code table and section 15-1, p. P-331; OSP-P300 programming manual (6th/22nd ed.) G-code lists | Read what it sets in force, the label and hover text against your control. |
| [ ] | `G75` | Chamfer at the end of a G01 move | OSP-P200L/P20L programming manual (3rd ed., 2007), code table and section 15-1, p. P-331; OSP-P300 programming manual (6th/22nd ed.) G-code lists | Read parameter names, order and units, the label and hover text against your control. **Changed in v1.2.0:** the chamfer size `L` is marked as a length in the plane. |
| [ ] | `G76` | Corner round at the end of a G01 move | OSP-P200L/P20L programming manual (3rd ed., 2007), code table and section 15-1, p. P-331; OSP-P300 programming manual (6th/22nd ed.) G-code lists | Read parameter names, order and units, the label and hover text against your control. **Changed in v1.2.0:** the round radius `L` is marked as a length in the plane. |
| [ ] | `G85` | LAP roughing | OSP-P200L/P20L programming manual (3rd ed., 2007), code table and section 15-1, p. P-331; OSP-P300 programming manual (6th/22nd ed.) G-code lists | **Open question:** That only `M85` is allowed in the block. Read parameter names, order and units, the label and hover text against your control. |
| [ ] | `G86` | LAP copy roughing | OSP-P200L/P20L programming manual (3rd ed., 2007), code table and section 15-1, p. P-331; OSP-P300 programming manual (6th/22nd ed.) G-code lists | **Open question:** That only `M85` is allowed in the block. Read parameter names, order and units, the label and hover text against your control. |
| [ ] | `G93` | Inverse-time feed | OSP-P200L/P20L programming manual (3rd ed., 2007), code table and section 15-1, p. P-331; OSP-P300 programming manual (6th/22nd ed.) G-code lists | **Open question:** The form of `F` under G93. Read what it sets in force, the label and hover text against your control. |
| [ ] | `G119` | Compensation plane C-X-Z, for driven-tool milling on the side | OSP-P200L/P20L programming manual (3rd ed., 2007), section 6 (planes), pp. P-90 to P-95 | Read the label and hover text against your control. |
| [ ] | `G132` | Contour arc on the side with the C axis, clockwise | Okuma MACTURN and special-functions manuals (home position and turret codes; section not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the arc radius `L` is marked as a length in the plane. |
| [ ] | `G133` | Contour arc on the side with the C axis, counter-clockwise | Okuma MACTURN and special-functions manuals (home position and turret codes; section not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the arc radius `L` is marked as a length in the plane. |
| [ ] | `G313` | Turret C | Okuma MACTURN and special-functions manuals (home position and turret codes; section not recorded) | Read the label and hover text against your control. |

### Okuma: M codes (1)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `M85` | No return after LAP roughing | OSP-P200L/P20L programming manual (3rd ed., 2007), code table and section 15-1, p. P-331; OSP-P300 programming manual (6th/22nd ed.) G-code lists | **Open question:** Its use with G85/G86 (the only M code allowed in those blocks). Read the label and hover text against your control. |

### Okuma: Control flow (2)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `GOTO` | Jump to a block | OSP-P200L/P20L programming manual (3rd ed., 2007), code table and section 15-1, p. P-331; OSP-P300 programming manual (6th/22nd ed.) G-code lists | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `IF` | Conditional jump | OSP-P200L/P20L programming manual (3rd ed., 2007), code table and section 15-1, p. P-331; OSP-P300 programming manual (6th/22nd ed.) G-code lists | Read the jump or branch behaviour, the label and hover text against your control. |

## Sinumerik (turning and milling)

File `sinumerik.json`, 61 entries (54 below, 7 in [the v1.2.0 section](#added-in-the-v120-nc-fix-round)).

### Sinumerik (turning and milling): G codes (motion, path control, compensation) (11)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G2` | Arc, clockwise | Sinumerik 840D sl NC programming manual 06/2019, section 4.3 (G groups), pp. 1230-1236 | Read what it sets in force, the label and hover text against your control. |
| [ ] | `G3` | Arc, counter-clockwise | Sinumerik 840D sl NC programming manual 06/2019, section 4.3 (G groups), pp. 1230-1236 | Read what it sets in force, the label and hover text against your control. |
| [ ] | `CIP` | Arc through a point | Sinumerik 840D sl NC programming manual 06/2019, section 4.3 (G groups), pp. 1230-1236 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `G601` | Exact stop criterion: fine | Sinumerik 840D sl NC programming manual 06/2019, section 2.11, pp. 296-300 | Read the label and hover text against your control. |
| [ ] | `G602` | Exact stop criterion: coarse | Sinumerik 840D sl NC programming manual 06/2019, section 2.11, pp. 296-300 | Read the label and hover text against your control. |
| [ ] | `G603` | Exact stop criterion: end of interpolation | Sinumerik 840D sl NC programming manual 06/2019, section 2.11, pp. 296-300 | Read the label and hover text against your control. |
| [ ] | `G643` | Continuous path, rounded by tolerance within the block | Sinumerik 840D sl NC programming manual 06/2019, section 2.11, pp. 296-300 | Read the label and hover text against your control. |
| [ ] | `G644` | Continuous path, rounded with the most dynamics | Sinumerik 840D sl NC programming manual 06/2019, section 2.11, pp. 296-300 | Read the label and hover text against your control. |
| [ ] | `G645` | Continuous path, rounded on tangential corners too | Sinumerik 840D sl NC programming manual 06/2019, section 2.11, pp. 296-300 | Read the label and hover text against your control. |
| [ ] | `G41` | Radius compensation, tool left | Sinumerik 840D sl NC programming manual 06/2019, section 4.3 (G groups), pp. 1230-1236 | Read what it sets in force, the label and hover text against your control. |
| [ ] | `G42` | Radius compensation, tool right | Sinumerik 840D sl NC programming manual 06/2019, section 4.3 (G groups), pp. 1230-1236 | Read what it sets in force, the label and hover text against your control. |

### Sinumerik (turning and milling): Cycles (11)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `CYCLE61` | Face milling cycle | Sinumerik cycles programming manual 01/2008 (section for this cycle not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the corner lengths `_LENG`, `_WID` are marked as lengths in the plane. |
| [ ] | `POCKET3` | Rectangular pocket milling cycle | Sinumerik cycles programming manual 01/2008, section 3.9 | **Open question:** Whether `_ZFS` is a tool-axis position. Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the pocket length and width, corner radius, the pocket made before and the chamfer width `_FS` are marked as lengths in the plane. **Open question:** that the chamfer width `_FS` counts as a size of the part (it is a size in the plane under a multiply). |
| [ ] | `POCKET4` | Circular pocket milling cycle | Sinumerik cycles programming manual 01/2008, section 3.10 | **Open question:** Whether `_ZFS` is a tool-axis position. Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the pocket radius, the pocket made before and the chamfer width `_FS` are marked as lengths in the plane. **Open question:** that `_FS` counts as a size of the part. |
| [ ] | `SLOT1` | Slot milling cycle | Sinumerik cycles programming manual 01/2008, section 3.5 | **Open question:** Whether `_ZFS` is a tool-axis position. Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the slot length and width, `RAD` and the chamfer width `_FS` are marked as lengths in the plane. **Open question:** that `_FS` counts as a size of the part. |
| [ ] | `SLOT2` | Circular slot milling cycle | Sinumerik cycles programming manual 01/2008 (section for this cycle not recorded) | **Open question:** Which feed current it uses between the slots now that `_FFCP` is reserved. Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the slot width, the circle radius and the chamfer width `_FS` are marked as lengths in the plane. **Open question:** that `_FS` counts as a size of the part. |
| [ ] | `CYCLE72` | Path milling cycle | Sinumerik cycles programming manual 01/2008 (section for this cycle not recorded) | **Open question:** Which retraction it makes when the hundreds digit of `_VARI` is 0 (the 01/2008 manual says `_RTP`, newer ones the reference point; the label gives both). Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the chamfer width `_FS` is marked as a length in the plane. **Open question:** that `_FS` counts as a size of the part. |
| [ ] | `CYCLE93` | Grooving cycle | Sinumerik cycles programming manual 01/2008, section 4.3 | **Open question:** That `SPD` is not called a diameter. Read parameter names, order and units, what it sets in force, the label and hover text against your control. **Changed in v1.2.0:** the groove width, depth and the radii or chamfers at the groove edge and bottom are marked as lengths in the plane. |
| [ ] | `CYCLE95` | Stock removal cycle | Sinumerik cycles programming manual 01/2008 (section for this cycle not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `CYCLE97` | Thread cutting cycle | Sinumerik cycles programming manual 01/2008, section 4.7 | Read parameter names, order and units, what it sets in force, the label and hover text against your control. |
| [ ] | `CYCLE62` | Contour call | Sinumerik cycles programming manual 01/2008 (section for this cycle not recorded) | Read what it sets in force, the label and hover text against your control. |
| [ ] | `CYCLE800` | Swivel the working plane | Sinumerik cycles programming manual 01/2008 (section for this cycle not recorded) | Read parameter names, order and units, how it shifts or frames the coordinates, the label and hover text against your control. |

### Sinumerik (turning and milling): Tolerances, frames and surface machining (9)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `CTOL` | Contour tolerance | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the label and hover text against your control. |
| [ ] | `OTOL` | Orientation tolerance | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the label and hover text against your control. |
| [ ] | `ADIS` | Rounding distance | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the label and hover text against your control. **Changed in v1.2.0:** the entry describes its own value, a smoothing distance that rotate, mirror and translate keep. |
| [ ] | `ADISPOS` | Rounding distance for rapid moves | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the label and hover text against your control. **Changed in v1.2.0:** the entry describes its own value, a smoothing distance that rotate, mirror and translate keep. |
| [ ] | `TRANS` | Programmable offset | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read how it shifts or frames the coordinates, which words are axes, the label and hover text against your control. |
| [ ] | `ATRANS` | Additive programmable offset | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read how it shifts or frames the coordinates, which words are axes, the label and hover text against your control. |
| [ ] | `COMPSURF` | Compressor on, COMPSURF | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the label and hover text against your control. |
| [ ] | `CUT3DCC` | 3D radius compensation, circumference milling with a limit surface | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the label and hover text against your control. |
| [ ] | `CUT3DCCD` | 3D radius compensation, circumference milling with a limit surface and a differential tool | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the label and hover text against your control. |

### Sinumerik (turning and milling): Channel coordination (7)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `WAITM` | Wait for a mark in other channels | Sinumerik 840D sl NC programming manual 06/2019, section 3.1.8 (channel coordination), pp. 490-493 | Read the label and hover text against your control. |
| [ ] | `WAITMC` | Wait for a mark, braking only when needed | Sinumerik 840D sl NC programming manual 06/2019, section 3.1.8 (channel coordination), pp. 490-493 | Read the label and hover text against your control. |
| [ ] | `WAITE` | Wait for the end of other channels | Sinumerik 840D sl NC programming manual 06/2019, section 3.1.8 (channel coordination), pp. 490-493 | Read the label and hover text against your control. |
| [ ] | `SETM` | Set wait marks | Sinumerik 840D sl NC programming manual 06/2019, section 3.1.8 (channel coordination), pp. 490-493 | Read the label and hover text against your control. |
| [ ] | `CLEARM` | Clear wait marks | Sinumerik 840D sl NC programming manual 06/2019, section 3.1.8 (channel coordination), pp. 490-493 | Read the label and hover text against your control. |
| [ ] | `INIT` | Select a program for a channel | Sinumerik 840D sl NC programming manual 06/2019, section 3.1.8 (channel coordination), pp. 490-493 | Read the label and hover text against your control. |
| [ ] | `START` | Start the program of other channels | Sinumerik 840D sl NC programming manual 06/2019, section 3.1.8 (channel coordination), pp. 490-493 | Read the label and hover text against your control. |

### Sinumerik (turning and milling): Control flow and program jumps (16)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `GOTOF` | Jump forward | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `GOTOB` | Jump backward | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `GOTO` | Jump | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `GOTOC` | Jump without an alarm | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `IF` | Conditional | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `ELSE` | Otherwise | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `ENDIF` | End of the conditional | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `WHILE` | Loop while the condition holds | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `ENDWHILE` | End of the while loop | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `FOR` | Counting loop | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `ENDFOR` | End of the counting loop | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `REPEAT` | Repeat loop, or a section between two labels | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `REPEATB` | Repeat one block | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `UNTIL` | Repeat until the condition holds | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `LOOP` | Endless loop | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |
| [ ] | `ENDLOOP` | End of the endless loop | Sinumerik 840D sl NC programming manual 06/2019 (section for this entry not recorded; the record lists 3.7.4, 3.13.5.3, 3.14.10 and 3.25.1) | Read the jump or branch behaviour, the label and hover text against your control. |

