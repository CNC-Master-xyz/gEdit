# Review: the arc direction and compensation side flags (P4a)

Two flags in the code databases tell translate, rotate, mirror and the path tracker which way an arc turns and on which side the tool is compensated. They are data, not behaviour of the editor you see: a mirror swaps `G2` and `G3` and `G41` and `G42` from these flags, and the extents tracker reads the arc direction from them ([plan §6.2](../phase-4-implementation.md#62-arc-direction-and-compensation-side-codesetsarcdirection-codesetscompside-p4a)). Every flagged entry carries `"review": "pending"` until you sign it off.

The 16 flagged entries are also rows of [code-data.md](code-data.md) (the groups for motion, compensation and the v1.2.0 section), where the row only says "read what it sets in force". This page asks the one question those rows do not: is the flag right? The records said these were on no page; the codes are, the flags are not called out there. The Klartext arc direction words (`DR+`, `DR-`) are in the profile, not in a code file, and are rows below because they are the same decision.

How to work through it:

1. Take the code in a program of the dialect (hover it, or read its entry in the file linked in the row).
2. Compare the flag with what your control does. **Direction** (`cw`, `ccw`): the control's own definition, seen from the positive end of the axis normal to the plane toward its negative end, in the right-handed system (`G17` from +Z, `G18` from +Y, `G19` from +X). On a lathe in `G18` the arc may look the other way round when the turret is behind the centre line; the flag records the code's meaning, not the look. **Side** (`left`, `right`): left or right of the programmed path seen along the direction of travel, for cutter and nose radius compensation alike.
3. Tick when it is right. If it is wrong, write the correct value beside the row and leave it empty.
4. When a dialect is fully ticked, a later batch removes the marks, together with the same entries on [code-data.md](code-data.md).

Not flagged on purpose: `CIP`, `CT`, `CP`, `CTP`, `C`, `CR`, `APPR`/`DEP` (Klartext and Sinumerik arc forms with no single direction word) and the Okuma `G102`/`G103`, `G132`/`G133` arcs. The tracker reads those as unresolved or as end points only.

## Fanuc mill (4)

| Done | Code | Label | Flag | What it sets in force | Source |
|---|---|---|---|---|---|
| [ ] | `G2` | Circular move, clockwise | `arcDirection: cw` | a circular move that turns clockwise (feed move on an arc, modal) | [fanuc.json line 124](../../../src/lib/data/codes/fanuc.json#L124) |
| [ ] | `G3` | Circular move, counter-clockwise | `arcDirection: ccw` | a circular move that turns counter-clockwise (feed move on an arc, modal) | [fanuc.json line 134](../../../src/lib/data/codes/fanuc.json#L134) |
| [ ] | `G41` | Cutter radius compensation, left | `compSide: left` | radius compensation switched on, tool to the left of the programmed path seen in the direction of travel | [fanuc.json line 503](../../../src/lib/data/codes/fanuc.json#L503) |
| [ ] | `G42` | Cutter radius compensation, right | `compSide: right` | radius compensation switched on, tool to the right of the programmed path seen in the direction of travel | [fanuc.json line 518](../../../src/lib/data/codes/fanuc.json#L518) |

## Fanuc lathe, system A and system B (2 and 0)

The lathe databases extend the mill's, so `G2`/`G3` come from `fanuc.json` above. System A flags its own nose radius compensation (`G41`, `G42`). System B (`fanuc-lathe-b.json`) carries no flag of its own: it extends system A and reads all four codes through it.

| Done | Code | Label | Flag | What it sets in force | Source |
|---|---|---|---|---|---|
| [ ] | `G41` | Nose radius compensation, tool left | `compSide: left` | nose radius compensation on, tool left of the programmed path in the direction of travel | [fanuc-lathe.json line 141](../../../src/lib/data/codes/fanuc-lathe.json#L141) |
| [ ] | `G42` | Nose radius compensation, tool right | `compSide: right` | nose radius compensation on, tool right of the programmed path in the direction of travel | [fanuc-lathe.json line 150](../../../src/lib/data/codes/fanuc-lathe.json#L150) |
| [ ] | `G2`, `G3` (inherited) | Circular move | `arcDirection: cw`, `ccw` | the same as on the mill: on a lathe in `G18` the arc looks the other way round from behind the centre line, the code means the same | [fanuc.json](../../../src/lib/data/codes/fanuc.json); lathe and system B both inherit |

## Heidenhain Klartext (2 codes and 2 words)

`RL` and `RR` are the codes. The arc direction of Klartext is written with the words `DR+` and `DR-` after a circle block, not with a code, so it is a profile setting: [heidenhain-klartext.json](../../../src/lib/data/profiles/heidenhain-klartext.json) line 132.

| Done | Code | Label | Flag | What it sets in force | Source |
|---|---|---|---|---|---|
| [ ] | `RL` | Radius compensation, left | `compSide: left` | radius compensation switched on, tool to the left of the programmed path seen in the direction of travel | [heidenhain.json line 476](../../../src/lib/data/codes/heidenhain.json#L476) |
| [ ] | `RR` | Radius compensation, right | `compSide: right` | radius compensation switched on, tool to the right of the programmed path seen in the direction of travel | [heidenhain.json line 484](../../../src/lib/data/codes/heidenhain.json#L484) |
| [ ] | `DR+` | Rotation direction word, counter-clockwise | `arcDirectionWords: ccw` | the circle block that carries it turns counter-clockwise | [heidenhain-klartext.json line 132](../../../src/lib/data/profiles/heidenhain-klartext.json#L132) |
| [ ] | `DR-` | Rotation direction word, clockwise | `arcDirectionWords: cw` | the circle block that carries it turns clockwise | [heidenhain-klartext.json line 132](../../../src/lib/data/profiles/heidenhain-klartext.json#L132) |

## Okuma (4)

The Okuma lathe `G2` and `G3` are read in the turning plane (`ZX`) seen from the positive end of the orthogonal axis.

| Done | Code | Label | Flag | What it sets in force | Source |
|---|---|---|---|---|---|
| [ ] | `G2` | Arc, clockwise | `arcDirection: cw` | a circular move that turns clockwise (feed move on an arc, modal) | [okuma.json line 136](../../../src/lib/data/codes/okuma.json#L136) |
| [ ] | `G3` | Arc, counter-clockwise | `arcDirection: ccw` | a circular move that turns counter-clockwise (feed move on an arc, modal) | [okuma.json line 152](../../../src/lib/data/codes/okuma.json#L152) |
| [ ] | `G41` | Nose radius compensation, tool left | `compSide: left` | radius compensation switched on, tool to the left of the programmed path seen in the direction of travel | [okuma.json line 368](../../../src/lib/data/codes/okuma.json#L368) |
| [ ] | `G42` | Nose radius compensation, tool right | `compSide: right` | radius compensation switched on, tool to the right of the programmed path seen in the direction of travel | [okuma.json line 377](../../../src/lib/data/codes/okuma.json#L377) |

## Sinumerik (4)

Turning and milling share these entries.

| Done | Code | Label | Flag | What it sets in force | Source |
|---|---|---|---|---|---|
| [ ] | `G2` | Arc, clockwise | `arcDirection: cw` | a circular move that turns clockwise (feed move on an arc, modal) | [sinumerik.json line 104](../../../src/lib/data/codes/sinumerik.json#L104) |
| [ ] | `G3` | Arc, counter-clockwise | `arcDirection: ccw` | a circular move that turns counter-clockwise (feed move on an arc, modal) | [sinumerik.json line 113](../../../src/lib/data/codes/sinumerik.json#L113) |
| [ ] | `G41` | Radius compensation, tool left | `compSide: left` | radius compensation switched on, tool to the left of the programmed path seen in the direction of travel | [sinumerik.json line 373](../../../src/lib/data/codes/sinumerik.json#L373) |
| [ ] | `G42` | Radius compensation, tool right | `compSide: right` | radius compensation switched on, tool to the right of the programmed path seen in the direction of travel | [sinumerik.json line 382](../../../src/lib/data/codes/sinumerik.json#L382) |

## Counts

| Dialect | Rows |
|---|---|
| Fanuc mill | 4 |
| Fanuc lathe, system A (and system B by inheritance) | 3 |
| Heidenhain Klartext | 4 |
| Okuma | 4 |
| Sinumerik | 4 |
| **Total** | **19** |
