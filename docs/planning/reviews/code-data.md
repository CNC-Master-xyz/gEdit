# Review: the code data filled in from the manuals

220 entries of the code databases carry `"review": "pending"`. Bug-fix round 1 filled them in from the manuals (the record is [bugfix-round-1.md](../bugfix-round-1.md#manual-sources-of-the-data), section 6 lists the manuals and pages). The app does not show the mark; removing it is the sign-off.

How to work through it:

1. Hover the code in a program of the dialect (or read its entry in the code file named above each group) and read the label and the description against your control.
2. Where a row has an **Open question**, that is what the manuals left open; answer it from your machine. Tick the row when the entry is right; if it is wrong, write what is wrong beside it and do not tick.
3. The source column is what the round recorded. The record names the manual and the pages by topic, not per entry; where the page of one entry is not recorded, the row says so.
4. When a dialect is fully ticked, a later batch removes the marks.

The record in bugfix-round-1.md section 7 counts the entries differently (10 Okuma, 24 Sinumerik, 24 Klartext, "the Fanuc entries"); these are the counts in the data today, from the `review: pending` marks of the files (151 before the v1.2.0 NC fix round, 33 added there, 23 added by P4b, and 13 that no earlier count had a row for: the three system B turning passes that the system A file also carries, and ten Sinumerik drilling and tapping cycles; their rows are below):

| Dialect | File | Entries |
|---|---|---|
| Fanuc mill | `fanuc.json` | 35 |
| Fanuc lathe (system A) | `fanuc-lathe.json` | 18 |
| Fanuc lathe, system B | `fanuc-lathe-b.json` | 4 |
| Heidenhain Klartext | `heidenhain.json` | 60 |
| Okuma | `okuma.json` | 23 |
| Sinumerik (turning and milling) | `sinumerik.json` | 80 |
| **Total** | | **220** |

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

## Added in P4b (drilling cycles, time and limits)

The P4b milestone changed the data of 41 entries. **23 entries are new to the review** (they were not marked before; 15 got their cycle, dwell or return description, 1 got a feed for its own block, 7 turning cycles got their machine type) and **18 entries that were already on this page changed**; the rows of the 18 are in the last table of this section. The 23 new rows are counted in the totals above. The three readings that the manuals leave open are questions to answer from your machine: the restart direction after `G86`, parameter 3405 bit 1 and the German text of Klartext cycle 9 (all in [machine facts](machine-facts.md)).

Also in the data, with no review mark: the flag `call` on the codes that run another program or a section and come back (Klartext `CALL LBL`, `CALL PGM`; Sinumerik `CALL`, `PCALL`, `EXTCALL`; Okuma `CALL`, `MODIN`). Expand Drilling Cycles refuses such a block while a cycle is in force, and the time estimate leaves it out. `PCALL`, `EXTCALL` and `MODIN` were added with the flag on top of the codes first named for it.

Not in the data on purpose: Klartext `203` and `CYCLE83` with `VARI=0` have no expansion description (their moves are not plain ones); Klartext `201` with `Q208=0` is read as the plunging feed `Q206`.

### Fanuc mill: added in P4b (10)

File `fanuc.json`.

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G73` | Peck drilling cycle with chip break | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), drilling canned cycles (page not recorded) | Read the description of how the cycle moves (the plain-move description the expansion and the time estimate use: the rapid to the R point, the feed to the bottom, the way out), the parameter roles and the label and hover text against your control. **Open question:** the retract between pecks is a setting of the control (the form asks for it). |
| [ ] | `G81` | Drilling cycle | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), drilling canned cycles (page not recorded) | Read the description of how the cycle moves (the plain-move description the expansion and the time estimate use: the rapid to the R point, the feed to the bottom, the way out), the parameter roles and the label and hover text against your control. |
| [ ] | `G82` | Drilling cycle with dwell at the bottom | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), drilling canned cycles (page not recorded) | Read the description of how the cycle moves (the plain-move description the expansion and the time estimate use: the rapid to the R point, the feed to the bottom, the way out), the parameter roles and the label and hover text against your control. |
| [ ] | `G83` | Deep peck drilling cycle | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), drilling canned cycles (page not recorded) | Read the description of how the cycle moves (the plain-move description the expansion and the time estimate use: the rapid to the R point, the feed to the bottom, the way out), the parameter roles and the label and hover text against your control. **Open question:** the clearance above the last depth is a setting of the control (the form asks for it). |
| [ ] | `G85` | Boring cycle, feed out | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), drilling canned cycles (page not recorded) | Read the description of how the cycle moves (the plain-move description the expansion and the time estimate use: the rapid to the R point, the feed to the bottom, the way out), the parameter roles and the label and hover text against your control. |
| [ ] | `G86` | Boring cycle, spindle stop | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), drilling canned cycles (page not recorded) | Read the description of how the cycle moves (the plain-move description the expansion and the time estimate use: the rapid to the R point, the feed to the bottom, the way out), the parameter roles and the label and hover text against your control. **Open question:** after the spindle stop at the bottom, in which direction does your control restart the spindle? The expansion writes the direction in force before the cycle (see [machine facts](machine-facts.md)). |
| [ ] | `G89` | Boring cycle with dwell, feed out | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), drilling canned cycles (page not recorded) | Read the description of how the cycle moves (the plain-move description the expansion and the time estimate use: the rapid to the R point, the feed to the bottom, the way out), the parameter roles and the label and hover text against your control. |
| [ ] | `G98` | Cycle return to the initial level | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), drilling canned cycles (page not recorded) | Read what it sets in force (the return level of the cycle that follows) and the label and hover text. The expansion refuses a cycle when neither the program nor the machine says which of `G98` and `G99` is in force. |
| [ ] | `G99` | Cycle return to the retract plane | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), drilling canned cycles (page not recorded) | As `G98`: the cycle returns to the R point. |
| [ ] | `G4` | Dwell (Fanuc mill) | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), dwell (page not recorded) | Read that `X` is seconds and `P` is in the machine's least time increments (the dwell form the time estimate and the expansion use). **Open question:** parameter 3405 bit 1 makes a dwell revolutions under feed per revolution (see [machine facts](machine-facts.md)). |

### Heidenhain Klartext: added in P4b (4)

File `heidenhain.json`.

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `CYCL DEF 9` | Dwell time | TNC 640 Klartext programming manual (10/2017) (page not recorded) | Read that the two lines `9.0` and `9.1` stop the program for the seconds of `9.1`, where defined, and that nothing calls it. **Open question:** the German text of cycle 9 (see [machine facts](machine-facts.md)). |
| [ ] | `CYCL DEF 200` | Drilling | TNC 640 cycle programming manual (10/2017), drilling cycles (page not recorded) | Read the description of how the cycle moves (the plain-move description the expansion and the time estimate use: the rapid to the R point, the feed to the bottom, the way out), the parameter roles and the label and hover text against your control. |
| [ ] | `CYCL DEF 201` | Reaming | TNC 640 cycle programming manual (10/2017), drilling cycles (page not recorded) | Read the description of how the cycle moves (the plain-move description the expansion and the time estimate use: the rapid to the R point, the feed to the bottom, the way out), the parameter roles and the label and hover text against your control. **Changed in P4b:** a retract feed `Q208` of 0 now means the plunging feed `Q206` (the manual says so for `Q208`), and a `Q206` of 0 refuses the cycle. Klartext 203 is deliberately not described (its full retract runs at `Q208`). |
| [ ] | `CYCL CALL POS` | Cycle call at a position | TNC 640 cycle programming manual (10/2017), calling a cycle (page not recorded) | Read that the block moves to the position it names and runs the cycle that was defined last there. **Changed in P4b:** the `F` of this block is the feed of the move to that position **for this block only**; the next block runs at the feed that was in force before it (the flag `blockFeed`). Check on your control that an `F` written on a `CYCL CALL POS` does not stay in force for the blocks after it. |

### Sinumerik: added in P4b (9)

File `sinumerik.json`.

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G4` | Dwell (Sinumerik) | Sinumerik 840D sl NC programming manual 06/2019 (page not recorded) | Read that `F` is seconds and `S` is spindle revolutions (`S2=` another spindle), the block stands alone, and neither is a feed or a speed. |
| [ ] | `SPOS` | Spindle to an angle | Sinumerik 840D sl NC programming manual 06/2019 (page not recorded) | Read that the spindle stops at the angle and stays in position control until `M3`, `M4` or `M5`, and that `CYCLE86` makes its oriented stop with it. |
| [ ] | `CYCLE99` | Thread turning cycle | Sinumerik cycles programming manual 01/2008 (section for this cycle not recorded) | **New to the review:** the entry is marked as a turning cycle (`machineType: lathe`), so a milling machine's cycle list and the template filter leave it out. Tick if it is a turning cycle only. |
| [ ] | `CYCLE92` | Parting-off cycle | Sinumerik cycles programming manual 01/2008 (section for this cycle not recorded) | **New to the review:** the entry is marked as a turning cycle (`machineType: lathe`), so a milling machine's cycle list and the template filter leave it out. Tick if it is a turning cycle only. |
| [ ] | `CYCLE930` | Grooving cycle | Sinumerik cycles programming manual 01/2008 (section for this cycle not recorded) | **New to the review:** the entry is marked as a turning cycle (`machineType: lathe`), so a milling machine's cycle list and the template filter leave it out. Tick if it is a turning cycle only. |
| [ ] | `CYCLE940` | Undercut cycle | Sinumerik cycles programming manual 01/2008 (section for this cycle not recorded) | **New to the review:** the entry is marked as a turning cycle (`machineType: lathe`), so a milling machine's cycle list and the template filter leave it out. Tick if it is a turning cycle only. |
| [ ] | `CYCLE951` | Stock removal cycle for a corner | Sinumerik cycles programming manual 01/2008 (section for this cycle not recorded) | **New to the review:** the entry is marked as a turning cycle (`machineType: lathe`), so a milling machine's cycle list and the template filter leave it out. Tick if it is a turning cycle only. |
| [ ] | `CYCLE952` | Contour turning and grooving cycle | Sinumerik cycles programming manual 01/2008 (section for this cycle not recorded) | **New to the review:** the entry is marked as a turning cycle (`machineType: lathe`), so a milling machine's cycle list and the template filter leave it out. Tick if it is a turning cycle only. |
| [ ] | `CYCLE98` | Thread chain cycle | Sinumerik cycles programming manual 01/2008 (section for this cycle not recorded) | **New to the review:** the entry is marked as a turning cycle (`machineType: lathe`), so a milling machine's cycle list and the template filter leave it out. Tick if it is a turning cycle only. |

### Changed in P4b, already on this page (18)

These rows are on the page already (under their dialect below). Read the change; tick again when it is right.

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `CYCLE81` | (see its row under Sinumerik, Cycles) | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | **Changed in P4b:** Gained its expansion description (the roles of the parameters). Read the level and depth arguments (`RTP`, `RFP`, `SDIS`, `DP`, `DPR`: an absolute depth `DP`, or the depth from the reference plane `DPR`), the dwell and the defaults, an empty argument is refused (*value missing*). |
| [ ] | `CYCLE82` | (see its row under Sinumerik, Cycles) | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | **Changed in P4b:** Gained its expansion description (the roles of the parameters). Read the level and depth arguments (`RTP`, `RFP`, `SDIS`, `DP`, `DPR`: an absolute depth `DP`, or the depth from the reference plane `DPR`), the dwell and the defaults, an empty argument is refused (*value missing*). |
| [ ] | `CYCLE83` | (see its row under Sinumerik, Cycles) | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | **Changed in P4b:** Gained its expansion description (the roles of the parameters). Read the level and depth arguments (`RTP`, `RFP`, `SDIS`, `DP`, `DPR`: an absolute depth `DP`, or the depth from the reference plane `DPR`), the dwell and the defaults, an empty argument is refused (*value missing*). Only `VARI=1` is described; `VARI=0` (`_VRT=0` means 1 mm) is deliberately not, so it is refused. |
| [ ] | `CYCLE85` | (see its row under Sinumerik, Cycles) | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | **Changed in P4b:** Gained its expansion description (the roles of the parameters). Read the level and depth arguments (`RTP`, `RFP`, `SDIS`, `DP`, `DPR`: an absolute depth `DP`, or the depth from the reference plane `DPR`), the dwell and the defaults, an empty argument is refused (*value missing*). |
| [ ] | `CYCLE86` | (see its row under Sinumerik, Cycles) | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | **Changed in P4b:** Gained its expansion description (the roles of the parameters). Read the level and depth arguments (`RTP`, `RFP`, `SDIS`, `DP`, `DPR`: an absolute depth `DP`, or the depth from the reference plane `DPR`), the dwell and the defaults, an empty argument is refused (*value missing*). Read the oriented stop (`SPOS`) angle argument. |
| [ ] | `CYCLE89` | (see its row under Sinumerik, Cycles) | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | **Changed in P4b:** Gained its expansion description (the roles of the parameters). Read the level and depth arguments (`RTP`, `RFP`, `SDIS`, `DP`, `DPR`: an absolute depth `DP`, or the depth from the reference plane `DPR`), the dwell and the defaults, an empty argument is refused (*value missing*). |
| [ ] | `G71` | Fanuc lathe, system A, roughing cycles | Fanuc lathe system manual (B-63944GE-1/02), section 4.2, pp. 49-89 | **Changed in P4b:** `P` and `Q` are required in the second block (the block that runs the cycle), the first block `U R` does not need them. Hover on the first block says *Required P, Q* (a known side effect), and completion inserts the second-block form. |
| [ ] | `G72` | Fanuc lathe, system A, roughing cycles | Fanuc lathe system manual (B-63944GE-1/02), section 4.2, pp. 49-89 | **Changed in P4b:** `P` and `Q` are required in the second block (the block that runs the cycle), the first block `U R` does not need them. Hover on the first block says *Required P, Q* (a known side effect), and completion inserts the second-block form. |
| [ ] | `G73` | Fanuc lathe, system A, roughing cycles | Fanuc lathe system manual (B-63944GE-1/02), section 4.2, pp. 49-89 | **Changed in P4b:** `P` and `Q` are required in the second block (the block that runs the cycle), the first block `U R` does not need them. Hover on the first block says *Required P, Q* (a known side effect), and completion inserts the second-block form. |
| [ ] | `CYCLE61` | Face milling cycle | (see its row under Sinumerik, Cycles) | **Changed in P4b, taken back in v1.2.0** (owner, 2026-10-22): P4b marked it as a milling cycle (`machineType: mill`), which hid it from a turning program. It has no machine type again, so the cycle form offers it on the Sinumerik turning profile too (a lathe with driven tools runs it). Nothing to read beyond the old row. |
| [ ] | `POCKET3` | Rectangular pocket milling cycle | (see its row under Sinumerik, Cycles) | **Changed in P4b, taken back in v1.2.0** (owner, 2026-10-22): P4b marked it as a milling cycle (`machineType: mill`), which hid it from a turning program. It has no machine type again, so the cycle form offers it on the Sinumerik turning profile too (a lathe with driven tools runs it). Nothing to read beyond the old row. |
| [ ] | `POCKET4` | Circular pocket milling cycle | (see its row under Sinumerik, Cycles) | **Changed in P4b, taken back in v1.2.0** (owner, 2026-10-22): P4b marked it as a milling cycle (`machineType: mill`), which hid it from a turning program. It has no machine type again, so the cycle form offers it on the Sinumerik turning profile too (a lathe with driven tools runs it). Nothing to read beyond the old row. |
| [ ] | `SLOT1` | Slot milling cycle | (see its row under Sinumerik, Cycles) | **Changed in P4b, taken back in v1.2.0** (owner, 2026-10-22): P4b marked it as a milling cycle (`machineType: mill`), which hid it from a turning program. It has no machine type again, so the cycle form offers it on the Sinumerik turning profile too (a lathe with driven tools runs it). Nothing to read beyond the old row. |
| [ ] | `SLOT2` | Circular slot milling cycle | (see its row under Sinumerik, Cycles) | **Changed in P4b, taken back in v1.2.0** (owner, 2026-10-22): P4b marked it as a milling cycle (`machineType: mill`), which hid it from a turning program. It has no machine type again, so the cycle form offers it on the Sinumerik turning profile too (a lathe with driven tools runs it). Nothing to read beyond the old row. |
| [ ] | `CYCLE72` | Path milling cycle | (see its row under Sinumerik, Cycles) | **Changed in P4b, taken back in v1.2.0** (owner, 2026-10-22): P4b marked it as a milling cycle (`machineType: mill`), which hid it from a turning program. It has no machine type again, so the cycle form offers it on the Sinumerik turning profile too (a lathe with driven tools runs it). Nothing to read beyond the old row. |
| [ ] | `CYCLE93` | Grooving cycle | (see its row under Sinumerik, Cycles) | **Changed in P4b:** marked as a turning cycle (`machineType: lathe`). |
| [ ] | `CYCLE95` | Stock removal cycle | (see its row under Sinumerik, Cycles) | **Changed in P4b:** marked as a turning cycle (`machineType: lathe`). |
| [ ] | `CYCLE97` | Thread cutting cycle | (see its row under Sinumerik, Cycles) | **Changed in P4b:** marked as a turning cycle (`machineType: lathe`). |

### Changed in P4b fix batch 5, no review mark (2)

These two Sinumerik entries carry no `review` mark and are not in the counts above. They are here because the fix batch changed what they set in force: both are now rapid moves, so a block that carries one is not given a motion code back by a script (a block that moves on its own).

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [x] | `G74` | Reference point approach | Source not recorded on this page (set by the data, answered by the owner) | **Answered by the owner, 2026-10-22:** `G74` is a rapid move to the reference points of the axes written with it (the values say which axes). Nothing more to read. |
| [ ] | `G75` | Approach a fixed machine point | Source not recorded on this page (the manual fact is in the entry's description) | Read that the axes written with it move at rapid traverse, each on its own, to the fixed point `FP=` names, in machine coordinates, and that the values of the axis words are not positions. The manual states the rapid traverse. |

## Fanuc mill

File `fanuc.json`, 35 entries (24 below, 1 in [the v1.2.0 section](#added-in-the-v120-nc-fix-round), 10 in [the P4b section](#added-in-p4b-drilling-cycles-time-and-limits)).

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

File `fanuc-lathe.json`, 18 entries (15 below, 3 in [the v1.2.0 section](#added-in-the-v120-nc-fix-round)).

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

### Fanuc lathe (system A): system B turning passes in the system A file (3)

These three are in the data of the system A file as well as in the system B file (their rows are under [Fanuc lathe, system B](#fanuc-lathe-system-b)). The earlier counts did not have a row for the system A copies.

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G77` | Turning pass (G-code system B) | Fanuc lathe system manual (B-63944GE-1/02) (section for this entry not recorded) | Read that system A does not use this number, that it is read as the system B turning pass here too (the taper `R` along X, X, Z and R in force), and that the hover text tells the reader to set a machine with that G-code system. |
| [ ] | `G78` | Threading pass (G-code system B) | Fanuc lathe system manual (B-63944GE-1/02) (section for this entry not recorded) | As `G77`, for the threading pass (the `F` is the lead per revolution, the taper `R` along X). |
| [ ] | `G79` | Facing pass (G-code system B) | Fanuc lathe system manual (B-63944GE-1/02) (section for this entry not recorded) | As `G77`, for the facing pass (the taper `R` along Z). |

## Fanuc lathe, system B

File `fanuc-lathe-b.json`, 4 entries (1 below, 3 in [the v1.2.0 section](#added-in-the-v120-nc-fix-round)).

### Fanuc lathe, system B: Motion, reference positions and coordinate system (1)

| Done | Code | Label | Source | What to check |
|---|---|---|---|---|
| [ ] | `G92.1` | Work coordinate system preset | Fanuc 30i/31i/32i Model A user's manual (B-63944GE/02), code tables 3.1(a) and 3.2(a), pp. 40-46 (section for this entry not recorded) | Read how it shifts or frames the coordinates, which words are axes, the label and hover text against your control. |

## Heidenhain Klartext

File `heidenhain.json`, 60 entries (42 below, 14 in [the v1.2.0 section](#added-in-the-v120-nc-fix-round), 4 in [the P4b section](#added-in-p4b-drilling-cycles-time-and-limits)).

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

File `sinumerik.json`, 80 entries (64 below, 7 in [the v1.2.0 section](#added-in-the-v120-nc-fix-round), 9 in [the P4b section](#added-in-p4b-drilling-cycles-time-and-limits)).

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

### Sinumerik (turning and milling): Cycles (21)

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
| [ ] | `CYCLE81` | Drilling or centring cycle | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. Read the level and depth arguments (`RTP`, `RFP`, `SDIS`, `DP`, `DPR`) and the expansion description added in P4b. |
| [ ] | `CYCLE82` | Drilling cycle with a dwell | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. Read the dwell `DTB` and the expansion description added in P4b. |
| [ ] | `CYCLE83` | Deep-hole drilling cycle | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. Only `VARI=1` has an expansion description added in P4b; `VARI=0` is refused on purpose. |
| [ ] | `CYCLE84` | Rigid tapping cycle | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. Read that the lead comes from `MPIT` or `PIT` and the tapping speed from `SST`, not from the feed in force, the pitch unit `_PITA`, and the label and hover text. |
| [ ] | `CYCLE840` | Tapping cycle with a compensating chuck | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. Read `ENC`: with 1 the lead is the feed in force (speed times pitch, never scaled), with 0, 11 or 20 it comes from `MPIT` or `PIT`. |
| [ ] | `CYCLE85` | Reaming cycle, feed in and feed out | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. Read the expansion description added in P4b. |
| [ ] | `CYCLE86` | Boring cycle with an oriented stop | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. Read the oriented stop (`SPOS`) angle and the expansion description added in P4b. |
| [ ] | `CYCLE87` | Boring cycle with a stop at depth | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. Read that it stops the spindle without orienting it and stops the program, and that the next NC start pulls the tool out to the retraction plane at rapid. |
| [ ] | `CYCLE88` | Boring cycle with a dwell and a stop at depth | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. As `CYCLE87`, with the dwell `DTB` at depth. |
| [ ] | `CYCLE89` | Boring cycle with a dwell, feed out | Sinumerik cycles programming manual 01/2008, drilling cycles (page not recorded) | Read parameter names, order and units, what it sets in force, the label and hover text against your control. Read the dwell `DTB` and the expansion description added in P4b. |

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

