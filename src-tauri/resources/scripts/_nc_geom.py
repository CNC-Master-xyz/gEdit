"""The transform rules: what each word of a block is to a geometry transform, and how it moves
(Phase 4 plan §6.1, AD-41 to AD-44).

Written as a stub by the P4a prelude (the vocabulary below: the roles, the operations, the
refusal reasons with their plain texts, the warnings, the tolerances; final and binding) and
implemented by P4.2 (the rules at the end). ``tests/python/test_nc_geom.py`` holds its cases.
The three scripts ``translate.py``, ``rotate.py`` and ``mirror.py`` (P4.3, P4.4) walk the
program with ``_nc_path.PathTracker`` and ask this module what to do with every word.

**How a script calls it (P4.2).** One tracker line, then, for that step and before the next
line: :func:`roles_of`, :func:`refusals_of` and :func:`notes_of`, then :func:`read_word`,
:func:`transform` and :func:`write_word` for each word the run changes. The functions that
take the tracker read its modal state (``tracker.interp``: the plane, the distance mode, the
motion code and the cycle in force, the diameter mode, a frame, tool centre point control) as
it stands **after the step's line**, which is the state that line runs in; asked later, they
would read the state of a later line. The run writes nothing until every block is judged
(Q1), so computing each block's new text right away and keeping it until the end is how the
all-or-nothing rule and this order go together. What they read of the tracker is only
``profile``, ``cp``, ``codes``, ``interp`` and of the step ``line``, ``tokens``, ``entries``,
``unknown_codes``, ``calls``, ``reads``, ``before``, ``pole``, ``cycle`` and ``units``.

Settled defaults (the owner's answers of 2026-10-12, plan §9)
--------------------------------------------------------------

* **Q4-1, all or nothing.** A run that meets one refused block writes **nothing** and lists
  **every** refused block with its line and its reason, so the user sees all of them at once.
  The script hands the input back unchanged (an envelope whose ``text`` is the input, so the
  app makes no edit and no undo step) with one finding per refused block. Address arithmetic
  changes what it can judge; a path moved except for one block is a broken path.
* **Q4-2, the lathe.** On a lathe: translate (``X`` as the machine reads it, diameter or
  radius, and ``Z``) and a **Z mirror for the counter spindle**: ``Z' = 2·Z0 − Z`` about the
  ``Z0`` the user gives (default 0), an incremental ``Z`` and ``W`` change sign, the arc
  centre word along Z (``K``) changes sign, ``X``, ``U`` and ``I`` stay, and ``G2``↔``G3`` and
  ``G41``↔``G42`` swap **from data** (``CodeSets.arcDirection``, ``CodeSets.compSide``, plan
  §6.2). No rotation on a lathe (``lathe-rotate``) and no X mirror (``lathe-x-mirror``). The
  result carries the warning ``tool-nose`` (the tool nose direction is in each tool's offset,
  not in the program).
* **Q4-3, planes.** On a mill, rotate and mirror work in the XY plane only (``plane``). The
  lathe Z mirror is the one exception: it works in the ZX plane (``G18``) only.
* **Q4-4, rounding and the arc tolerance.** Translate, a mirror about a line parallel to an
  axis through a decimal point, a rotation by a multiple of 90° and the lathe Z mirror are
  **exact** (decimal arithmetic, :func:`is_exact`): no word is rounded, and a result that does
  not fit the word's own form refuses the run (``resolution``). Any other rotation or mirror
  line computes in double precision and rounds each word half away from zero: a word with a
  point keeps its own decimals and gets at least :data:`MIN_DECIMALS` (3 in mm, 4 in inch); a
  point-less word stays a whole number of the machine's increments. Every rounded word is
  counted. After rounding, every arc is checked (:func:`check_arcs`): the distance from the
  centre to the start and to the end may differ by at most :data:`ARC_TOLERANCE` (0.002 mm,
  0.0001 in), and a radius arc's chord may exceed its diameter by no more; otherwise the run
  is refused at that arc (``arc-check``).
* **Q4-5, the distance mode.** The mode at the first moved block comes from the program
  (``G90``/``G91`` or the dialect's form) or from the machine's power-on mode
  (``modalInitial``). A mode only **assumed** from the profile's default refuses the run
  (``distance-assumed``).
* **Q4-6, returns and machine positions.** ``G53``, ``M91``, ``SUPA`` and an incremental
  ``G28``/``G30`` return (``G91 G28 Z0``: an intermediate point the transform does not move)
  are left and listed as information (``machine-position``). An **absolute** intermediate
  point that the transform would change refuses the run (``intermediate-point``).

The contract (binding, plan §6.1)
---------------------------------

1. **Roles come from data, never from a code list** (P2 §8.8): the profile (axes, twins,
   ``arcCenter``/``arcCenterMode``, ``diameter``, ``angular``, ``feed``, ``spindle``, ``tool``,
   ``rapid``, ``feedUnitWords``, ``speedLimitWords``, ``arcDirectionWords``), the database
   (the codes of the block and in force: ``sets``, ``axisWords``, ``wordsAreData``,
   ``frame``, ``shift``, ``call``, ``pole``, ``CodeParam.position``/``.axis``/``.unit``,
   ``pitchFeed``, ``tapping``, ``contour``), the modal state (plane, distance, the cycle in
   force, ``tcp``, frames) and the tracker's reading of each axis word (``_nc_path.WordRead``).
   The geometry vocabulary of ``_nc_path`` (``RADIUS_WORDS``, ``POLAR_*``, ``TURNS_WORD``,
   ``ANGLE_WORD``, ``VALUE_FUNCTIONS``, ``UNRESOLVED_ARCS``) is the only list of names.
2. :func:`roles_of` gives every word of a block one role of :data:`ROLES`; a word no source
   describes is ``'unknown'``. Under rotate and mirror an ``'unknown'`` word in a block the
   run changes refuses it (``word-unknown``: it may be an angle or a direction nobody
   described, the Fanuc lathe's ``A`` of a drawing-dimension block, Sinumerik ``AP=``/``RP=``);
   under translate a plain-letter ``'unknown'`` word is left and listed as information, and
   an ``'unknown'`` **assignment** word (``NAME=…``) refuses, because a named value the data
   does not describe may be a position.
3. :func:`transform` moves one value of one role under one operation (:data:`OPS`) and says
   whether the result is exact. Coordinates are **geometric** (a diameter word is halved by
   the caller first, through ``_nc_path.PathAxes.geo`` and the word's reading, and doubled
   again on the way back); the X shift of a lathe translate is given as the form asked it
   (:class:`Translate`, ``x_reading``) and turned into each word's own reading.
4. :func:`swap_partner` finds the code a mirror writes instead of a flagged one: the entry
   of the **same group** whose flag has the **other** value (``cw``↔``ccw``,
   ``left``↔``right``); exactly one such entry, or the block is refused (``swap-unknown``).
   The Klartext direction word swaps the same way through ``addresses.arcDirectionWords``
   (``DR+``↔``DR-``). A code with ``path: 'arc'`` but no ``arcDirection`` (``CIP``, ``CT``,
   Okuma ``G102``/``G103``, ``G132``/``G133``) and a code with ``radiusComp: 'on'`` but no
   ``compSide`` (Fanuc ``G41.2``–``G42.6``, ``G41.3``) cannot be mirrored.
5. :func:`write_word` writes a new value back **in the word's own form**, through
   ``gedit_nc.write_back`` (``_nc_machine.py``): a point stays a point, a point-less word
   stays a whole number of increments (or of units), the address, a value function
   (``AC(…)``/``IC(…)``), a leading zero style (``Z-.5``), Klartext's ``+`` (the profile's
   ``numberFormat.plusSign``) and decimal comma (``Q203=+0,5``) are kept. With no machine
   chosen, a word whose result the profile's presets would write differently refuses the run
   (``machine-dependent``), as address arithmetic leaves it (D57); ``address_arithmetic.py``
   is the precedent for this path (its ``as_written_everywhere`` and ``write_back``), and P4.2
   may lift those helpers here (the TODO's duplicated-code debt names it).
6. A **cycle moves in one piece** (address arithmetic's groups): a cycle and every block that
   runs it, a definition and its calls, the pole and every move around it. A selection that
   starts or ends inside one refuses the run (``selection-inside``). The axis words of a
   call that runs the cycle **at** them (Klartext ``CYCL CALL POS X… Y… Z…``: parameters named
   after an axis of the profile, ``position: 'other'``) are that cycle's position
   (``cycle-position`` role) and move like points; any other ``'other'`` parameter (a pattern
   centre ``Q216``, ``_CPA``, a ``PATTERN DEF``) or one with no role refuses the cycle
   (``cycle-position``, ``cycle-not-reviewed``). A ``'tool-axis'`` parameter moves with a
   translate of the tool axis and stays under the XY transforms and the lathe Z mirror refuses
   the cycle anyway (``lathe-cycle``). v1.2.0 (NCR-9b): a cycle written as a call with such a
   parameter left empty or left out (read as 0) refuses a translate of the tool axis
   (``cycle-level-empty``), unless its ``CodeParam.twin`` is written.
7. **The lathe Z mirror and cycles** (the prelude's case list, plan §5 P4a, all from data,
   first reason that applies): ``thread`` — the motion code in force or the cycle run has
   ``pitchFeed`` or ``tapping`` (``G32``/``G33``, ``G76``, system A ``G92``, system B ``G78``,
   Okuma ``G31``–``G37``, ``G71``, ``G72``, ``G112``/``G113``, Sinumerik ``G33``–``G35``,
   ``G331``/``G332``); ``roughing-cycle`` — a ``'start'`` cycle whose axis words are data (the
   Fanuc lathe ``G71``–``G73``), or a code of a group that holds a ``contour`` code (the Okuma
   LAP: ``G85``–``G88`` and the shape codes ``G81``–``G83``, ``G80``); ``lathe-cycle`` — any
   other entry with ``sets.cycle`` (Fanuc ``G70``, ``G74``, ``G75``, ``G83``–``G89``; Okuma
   ``G73``, ``G74``, ``G181``–``G189``; Sinumerik ``CYCLE92``–``CYCLE99``, ``CYCLE930``,
   ``CYCLE940``–``CYCLE952`` and the drilling cycles); ``single-pass-taper`` — a block of a
   ``path: 'cycle'`` code (system A ``G90``, ``G94``; B ``G77``, ``G79``) that writes ``R``.
   The threading passes (system A ``G92``, B ``G78``) are ``path: 'cycle'`` too since v1.2.0
   (NCF-C); a block of them is refused as a ``thread`` alone, its taper is part of the thread.
   A single pass without a taper is points and is mirrored. v1.2.0 (NCR-2): ``R0`` is no taper,
   and a pass whose taper lies along Z (``G94``, ``G79``) is refused while a taper written above
   it is in force and not 0, or not known (``PathTracker.pass_taper``). Diameter programming (Sinumerik
   ``DIAMON``, ``DIAMOF``, ``DIAM90``) refuses nothing: the Z mirror reads no X.
8. The **whole run** is judged before anything is written: every refused block is a finding
   (``severity: 'error'``, ``reason`` one id of :data:`REASONS`, ``message`` the block as
   written, ``": "``, the text and a full stop), the information rows (:data:`INFO`,
   ``severity: 'info'``) and the warnings (:data:`WARNINGS`, ``severity: 'warning'``, the
   text with a capital and a full stop) are added, and only a run with no refusal writes its
   text. A partner code is written in the style of the code it replaces (``G02`` → ``G03``).

P4a fix batch B1 (the P4a reviews; plan §7 #311-#323)
--------------------------------------------------------

9. **What the straight walk does not see** (NC-5, NC-9, NC-11), from the tracker's
   :attr:`_nc_path.Step.unsure`, ``unwritten`` and ``flow``: a jump target, a loop end or a
   skippable block reached with another modal state refuses (``jump``); a rotation or a mirror
   that reads a start the flow leaves unsure refuses (``position-unknown``, ``pole-unknown``),
   and so does the end of a loop or a backward jump whose blocks need a start that differs on
   their next run; a rotary axis a frame code turned refuses a block that changes the path
   (``rotary-word``, ``rotary-turned``); a feed cut or a cycle while an axis the operation
   changes has never been written refuses (``axis-unwritten``, ``position-unknown``).
10. **From data**: a pocket, slot or stud with an angle or a corner of its own
    (``CodeParam.inPlane``) refuses rotate and mirror (``cycle-angle``); a value whose sign is
    the direction of the next move (``CodeParam.signOf``) refuses the lathe Z mirror
    (``chamfer-sign``); the workpiece blank (``CodeEntry.blank``) is left as written with one
    information row (``blank``, owner decision Q-D); an offset word of the profile
    (``addresses.offsetWords``) is untouched; a block that starts with a keyword the database
    does not know is an ``unknown-code``; an assignment to a system variable (the profile's
    ``systemVariables`` or ``systemVariableNumbers``) is a ``coordinate-shift``; a move around
    a pole set before the scope refuses every operation (``pole-unknown``).
11. **The lathe Z mirror turns Y round too** (owner decision Q-B): ``Y' = −Y``, about the
    turning axis, and an incremental Y and ``J`` change sign (:data:`LATHE_MIRROR_AXES`); on a
    machine whose "Counter spindle" setting says Y stays (D5-7, ``LatheZMirror.y_turns``) they
    are left as written.
12. **What a long program asks again and again is worked out once for the kind of word** (B6, CODE-1; no
    output changes): the value of a written ``1`` and whether the profile's presets write a result
    alike (``_Data.unit_of``, ``_Data.writes_alike``), whether a word with a point is read as
    written, so ``write_word`` is the format and a read back without asking the machine again
    (``_Data.reads_as_written``), and the literals' values, shared with the tracker of the same
    context (``_nc_path.Readings``). A block works out its ``written`` text, the modal codes in
    force and its readings when they are first asked for. Every answer is the one the straight
    reading gives (``tests/python/test_nc_geom.py``, ``FastWriteTest``).

Standard library only, Python 3.9 and newer. A bundled script imports this module by name
(``import _nc_geom``); it imports ``gedit_nc`` and ``_nc_path`` (plan §7 #292).
"""

from __future__ import annotations

import bisect
import math
import re
from array import array
from decimal import Decimal, localcontext
from typing import Any, Dict, FrozenSet, List, NamedTuple, Optional, Sequence, Set, Tuple, Union

import gedit_nc
import _nc_path


# ---------------------------------------------------------------------------
# Tolerances and rounding (Q4-4)
# ---------------------------------------------------------------------------

#: The most the distance from an arc's centre to its start and to its end may differ after
#: rounding (and the most a radius arc's chord may exceed its diameter), by program units.
ARC_TOLERANCE = {"mm": Decimal("0.002"), "inch": Decimal("0.0001")}
#: The fewest decimals a word **with a point** is written with when a rounding operation
#: changes it; a word written with more keeps its own.
MIN_DECIMALS = {"mm": 3, "inch": 4}

# ---------------------------------------------------------------------------
# The roles of AD-41
# ---------------------------------------------------------------------------

#: Role -> what it is. Every word of a block gets exactly one.
ROLES = {
    "point": "an absolute coordinate of an axis (X10., Klartext X+10, Z=AC(3), an absolute arc end point)",
    "point-inc": "an incremental distance along an axis (G91 X5., the twins U and W, Klartext IX, X=IC(2))",
    "centre": "an absolute coordinate of an arc centre (I=AC(…), I/J/K under arcCenterMode 'absolute', the CIP point I1=, J1=, K1=)",
    "centre-inc": "a component of the vector from the arc start to its centre (I, J, K under arcCenterMode 'incremental')",
    "radius": "an arc radius, its sign choosing the arc over 180 degrees or the side of an approach (R, CR=, Klartext CR … R, APPR CT R, Okuma L)",
    "arc-angle": "an arc's opening angle, 0 to 360, unsigned (Sinumerik AR=); the direction is the code's",
    "turns": "the extra full turns of a helix (Sinumerik TURN=)",
    "direction": "a word that gives an arc its direction (Klartext DR+, DR-; addresses.arcDirectionWords)",
    "polar-radius": "the polar radius about the pole (Klartext PR)",
    "polar-radius-inc": "an incremental polar radius (Klartext IPR)",
    "polar-angle": "the polar angle about the pole, from the plane's first axis (Klartext PA)",
    "polar-angle-inc": "an incremental polar angle, signed like the arc direction (Klartext IPA)",
    "pole": "an absolute coordinate of the pole (Klartext CC X, CC Y; pole: 'set')",
    "pole-inc": "an incremental pole coordinate (Klartext CC IX, IY)",
    "cycle-position": "an axis word of a block that positions or calls a cycle (X Y under G81, CYCL CALL POS X Y Z)",
    "tool-axis": "a cycle parameter that is an absolute coordinate on the tool axis (CodeParam.position 'tool-axis': R of G81 under G90, Q203, RTP, RFP, DP)",
    "length": "a length that keeps its value under every transform (LEN, a chamfer CHF, a rounding RND, a peck depth Q, Klartext CCA as an unsigned angle of an approach arc)",
    "data": "a value of a data code, not a position (G4 X, the words of G10, G52, G92 as data)",
    "code-arc": "a motion code with an arc direction (CodeSets.arcDirection: G2, G3); a mirror swaps it",
    "code-comp": "a radius-compensation code with a side (CodeSets.compSide: G41, G42, RL, RR); a mirror swaps it",
    "untouched": "a word no transform changes (a feed, a speed, a tool, an M code, a block number, a dwell, a count, an offset number)",
    "unknown": "a word no profile member, database entry or modal state describes",
}

# ---------------------------------------------------------------------------
# The operations
# ---------------------------------------------------------------------------


class Translate(NamedTuple):
    """Shift every absolute position by ``shift`` (axis -> distance, program units).

    ``x_reading`` is how the form's X shift is meant on a profile with diameter words
    (``'diameter'`` or ``'radius'``, as the document's machine reads ``X``; ``None`` on a mill,
    where X is a coordinate). A word read as the other one moves by twice or half of it
    (exact). Incremental words, incremental centres, radii and polar radii and angles stay.
    """

    shift: Dict[str, Decimal]
    x_reading: Optional[str] = None


class Rotate(NamedTuple):
    """Turn the path in the XY plane about ``centre`` by ``degrees``, counter-clockwise positive
    as the controls count it. Points, centres, the pole and incremental vectors turn; a polar
    angle ``PA`` turns by the angle, ``IPA`` stays; ``G2``/``G3`` stay."""

    centre: Tuple[Decimal, Decimal]
    degrees: Decimal


class Mirror(NamedTuple):
    """Reflect the path in the XY plane about the line through ``point`` at ``degrees`` from
    the X axis (0: the line is parallel to X, so Y flips; 90: parallel to Y, so X flips).
    Points, centres and the pole reflect; incremental vectors reflect; ``PA`` becomes
    ``2·degrees − PA``, ``IPA`` changes sign; arc directions and compensation sides swap."""

    point: Tuple[Decimal, Decimal]
    degrees: Decimal


class LatheZMirror(NamedTuple):
    """The counter-spindle mirror of Q4-2: ``Z' = 2·z0 − Z`` in the ZX plane (``G18``); an
    incremental Z, ``W`` and ``K`` change sign; ``X``, ``U``, ``I`` stay; arc directions and
    compensation sides swap.

    The owner's decision Q-B of 2026-10-16 (NC-14, plan §7 #321): a **Y** word changes sign
    too, ``Y' = −Y``, an incremental Y and the centre word ``J`` as well. The reflection point
    of Y is 0, not a value of the form: Y is measured from the turning axis, which the main
    and the counter spindle share (both spindles' coordinate systems have X = 0, Y = 0 on that
    axis), while their Z zeros lie apart, which is what ``z0`` places. With X kept and Z and Y
    turned round, the counter spindle's system is the main spindle's turned half a turn about
    X.

    Review round (D5-7): the machine setting "Counter spindle" (variant ``counterSpindleY``)
    keeps Q-B as its default; its other choice, ``stays``, is a machine whose Y does not turn
    with Z (``y_turns`` false): Y, an incremental Y and ``J`` are left as written."""

    z0: Decimal = Decimal(0)
    y_turns: bool = True


#: The axes the lathe Z mirror changes the sign of (Q4-2, and Y by Q-B): an absolute Z about
#: ``z0``, an absolute Y about 0, every increment and centre component along them.
LATHE_MIRROR_AXES = ("Z", "Y")


def lathe_mirror_axes(op: "LatheZMirror") -> Tuple[str, ...]:
    """The axes ``op`` changes: :data:`LATHE_MIRROR_AXES`, or Z alone on a machine whose Y stays
    (D5-7)."""
    return LATHE_MIRROR_AXES if op.y_turns else ("Z",)


#: D5-7: the machine setting that says whether Y turns with Z under the counter-spindle mirror,
#: and the choice that keeps Y (any other value, or none, is the default Q-B).
COUNTER_SPINDLE_VARIANT = "counterSpindleY"
COUNTER_SPINDLE_Y_STAYS = "stays"


def counter_spindle_y_turns(context: Dict[str, Any]) -> bool:
    """Whether the document's machine turns Y with Z under the lathe Z mirror (D5-7): true
    unless its ``counterSpindleY`` choice is ``stays``."""
    variants = _dict(_dict(gedit_nc.machine_params(context).get("params")).get("variants"))
    return variants.get(COUNTER_SPINDLE_VARIANT) != COUNTER_SPINDLE_Y_STAYS

Op = Union[Translate, Rotate, Mirror, LatheZMirror]
#: The operations by the name a script and a finding use.
OPS = {"translate": Translate, "rotate": Rotate, "mirror": Mirror, "lathe-z-mirror": LatheZMirror}

# ---------------------------------------------------------------------------
# What a classification and a refusal look like (final)
# ---------------------------------------------------------------------------


class WordRole(NamedTuple):
    """One word of a block and its role."""

    token: Any  #: the ``gedit_nc.Token``
    role: str  #: one of :data:`ROLES`
    axis: Optional[str]  #: the axis a point, vector, centre or pole component belongs to (``I`` → ``X``)
    number_class: Optional[str]  #: ``gedit_nc.number_class_of`` of the word in this block
    entry: Optional[Dict[str, Any]] = None  #: the code entry a code or a cycle parameter belongs to


class Refusal(NamedTuple):
    """One refused block: its line, the reason id of :data:`REASONS`, and what it names."""

    line: int
    reason: str
    written: str  #: the block, the code or the word as written (``G68 X0 Y0 R30.``)
    detail: str = ""  #: what the plain text needs besides (``line 12``, ``G76``)


class Written(NamedTuple):
    """One word written back by :func:`write_word`."""

    text: str  #: the whole word as it goes into the line (address and value function kept)
    rounded: bool


# ---------------------------------------------------------------------------
# The refusal reasons of X22 (stable ids; plain texts; final)
# ---------------------------------------------------------------------------
#
# Id -> (the operations it applies to, the plain text after "<as written>: "). A finding is
# `{ "line", "severity": "error", "message": "<as written>: <text>", "reason": <id> }`; the
# goldens pin the messages. The texts are for NC programmers: they say what is in the way
# and, where there is one, what to do.

ALL_OPS = ("translate", "rotate", "mirror", "lathe-z-mirror")
TURNING = ("rotate", "mirror", "lathe-z-mirror")

REASONS = {
    # -- frames, shifts, settings ------------------------------------------------------
    "frame": (
        ALL_OPS,
        "a coordinate rotation, mirror, scaling, polar command or tilted plane is in force here; "
        "gEdit cannot tell where these positions are. Move the path without it, or cancel it first",
    ),
    "coordinate-shift": (
        ALL_OPS,
        "this sets or shifts the coordinate system or writes offsets (a local shift, a coordinate "
        "set, a data setting that changes offsets); gEdit does not move the values it sets, so the "
        "positions after it would no longer match the moved path",
    ),
    "intermediate-point": (
        ALL_OPS,
        "the return to the reference point goes through this absolute intermediate point, "
        "which the transform would move; write it as an incremental zero return or check it by hand",
    ),
    # -- the program -------------------------------------------------------------------
    "call": (
        ALL_OPS,
        "a subprogram or macro call: the called program's positions are not in this document, "
        "so it cannot be moved with the rest",
    ),
    "jump": (
        ALL_OPS,
        "a jump, a loop or a block that may be skipped reaches this block with another "
        "distance mode, plane, unit, frame or cycle than the program written above it has, "
        "or jumps to a block gEdit cannot find; gEdit cannot tell which one is in force",
    ),
    "expression": (
        ALL_OPS,
        "a variable or a calculation in a word the transform has to change; gEdit only "
        "changes written numbers",
    ),
    "machine-dependent": (
        ALL_OPS,
        "this number is read differently on the machines of this control; choose the "
        "machine of this document",
    ),
    "distance-assumed": (
        ALL_OPS,
        "the program does not say whether its positions are absolute or incremental before "
        "this block, and the machine sets no power-on mode; add G90 or G91 (or the "
        "control's form) at the top",
    ),
    "axis-unwritten": (
        ("translate",),
        "the shift moves an axis the program has not written before this block, so where "
        "it starts is not known",
    ),
    "position-unknown": (
        TURNING,
        "where the tool is at the start of this block is not known (an axis not written "
        "yet, a machine position or a calculation before it, a jump or a loop that brings the "
        "tool here from another place or runs this block again from another position), and the "
        "transform needs it",
    ),
    "unknown-code": (
        ALL_OPS,
        "a code the database for this control does not know; it may change how the positions "
        "after it are read",
    ),
    "word-unknown": (
        ALL_OPS,
        "a word gEdit cannot place: it may be a position, an angle or a direction, and it "
        "would be left as written",
    ),
    "rotary-word": (
        TURNING,
        "a rotary axis moves to an angle other than 0 here, or stands at one; turning or "
        "mirroring the path would need its angle changed too, which gEdit does not do",
    ),
    "rotary-turned": (
        ("translate",),
        "a rotary axis stands turned here and tool centre point control is off, so a shift "
        "of the program is not a shift of these machine axes",
    ),
    # v1.2.0 manual-check fix round (D6-7): Sinumerik setting data SD42440.
    "shift-increment": (
        TURNING,
        "an incremental move along an axis the program has not written absolutely since the "
        "zero point was shifted or the work offset changed (TRANS, ATRANS, G54 to G57, G500); "
        "with the control's setting SD42440 at 1 such a move also travels the change of the "
        "shift, which a turn or a mirror cannot carry over. Write the axis absolutely first",
    ),
    "selection-inside": (
        ALL_OPS,
        "the selection starts or ends inside a cycle or a block that runs over several lines; "
        "select the whole of it",
    ),
    "selection-mode": (
        ("mirror", "lathe-z-mirror"),
        "this block runs under an arc direction or a compensation side (G2/G3, G41/G42) set "
        "above the selection; the mirror would have to swap that code outside the selection. "
        "Start the selection at the block that sets it",
    ),
    # -- cycles ------------------------------------------------------------------------
    "cycle-not-reviewed": (
        ALL_OPS,
        "a cycle whose parameters gEdit has not been told about (or one the database does "
        "not know); its positions could not be moved with the path",
    ),
    "cycle-position": (
        ALL_OPS,
        "a cycle with positions of its own (a pattern, a pocket, a contour elsewhere) that "
        "gEdit does not move",
    ),
    "cycle-angle": (
        TURNING,
        "a cycle that turns or places what it cuts by an angle or a corner of its own (a "
        "pocket's angle, the corner the tool stands at); gEdit does not turn or mirror those "
        "values, so the cycle would cut in the old direction",
    ),
    "cycle-level-empty": (
        ("translate",),
        "a level of this cycle on the tool axis (its retract plane, reference plane or depth) "
        "is left empty, which the control reads as 0; a shift cannot move a value that is not "
        "written. Write the level as a number",
    ),
    "cycle-plane": (
        ALL_OPS,
        "a cycle with a position on the tool axis while the working plane is not XY; the "
        "tool axis is not certain",
    ),
    "fk-contour": (
        ALL_OPS,
        "a free contour (FK): its points depend on each other and on the elements around them; "
        "gEdit does not move them",
    ),
    # -- arcs --------------------------------------------------------------------------
    "arc-tangential": (
        TURNING,
        "a tangential arc or an arc through a point; gEdit cannot check it after a turn or a "
        "mirror that rounds. Turn by 90, 180 or 270 degrees, or mirror in X or Y",
    ),
    "arc-unsupported": (
        ALL_OPS,
        "an arc gEdit cannot compute, or cannot check after a turn or a mirror that rounds (an "
        "arc by an L radius, a contour arc with the C axis)",
    ),
    "swap-unknown": (
        TURNING,
        "this arc direction or compensation side has no single opposite code in the database, "
        "so the mirror cannot write it",
    ),
    "arc-check": (
        ("rotate", "mirror"),
        "after rounding, this arc's start and end are not the same distance from its centre "
        "(within 0.002 mm or 0.0001 in); a control rejects or misreads such an arc. Use more "
        "decimals or an angle of 90, 180 or 270",
    ),
    "resolution": (
        ALL_OPS,
        "the result does not fit this word's form (its decimals, or whole increments of the "
        "machine) without rounding; give a shift the machine can write",
    ),
    "pole-unknown": (
        ALL_OPS,
        "a move around the pole while the pole is not known or not moved with the path",
    ),
    # -- planes and machine kinds ------------------------------------------------------
    "plane": (
        TURNING,
        "the working plane is not the one this transform works in (XY on a milling program, "
        "ZX with G18 for the lathe Z mirror)",
    ),
    "lathe-rotate": (
        ("rotate",),
        "a turning program cannot be rotated; translate it, or mirror it in Z for the counter spindle",
    ),
    "lathe-x-mirror": (
        ("mirror",),
        "a turning program can be mirrored in Z for the counter spindle, not in X",
    ),
    "mill-z-mirror": (
        ("lathe-z-mirror",),
        "the Z mirror for the counter spindle is for turning programs; a milling program is "
        "mirrored about a line in the XY plane",
    ),
    # -- the lathe Z mirror (the case list of the P4a prelude, plan §5 P4a item 5) -------
    "thread": (
        ("lathe-z-mirror",),
        "a thread or tapping move or cycle: mirrored in Z it would cut the other hand of "
        "thread unless the counter spindle turns the other way, which the program does not "
        "say. Write the threads for the counter spindle by hand",
    ),
    "roughing-cycle": (
        ("lathe-z-mirror",),
        "a roughing cycle that works from a contour (its finishing allowance along Z has a "
        "direction): gEdit mirrors G70 to G73 only together with both their blocks and their "
        "whole contour, and does not mirror the Okuma LAP",
    ),
    "lathe-cycle": (
        ("lathe-z-mirror",),
        "a turning, grooving or drilling cycle; its parameters are not mirrored, so the cycle "
        "would work on the wrong side",
    ),
    "single-pass-taper": (
        ("lathe-z-mirror",),
        "a turning or facing pass with a taper (R): whether the taper changes sign depends "
        "on the cycle; write the taper for the counter spindle by hand",
    ),
    "chamfer-sign": (
        ("lathe-z-mirror",),
        "a chamfer or a corner round whose sign gives the direction of the next move along "
        "the other axis; gEdit does not mirror it yet. Write it for the counter spindle by hand",
    ),
}

#: The place of each reason in the table (the order the findings of a block are sorted in).
_REASON_ORDER = {reason: place for place, reason in enumerate(REASONS)}

#: The information rows: the block is left as written and the run still writes.
INFO = {
    "machine-position": (
        ALL_OPS,
        "a position in machine coordinates or an incremental return to the reference point; "
        "left as written",
    ),
    "word-left": (
        ("translate",),
        "a word gEdit cannot place; left as written (a shift does not change angles or lengths)",
    ),
    "rounded": (
        ("rotate", "mirror"),
        "rounded to the word's decimals or to whole increments",
    ),
    "blank": (
        ("rotate", "mirror"),
        "the workpiece blank is left as written: it only sets the blank the control's graphics "
        "show. Check it there",
    ),
    # Review round (D6-4): Fanuc tool centre point control in the table coordinate system.
    "tcp-table": (
        ("translate",),
        "tool centre point control is on here, and the shift assumes the table coordinate "
        "system (parameter 19696 bit 5 = 0), in which the coordinates turn with the table. "
        "Check your machine",
    ),
    # Review round (NC-9): the drilling R on a lathe set to the Series 15 format.
    "cycle-r-left": (
        ("translate",),
        "R left as written: this machine is set to the Series 15 format, where R can be an "
        "absolute position (parameter 5102 bit 6). If your machine reads R as absolute, shift "
        "it too",
    ),
}

#: The warnings a result carries (one finding each, at the first line it concerns).
WARNINGS = {
    "climb-milling": (
        ("mirror",),
        "mirroring reverses the cutting direction: climb milling is now conventional milling, "
        "and the other way round. Check the cutting data",
    ),
    "helix-hand": (
        ("mirror", "lathe-z-mirror"),
        "a helical move (an arc with a move along the third axis) now turns the other way: a "
        "thread milled with it is now the other hand",
    ),
    "tool-nose": (
        ("lathe-z-mirror",),
        "mirrored for the counter spindle: the tool nose direction (the cutting edge position "
        "in each tool's offset) is not in the program. Set it for the counter spindle before "
        "this program runs",
    ),
}

# ---------------------------------------------------------------------------
# The rules (P4.2)
# ---------------------------------------------------------------------------

_ZERO = Decimal(0)
_ONE = Decimal(1)
_TWO = Decimal(2)

#: The roles :func:`transform` takes a mapping axis -> coordinate for.
VECTOR_ROLES = ("point", "point-inc", "centre", "centre-inc", "pole", "pole-inc", "cycle-position", "tool-axis")
#: Of them, the absolute coordinates: a translate moves them, a rotation turns them about its
#: centre, a mirror reflects them in its line.
ABSOLUTE_ROLES = ("point", "centre", "pole", "cycle-position", "tool-axis")
#: The vectors (from the start point, from the last pole): a translate leaves them, a rotation
#: turns them, a mirror reflects them, the lathe Z mirror negates their Z.
INCREMENTAL_ROLES = ("point-inc", "centre-inc", "pole-inc")
#: The roles a mirror swaps instead of computing (:func:`swap_partner`, :func:`swap_word`).
SWAPPED_ROLES = ("direction", "code-arc", "code-comp")

#: The elements of a Klartext free contour (FK). The code database does not describe them (it
#: has no entry for them), so this is the one list of names here; the NC review may move it into
#: the database as entries with a flag. A block that writes one is refused (``fk-contour``).
FK_WORDS = ("FL", "FLT", "FC", "FCT", "FPOL", "FSELECT")

#: The most decimals an exact result is written with; one that needs more is refused
#: (``resolution``) instead of being rounded behind the programmer's back.
MAX_DECIMALS = 6
#: Decimals a value computed in double precision is carried with before the word rounds it.
_CARRIED = 12
#: How much of a block a refusal quotes.
QUOTE_LENGTH = 60

#: The cycle values that run a cycle in the block or define one.
_CYCLE_RUNS = ("start", "define", "call", "call-modal")


def _dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _sets(entry: Any) -> Dict[str, Any]:
    return _dict(_dict(entry).get("sets"))


def _params(entry: Any) -> List[Dict[str, Any]]:
    params = _dict(entry).get("params")
    return [p for p in params if isinstance(p, dict) and isinstance(p.get("address"), str)] if isinstance(params, list) else []


def _param(entries: Sequence[Any], address: str) -> Optional[Tuple[Dict[str, Any], Dict[str, Any]]]:
    """``(entry, param)`` of the first of ``entries`` that declares ``address``, or ``None``."""
    word = address.upper()
    for entry in entries:
        for param in _params(entry):
            if param["address"].upper() == word:
                return entry, param
    return None


def _upper(values: Any) -> List[str]:
    return [str(v).upper() for v in values if isinstance(v, str) and v != ""] if isinstance(values, list) else []


def _head(code: Any) -> str:
    text = str(code or "")
    end = 0
    while end < len(text) and text[end].isalpha():
        end += 1
    return text[:end].upper()


def _canonical(entry: Dict[str, Any], written: str) -> str:
    code = entry.get("code")
    return code if isinstance(code, str) and code != "" else written


def _quote(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= QUOTE_LENGTH else text[: QUOTE_LENGTH - 1].rstrip() + "…"


def _frac_digits(value: Decimal) -> int:
    exponent = value.normalize().as_tuple().exponent
    return -exponent if isinstance(exponent, int) and exponent < 0 else 0


def _trim(value: Decimal) -> str:
    if value == _ZERO:
        return "0"
    return format(value.normalize(), "f")


def op_name(op: Op) -> str:
    """The name of ``op`` as :data:`OPS` and the findings use it (``'lathe-z-mirror'``)."""
    if isinstance(op, Translate):
        return "translate"
    if isinstance(op, Rotate):
        return "rotate"
    if isinstance(op, Mirror):
        return "mirror"
    if isinstance(op, LatheZMirror):
        return "lathe-z-mirror"
    raise TypeError("not an operation of _nc_geom: %r" % (op,))


# ---------------------------------------------------------------------------
# Exactness and the arithmetic of one value (contract item 3, AD-44)
# ---------------------------------------------------------------------------


def _quarter(degrees: Decimal) -> Optional[int]:
    """``degrees`` as a whole number of quarter turns (0 to 3), or ``None``."""
    quarter = Decimal(degrees) / Decimal(90)
    if quarter != quarter.to_integral_value():
        return None
    return int(quarter) % 4


#: cos and sin of the quarter turns, exactly.
_QUARTER_TRIG = [(_ONE, _ZERO), (_ZERO, _ONE), (-_ONE, _ZERO), (_ZERO, -_ONE)]


def _trig(degrees: Decimal) -> Tuple[Decimal, Decimal, bool]:
    """``(cos, sin, exact)``: exact on the quarter turns, double precision elsewhere."""
    quarter = _quarter(degrees)
    if quarter is not None:
        c, s = _QUARTER_TRIG[quarter]
        return c, s, True
    a = math.radians(float(degrees))
    return Decimal(repr(math.cos(a))), Decimal(repr(math.sin(a))), False


def is_exact(op: Op) -> bool:
    """Whether ``op`` is computed exactly on decimal text (Q4-4): every :class:`Translate` and
    :class:`LatheZMirror`; a :class:`Rotate` by a multiple of 90°; a :class:`Mirror` whose line is
    parallel to an axis (0°, 90°, 180°, 270°)."""
    if isinstance(op, (Translate, LatheZMirror)):
        return True
    if isinstance(op, (Rotate, Mirror)):
        return _quarter(op.degrees) is not None
    raise TypeError("not an operation of _nc_geom: %r" % (op,))


def _without_turns(value: Decimal) -> Decimal:
    """``value`` degrees with its whole turns taken off, its sign kept (``-360`` → ``0``,
    ``450`` → ``90``, ``-450`` → ``-90``): what a turn adds to an angle (plan §7 #306)."""
    full = Decimal(360)
    return value - full * (value / full).to_integral_value(rounding="ROUND_DOWN")


def _normal_angle(value: Decimal) -> Decimal:
    """An absolute polar angle brought back into -360..360 after a turn added to it (the TNC
    takes a polar angle PA from -360 to +360 degrees)."""
    full = Decimal(360)
    if -full <= value <= full:
        return value
    # P4a fix B1 (CODE-11): the remainder, not one subtraction per turn (PA+9999999999 took
    # some 28 million). The same answers: a whole number of turns past 360 lands on 360 (and on
    # -360 below), anything else on the remainder with the sign of the value.
    with localcontext() as context:
        digits = value.adjusted() + 1
        context.prec = max(28, digits + 12)
        rest = value % full
    if rest == _ZERO:
        return full if value > _ZERO else -full
    return rest


def _carried(value: Decimal, exact: bool) -> Decimal:
    if exact:
        return value
    return _nc_path.rounded(value, _CARRIED)


def _turn(dx: Decimal, dy: Decimal, c: Decimal, s: Decimal) -> Tuple[Decimal, Decimal]:
    with localcontext() as context:
        context.prec = 50
        return dx * c - dy * s, dx * s + dy * c


def _reflect(dx: Decimal, dy: Decimal, c2: Decimal, s2: Decimal) -> Tuple[Decimal, Decimal]:
    """The reflection of a vector in a line through the origin at half the angle of (c2, s2)."""
    with localcontext() as context:
        context.prec = 50
        return dx * c2 + dy * s2, dx * s2 - dy * c2


def _plane_pair(value: Dict[str, Decimal], role: str) -> Optional[Tuple[Decimal, Decimal]]:
    """The X and Y of a vector value for a turn or a mirror; ``None`` when it has neither."""
    has_x, has_y = "X" in value, "Y" in value
    if not has_x and not has_y:
        return None
    if has_x and has_y:
        return value["X"], value["Y"]
    if role in INCREMENTAL_ROLES:
        # An increment left out is a zero move along that axis.
        return value.get("X", _ZERO), value.get("Y", _ZERO)
    raise ValueError(
        "a rotation or a mirror of an absolute %s needs both X and Y (the caller fills the one "
        "the block does not write from the tracker)" % role
    )


def transform(role: str, value: Union[Decimal, Dict[str, Decimal]], op: Op) -> Tuple[Union[Decimal, Dict[str, Decimal]], bool]:
    """``(new value, exact)``: one value of one role moved by ``op`` (contract item 3).

    ``value`` is a :class:`~decimal.Decimal` for the scalar roles (``radius``, ``arc-angle``,
    ``turns``, the polar roles, ``length``, ``data``, ``untouched``) and a mapping axis ->
    coordinate for the vector roles (``point``, ``point-inc``, ``centre``, ``centre-inc``,
    ``pole``, ``pole-inc``, ``cycle-position``, ``tool-axis``): for :class:`Rotate` and
    :class:`Mirror` both axes of the XY plane (the caller fills a missing one from the tracker;
    an increment left out counts as zero), for :class:`Translate` and :class:`LatheZMirror` the
    axes written. ``direction``, ``code-arc`` and ``code-comp`` are swapped by
    :func:`swap_partner`, not here, and raise ``ValueError`` like ``unknown``.

    Coordinates are geometric: a diameter word is halved by the caller (:func:`read_word`) and
    doubled again by :func:`write_word`. ``exact`` is ``False`` only for a value a rotation or a
    mirror computed in double precision (:func:`is_exact`); a value kept as it is, or changed by
    decimal addition (a polar angle), is exact. Axes outside the XY plane stay under a rotation
    and a mirror (a helix keeps its third axis, the prelude's case list).
    """
    if role in SWAPPED_ROLES:
        raise ValueError("%s is swapped by swap_partner or swap_word, not computed" % role)
    if role not in ROLES or role == "unknown":
        raise ValueError("a word with the role %r has no transform" % role)

    if role not in VECTOR_ROLES:
        number = Decimal(value)  # type: ignore[arg-type]
        if role == "polar-angle":
            # Whole turns of the operation add nothing: PA+30 turned by -360 stays PA+30
            # (not PA-330), and a mirror line at 180 degrees reflects like one at 0.
            if isinstance(op, Rotate):
                return _normal_angle(number + _without_turns(Decimal(op.degrees))), True
            if isinstance(op, Mirror):
                return _normal_angle(_without_turns(_TWO * Decimal(op.degrees)) - number), True
        if role == "polar-angle-inc" and isinstance(op, Mirror):
            return -number, True
        return number, True

    if not isinstance(value, dict):
        raise ValueError("the role %s takes a mapping axis -> coordinate" % role)
    out = dict(value)
    absolute = role in ABSOLUTE_ROLES

    if isinstance(op, Translate):
        if not absolute:
            return out, True
        for axis, coordinate in value.items():
            shift = op.shift.get(axis)
            if shift is None:
                continue
            shift = Decimal(shift)
            if axis == "X" and op.x_reading == "diameter":
                shift = shift / _TWO  # the form asked a diameter; coordinates are radii
            out[axis] = coordinate + shift
        return out, True

    if isinstance(op, LatheZMirror):
        if "Z" in value:
            out["Z"] = _TWO * Decimal(op.z0) - value["Z"] if absolute else -value["Z"]
        if "Y" in value and op.y_turns:
            out["Y"] = -value["Y"]  # Q-B: about the turning axis, Y = 0 (absolute and incremental alike)
        return out, True

    if role == "tool-axis":
        return out, True  # a coordinate on the tool axis: the XY transforms leave it
    pair = _plane_pair(value, role)
    if pair is None:
        return out, True
    x, y = pair

    if isinstance(op, Rotate):
        c, s, exact = _trig(Decimal(op.degrees))
        if absolute:
            cx, cy = Decimal(op.centre[0]), Decimal(op.centre[1])
            dx, dy = _turn(x - cx, y - cy, c, s)
            nx, ny = cx + dx, cy + dy
        else:
            nx, ny = _turn(x, y, c, s)
        out["X"], out["Y"] = _carried(nx, exact), _carried(ny, exact)
        return out, exact

    if isinstance(op, Mirror):
        c2, s2, exact2 = _trig(_TWO * Decimal(op.degrees))
        exact = is_exact(op)
        if absolute:
            px, py = Decimal(op.point[0]), Decimal(op.point[1])
            dx, dy = _reflect(x - px, y - py, c2, s2)
            nx, ny = px + dx, py + dy
        else:
            nx, ny = _reflect(x, y, c2, s2)
        out["X"], out["Y"] = _carried(nx, exact2), _carried(ny, exact2)
        # P4a fix B1 (NC-19): a line at a multiple of 45 degrees reflects by decimal arithmetic
        # alone (cos and sin of twice its angle are 0 and 1), so its result is exact, though
        # the run still writes both axes on every block (it is no axis mirror, `is_exact`).
        return out, exact or exact2

    raise TypeError("not an operation of _nc_geom: %r" % (op,))


def affects(role: WordRole, op: Op) -> bool:
    """Whether ``op`` may change the word of ``role``: the words a run has to be able to read,
    compute and write back (a word it leaves alone cannot refuse it)."""
    kind = role.role
    axis = role.axis
    if isinstance(op, Translate):
        if kind not in ABSOLUTE_ROLES or axis is None:
            return False
        shift = op.shift.get(axis)
        return shift is not None and Decimal(shift) != _ZERO
    if isinstance(op, LatheZMirror):
        if kind in SWAPPED_ROLES:
            return True
        return kind in VECTOR_ROLES and axis in lathe_mirror_axes(op)
    if isinstance(op, (Rotate, Mirror)):
        if kind in VECTOR_ROLES:
            return kind != "tool-axis" and axis in ("X", "Y")
        if kind == "polar-angle":
            return True
        if isinstance(op, Mirror):
            return kind == "polar-angle-inc" or kind in SWAPPED_ROLES
        return False
    raise TypeError("not an operation of _nc_geom: %r" % (op,))


# ---------------------------------------------------------------------------
# What the profile and the database say, read once per tracker
# ---------------------------------------------------------------------------


class _Data:
    """The facts :func:`roles_of` and :func:`refusals_of` read from the profile and the database
    (contract item 1): nothing here names a dialect."""

    def __init__(self, tracker: Any) -> None:
        profile = _dict(getattr(tracker, "profile", None))
        codes = [e for e in (getattr(tracker, "codes", None) or []) if isinstance(e, dict)]
        cp = getattr(tracker, "cp", None)
        addresses = _dict(profile.get("addresses"))
        self.profile = profile
        self.codes = codes
        #: Incremental twins (``U`` -> ``X``) and the words that move an axis.
        self.twins = gedit_nc.incremental_axes(profile)
        listed = _upper(addresses.get("axes"))
        self.axes = frozenset(listed) | frozenset(self.twins)
        self.angular = frozenset(_upper(addresses.get("angular")))
        rotary = {a for a in listed if a in self.angular and a not in self.twins}
        rotary |= {t for t, a in self.twins.items() if a in self.angular}
        self.rotary = frozenset(rotary)
        self.diameter = frozenset(gedit_nc.diameter_axes(profile))
        self.centre_words = frozenset(w for w in _upper(addresses.get("arcCenter")) if w in _nc_path.CENTRE_AXIS)
        self.centre_absolute = addresses.get("arcCenterMode") == "absolute"
        self.direction_words = gedit_nc.arc_direction_words_of(profile)
        untouched = set()
        for key in ("feed", "spindle", "tool", "rapid"):
            word = addresses.get(key)
            if isinstance(word, str) and word != "":
                untouched.add(word.upper())
        untouched |= {str(k).upper() for k in _dict(addresses.get("feedUnitWords")) if isinstance(k, str)}
        untouched |= set(_upper(addresses.get("speedLimitWords")))
        # P4a fix B1 (NC-17, plan §7 #319): an offset number is no position (Sinumerik `D`).
        untouched |= set(_upper(addresses.get("offsetWords")))
        self.untouched = frozenset(untouched)
        rapid = addresses.get("rapid")
        #: The word (or keyword code) that makes a block a rapid move (Klartext `FMAX`), with
        #: the spellings its database entry gives it (`F MAX`, written as two words).
        self.rapid = rapid.upper() if isinstance(rapid, str) and rapid != "" else None
        spellings = set()
        if self.rapid is not None:
            spellings.add(self.rapid)
            for entry in codes:
                if str(entry.get("code") or "").upper() == self.rapid:
                    spellings |= {" ".join(str(a).upper().split()) for a in (entry.get("aliases") or []) if isinstance(a, str)}
        self.rapid_spellings = frozenset(spellings)
        spindle = addresses.get("spindle")
        self.spindle = spindle.upper() if isinstance(spindle, str) and spindle != "" else None
        self.lathe = gedit_nc.machine_type_of(profile) == "lathe"
        #: A database with no code that sets a plane (a turning database whose plane codes
        #: only choose the compensation plane) has one working plane: the turning plane.
        self.plane_codes = any(_sets(e).get("plane") in _nc_path.PLANE_AXES for e in codes)
        heads = set()
        for entry in codes:
            heads.add(_head(entry.get("code")))
            for alias in entry.get("aliases") or []:
                heads.add(_head(alias))
        heads.discard("")
        self.heads = frozenset(heads)
        #: The keywords the database writes codes of the form ``<keyword> <number>`` with
        #: (``CYCL DEF``), by keyword -> the entries of that family.
        families: Dict[str, List[Dict[str, Any]]] = {}
        for entry in codes:
            code = entry.get("code")
            if isinstance(code, str) and " " in code:
                name, _, number = code.rpartition(" ")
                if number.replace(".", "", 1).isdigit():
                    families.setdefault(gedit_nc.normalize_code(name), []).append(entry)
        #: P4a fix B1: only a family of cycles makes an unknown number an unknown cycle (`FN 9`
        #: to `FN 12` are numbered too, and `FN 0` is no cycle nobody reviewed).
        self.families = {
            name: members for name, members in families.items()
            if any(_sets(e).get("cycle") in _CYCLE_RUNS for e in members)
        }
        self.distance_groups = frozenset(
            e.get("group") for e in codes if _sets(e).get("distance") in ("absolute", "incremental") and isinstance(e.get("group"), str)
        )
        self.contour_groups = frozenset(
            e.get("group") for e in codes if e.get("contour") is not None and isinstance(e.get("group"), str)
        )
        self.fmt = gedit_nc.number_format_of(profile)
        #: The addresses the database declares for the codes of **one** group only, by address
        #: -> the first such entry: a word written without its code is still that group's
        #: (Fanuc `D2` without `G41`/`G42` is the radius offset number of the compensation
        #: group; plan §7 #304). An address of a motion or a cycle code, or of codes of several
        #: groups (`R`: a radius, an R plane, a rotation angle), is none of them.
        owners: Dict[str, Tuple[set, Optional[Dict[str, Any]]]] = {}
        #: P4a fix B1 (NC-7, plan §7 #320): a parameter that is an axis word (an axis of the
        #: profile, or any parameter of a code with `axisWords`: `G28`'s intermediate point
        #: with the lathe's `A`, `B`, `V`, `G53`) names a position, so written without its code
        #: it is no offset number. v1.2 NC fix round (FZ-9): only those parameters, not the
        #: whole group: `H1` without `G43` is still the length offset number, although `G43`
        #: also takes `Z`.
        for entry in codes:
            group = entry.get("group")
            positions = gedit_nc.axis_words_of(entry) is not None
            for param in _params(entry):
                groups, first = owners.get(param["address"].upper(), (set(), None))
                groups.add(group if isinstance(group, str) else None)
                if group == "motion" or _sets(entry).get("cycle") is not None:
                    groups.add("motion or cycle")
                if positions or self.axis_of(param["address"]) is not None:
                    groups.add("axis words")
                owners[param["address"].upper()] = (groups, entry if first is None or (first.get("group") == "nonmodal" and group != "nonmodal") else first)
        #: v1.2.0 manual-check integration: a one-shot code that names the offset number of a
        #: modal group (Fanuc `G53.6` `H`, the lathe's `D`) does not take the address away from
        #: that group: `H1` without `G43` stays the length offset number.
        for address, (groups, entry) in list(owners.items()):
            if "nonmodal" in groups and len(groups) == 2 and None not in groups and entry is not None and entry.get("group") != "nonmodal":
                owners[address] = ({entry.get("group")}, entry)
        self.group_params = {address: entry for address, (groups, entry) in owners.items() if len(groups) == 1 and None not in groups and entry is not None}
        #: v1.2 NC fix round (FZ-7): a word written with `=` that is a code of its own and
        #: describes its own value by a parameter of the same address (Sinumerik `RND=2`,
        #: `CHR=1`: a length that keeps its value), by address -> the entry.
        self.own_params = {
            str(entry.get("code")).upper(): entry
            for entry in codes
            if isinstance(entry.get("code"), str) and _param([entry], str(entry.get("code"))) is not None
        }
        self.calls: List[Any] = []
        patterns = getattr(cp, "patterns", None) if cp is not None else None
        for kind, regex in (_dict(patterns).get("outline") or []):
            if kind == "subprogram-call" and regex is not None:
                self.calls.append(regex)
        #: Wave Y (T015): the profile's rules that name block numbers (``numbering.references``),
        #: of which one that names two addresses gives a range of blocks (the contour ``P`` to ``Q``
        #: of the lathe roughing and finishing cycles).
        refs = _dict(getattr(cp, "patterns", None)).get("references") if cp is not None else None
        self.ranges = [(regex, [a.upper() for a in addrs]) for regex, addrs in (refs or []) if regex is not None and len(addrs) == 2]
        #: Wave Y (T015): the block numbers the run can see (:func:`set_block_numbers`): number ->
        #: the lines of the scope that carry it, and the numbers the lines above carry. ``None``
        #: until a run sets them: then no contour is known to be in the scope.
        self.scope_numbers: Optional[Dict[str, List[int]]] = None
        self.numbers_above: FrozenSet[str] = frozenset()
        self.rotary_state = gedit_nc.RotaryState(profile)
        #: P4a fix B1 (NC-6, plan §7 #314): the control's own variables, which a program that
        #: assigns them may use to move the coordinate system (Sinumerik `$P_UIFR`, Okuma
        #: `VZOFZ`: the profile's `systemVariables`; Fanuc `#5221`: a number from
        #: `systemVariableNumbers` on).
        patterns = getattr(cp, "patterns", None) if cp is not None else None
        self.system_variables = _dict(patterns).get("system_variables") if isinstance(patterns, dict) else None
        #: The leading mark of a line that continues the block above it (Okuma `$`,
        #: ``syntax.continuationStart``): the tokenizer leaves it as an unknown token, but it is
        #: no word of the block (manual-check fix round, with D5-1).
        self.continuation_start = _dict(patterns).get("continuation_start") if isinstance(patterns, dict) else None
        syntax = _dict(profile.get("syntax"))
        first = syntax.get("systemVariableNumbers")
        self.system_from = first if isinstance(first, int) and not isinstance(first, bool) and first > 0 else None
        #: P4a fix B1: the first line judged (a selection's first line), the blocks that read
        #: their start (for a loop that runs again), and the blank's one information row.
        self.first_line: Optional[int] = None
        #: Kept compact (a line and a bit mask each), since a long program may need many.
        self.need_lines = array("l")
        self.need_masks = array("b")
        self.blank_noted = False
        #: v1.2.0 manual-check fix round (D6-7): an incremental move after a change of the zero
        #: point also travels that change (Sinumerik setting data SD42440 at 1; the profile's
        #: ``syntax.incrementTravelsShift``). ``shift_pending`` holds the axes not written
        #: absolutely since the last shift or work offset code (:func:`observe`).
        self.increment_travels_shift = syntax.get("incrementTravelsShift") is True
        self.shift_pending: FrozenSet[str] = frozenset()
        #: Review round (D6-4): the profile's tool centre point control can work in the table's
        #: or in the workpiece's coordinate system (a machine parameter), and a shift is read in
        #: the table's (``syntax.tcpTableCoordinates``); a Translate under it says so, once.
        self.tcp_table = syntax.get("tcpTableCoordinates") is True
        self.tcp_noted = False
        #: Review round (NC-9): the point-less-feeds choices that stand for a tape format in
        #: which a drilling cycle's R can be an absolute position (``syntax.cycleRAbsoluteWith``).
        named = syntax.get("cycleRAbsoluteWith")
        self.cycle_r_with = [v for v in named if isinstance(v, str)] if isinstance(named, list) else []
        decl = _dict(profile.get("machineParams"))
        feeds = _dict(_dict(decl.get("numberInput")).get("pointlessFeeds")).get("choices")
        self.feed_choices = [c for c in feeds if isinstance(c, dict)] if isinstance(feeds, list) else []
        presets = _dict(decl.get("numberInput")).get("presets")
        #: The presets a result written with no machine chosen has to agree with (D57).
        self.presets = (
            [{"numberInput": p.get("value")} for p in presets if isinstance(p, dict) and isinstance(p.get("value"), dict)]
            if isinstance(presets, list)
            else []
        )

        #: What every word asks again and again (a long program repeats a few hundred
        #: spellings): the class of an address in a set of codes, and a literal's value.
        self._classes: Dict[Any, Optional[str]] = {}
        #: What a write asks again and again, per (word has a point, class, units, machine): the
        #: value of a written "1" (``_write_value``) and whether the presets write alike.
        self._head_of: Dict[str, bool] = {}
        self._units: Dict[Any, Optional[Decimal]] = {}
        self._alike: Dict[Any, bool] = {}
        self._machine: Optional[Tuple[Any, Dict[str, Any], Any]] = None
        #: The tracker's own readings and the context it was made for.
        shared = getattr(tracker, "readings", None)
        self._shared = shared if isinstance(shared, _nc_path.Readings) else None
        self._shared_context = getattr(tracker, "context", None)

    def machine_of(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """``gedit_nc.machine_params(context)``, read once per context."""
        if self._machine is None or self._machine[0] is not context:
            machine = gedit_nc.machine_params(context)
            shared = self._shared
            # The tracker of the same context has read the same machine: its literals are read
            # once for both (one cache, not two).
            if shared is not None and self._shared_context is context and shared.machine == machine:
                readings = shared
                machine = shared.machine
            else:
                readings = _nc_path.Readings(machine, self.profile)
            self._machine = (context, machine, readings)
            self._units = {}  # keyed by the machine's identity
            self._alike = {}
        return self._machine[1]

    def resolve(self, literal: Any, cls: str, context: Dict[str, Any], units: str) -> Tuple[Optional[str], List[Dict[str, Any]]]:
        self.machine_of(context)
        return self._machine[2].get(literal, cls, units)  # type: ignore[index]

    def has_head(self, address: str) -> bool:
        """Some code of the database starts with the letters of ``address`` (remembered per address)."""
        try:
            return self._head_of[address]
        except KeyError:
            found = self._head_of[address] = _head(address) in self.heads
            return found

    def unit_of(self, has_point: bool, cls: str, machine: Dict[str, Any], units: str) -> Optional[Decimal]:
        """The value of a ``1`` written like the word (with or without a point) on ``machine``: what one
        written unit is worth, remembered per kind of word."""
        key = (has_point, cls, units, id(machine))
        try:
            return self._units[key]
        except KeyError:
            probe = gedit_nc.parse_number("1." if has_point else "1")
            found = _nc_path.dec(gedit_nc.value_of(probe, cls, machine, units)) if probe is not None else None
            self._units[key] = found
            return found

    def reads_as_written(self, has_point: bool, cls: str, machine: Dict[str, Any], units: str) -> bool:
        """``machine`` reads a word with a point of this class exactly as written (its value is the
        number, nothing is counted in increments or scaled), so ``write_back`` writes it back
        through the format alone. Remembered per kind of word."""
        key = (has_point, cls, units, id(machine), "as-written")
        try:
            return self._alike[key]
        except KeyError:
            pass
        found = False
        if has_point and cls != "increment" and self.unit_of(has_point, cls, machine, units) is not None:
            params = machine.get("params") if isinstance(machine.get("params"), dict) else machine
            number_input = params.get("numberInput")
            if not isinstance(number_input, dict):
                found = True  # no declaration: the profile's own JSON decides, as written
            else:
                entry = _dict(_dict(number_input.get("classes")).get(cls))
                mode = entry.get("mode") if entry.get("mode") is not None else number_input.get("mode")
                found = mode == "calculator" or mode == "increment"
        self._alike[key] = found
        return found

    def writes_alike(self, has_point: bool, cls: str, machine: Dict[str, Any], units: str) -> bool:
        """Every preset of the profile writes a result back as ``machine`` does (so a run with no machine
        chosen needs no second look, D57). Remembered per kind of word.

        True when they all read the word as written (:func:`_as_written_everywhere`, address
        arithmetic's rule), or when they all count it in the same increment: the value of a written
        ``1`` is the same and is not 1, which no reading as written gives (``write_back`` sees only the
        mode and that unit)."""
        key = (has_point, cls, units, id(machine))
        try:
            return self._alike[key]
        except KeyError:
            pass
        alike = _as_written_everywhere(has_point, cls, self.presets)
        if not alike:
            mine = self.unit_of(has_point, cls, machine, units)
            alike = mine is not None and mine != _ONE and all(self.unit_of(has_point, cls, preset, units) == mine for preset in self.presets)
        self._alike[key] = alike
        return alike

    def number_class(self, address: str, profile_feed: Any, entries: Sequence[Dict[str, Any]], pitch: bool, in_force: Sequence[Dict[str, Any]]) -> Optional[str]:
        key = (address.upper(), profile_feed, pitch, tuple(id(e) for e in entries), tuple(id(e) for e in in_force))
        if key not in self._classes:
            if len(self._classes) > 4096:
                self._classes = {}
            self._classes[key] = gedit_nc.number_class_of(address, self.profile, profile_feed, list(entries), pitch, list(in_force))
        return self._classes[key]

    def axis_of(self, address: str) -> Optional[str]:
        word = address.upper()
        if word in self.twins:
            return self.twins[word]
        return word if word in self.axes else None


def observe(step: Any, tracker: Any) -> None:
    """v1.2.0 manual-check fix round (D6-7, SD42440): what a line leaves for the blocks after it.
    The scripts call it for every line after the tracker read it (the lines above a selection
    included) and after :func:`refusals_of` judged it. A code that shifts the zero point or
    changes the work offset (``CodeEntry.shift``, a code of the ``offset`` group) makes every
    linear axis pending but those the same block moves to absolutely; an absolute word of a
    move writes its axis again. Only a profile whose
    control travels the change of a shift with the next increment reads it
    (``syntax.incrementTravelsShift``)."""
    data = _data(tracker)
    if not data.increment_travels_shift:
        return
    if _shifts_zero(step):
        # Review round (NC-1): a block that changes the zero point and moves to an absolute
        # position in the same breath (`G54 G0 X0 Y0 Z100`) has travelled the change along
        # those axes already; only the others stay pending. A shift written as data
        # (`TRANS X10`) is no move, so it writes no axis.
        data.shift_pending = _linear_axes(data) - _absolute_axes(step)
        return
    if data.shift_pending:
        written = _absolute_axes(step)
        if written:
            data.shift_pending = data.shift_pending - written


def _shifts_zero(step: Any) -> bool:
    """Whether ``step`` carries a code that shifts the zero point or changes the work offset
    (``CodeEntry.shift``, a code of the ``offset`` group): D6-7's start of a pending shift."""
    entries = [_dict(e[0]) for e in (getattr(step, "entries", None) or ()) if isinstance(e, tuple) and e]
    return any(e.get("shift") is True or e.get("group") == "offset" for e in entries)


def _linear_axes(data: "_Data") -> FrozenSet[str]:
    """The axes a change of the zero point shifts: every axis but the rotary ones and the twins."""
    return frozenset(a for a in data.axes if a not in data.rotary and a not in data.twins)


def _absolute_axes(step: Any) -> FrozenSet[str]:
    """The axes a move ``step`` writes absolutely (none for a step that is no move)."""
    if getattr(step, "kind", None) != "move":
        return frozenset()
    return frozenset(r.axis for r in (getattr(step, "reads", None) or ()) if r.incremental is False and r.value is not None)


def _data(tracker: Any) -> _Data:
    found = getattr(tracker, "_nc_geom_data", None)
    if isinstance(found, _Data) and found.profile is getattr(tracker, "profile", None):
        return found
    data = _Data(tracker)
    try:
        setattr(tracker, "_nc_geom_data", data)
    except (AttributeError, TypeError):  # pragma: no cover - a tracker with slots
        pass
    return data


# ---------------------------------------------------------------------------
# One block, as roles_of and refusals_of read it
# ---------------------------------------------------------------------------


def _synthetic(kind_text: str, start: int, end: int, address: str, value_text: str, literal: Any) -> Any:
    """A word made up for a value the tokenizer does not give as one (a Klartext ``Q203=+0``,
    the argument of a cycle call): its ``start``/``end`` say where it stands in the line, so a
    script splices :attr:`Written.text` there."""
    return gedit_nc.Token(kind="word", start=start, end=end, text=kind_text, address=address, value_text=value_text, value=literal)


def _split_arguments(text: str) -> List[Tuple[str, int, int]]:
    """The arguments of a call as written with their spans in ``text``; an empty one keeps its
    place (a cycle reads its arguments by position); a comma in a string or brackets does not
    split."""
    out: List[Tuple[str, int, int]] = []
    depth = 0
    quoted = False
    start = 0

    def push(end: int) -> None:
        piece = text[start:end]
        lead = len(piece) - len(piece.lstrip())
        stripped = piece.strip()
        out.append((stripped, start + lead, start + lead + len(stripped)))

    for i, ch in enumerate(text):
        if ch == '"':
            quoted = not quoted
        elif quoted:
            continue
        elif ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif ch == "," and depth == 0:
            push(i)
            start = i + 1
    push(len(text))
    return out


class _Block:
    """What one step says, read once for :func:`roles_of`, :func:`refusals_of` and :func:`notes_of`."""

    def __init__(self, step: Any, tracker: Any) -> None:
        data = _data(tracker)
        interp = tracker.interp
        state = interp.state
        self.step = step
        self.data = data
        self.interp = interp
        self.state = state
        tokens = list(getattr(step, "tokens", None) or [])
        self.tokens = tokens
        self._written: Optional[str] = None
        #: Code token -> (entry, canonical code); the bare numbers a keyword took; and the
        #: keyword codes the database knows the family of but not the number (``CYCL DEF 999``).
        self.codes: Dict[int, Tuple[Dict[str, Any], str]] = {}
        self.consumed: set = set()
        self.unknown_family: List[str] = []
        self._read_codes()
        self.entries = [entry for entry, _ in self.codes.values()]
        groups = _dict(state.get("groups"))
        motion_code = _dict(groups.get("motion")).get("code")
        written_motion = [e for e in self.entries if e.get("group") == "motion" and (_sets(e).get("motion") or _sets(e).get("path"))]
        self.motion_written = bool(written_motion)
        in_force_motion = interp.entry(motion_code) if isinstance(motion_code, str) else None
        self.motion = written_motion[-1] if written_motion else in_force_motion
        self.arc = self.motion if _sets(self.motion).get("path") == "arc" else None
        self._groups = groups
        self._in_force_all: Optional[List[Dict[str, Any]]] = None
        cycle_entry = interp.entry(step.cycle) if getattr(step, "cycle", None) else None
        active = interp.active_cycle
        active_entry = interp.entry(active) if active else None
        self.cycles: List[Dict[str, Any]] = []
        for entry in self.entries + ([cycle_entry] if cycle_entry is not None else []):
            if _sets(entry).get("cycle") in _CYCLE_RUNS and entry not in self.cycles:
                self.cycles.append(entry)
        self.call_entries = [e for e in self.entries if _sets(e).get("cycle") in ("call", "call-modal")]
        #: The cycles whose parameters a block judges: those defined or started here or run here.
        self.judged = [e for e in self.cycles if _sets(e).get("cycle") in ("start", "define")]
        self.defined = interp.entry(interp.defined_cycle) if interp.defined_cycle else None
        in_force = [e for e in (in_force_motion, active_entry) if e is not None and e not in self.entries]
        # T120 / FB-2: a mode in force that makes I, J and K its own words (Fanuc `G43.5`, the
        # tool direction) lends the block those words only.
        in_force += gedit_nc.arc_centre_modes(groups, interp.entry, data.profile, self.entries)
        self.in_force = in_force
        self.data_entries = [e for e in self.entries if gedit_nc.axis_words_of(e) == "data"]
        self.words_are_data = any(e.get("wordsAreData") is True for e in self.entries)
        self.machine_entries = [e for e in self.entries if gedit_nc.axis_words_of(e) == "machine"]
        self.pole_set = any(e.get("pole") == "set" for e in self.entries)
        #: P4a fix B1 (NC-12): the workpiece blank (Klartext `BLK FORM`).
        self.blank = any(e.get("blank") is True for e in self.entries)
        self.pole_use = any(e.get("pole") == "use" for e in self.entries)
        plane = state.get("plane")
        self.plane = plane if plane in _nc_path.PLANE_AXES else None
        if self.plane is None and data.lathe and not data.plane_codes:
            self.plane = "ZX"
        self.tool_axis = _nc_path.PLANE_NORMAL.get(self.plane or "XY", "Z")
        self.distance = state.get("distance")
        self._reads: Optional[Dict[int, Any]] = None
        units = getattr(step, "units", None)
        if units not in ("mm", "inch"):
            units = _dict(state.get("units")).get("value")
        self.units = units if units in ("mm", "inch") else "mm"

    # What only some blocks ask for is worked out when it is first asked (the state is the step's own).

    @property
    def written(self) -> str:
        """The block as written, for a finding (a cleaned and cut copy of its text)."""
        if self._written is None:
            self._written = _quote("".join(t.text for t in self.tokens))
        return self._written

    @property
    def in_force_all(self) -> List[Dict[str, Any]]:
        """Every modal code in force, by group (a pitch-feed path mode, the motion code)."""
        if self._in_force_all is None:
            found = [self.interp.entry(v.get("code")) for v in self._groups.values() if isinstance(_dict(v).get("code"), str)]
            self._in_force_all = [e for e in found if e is not None]
        return self._in_force_all

    @property
    def reads(self) -> Dict[int, Any]:
        """The tracker's reading of each axis word of the step, by token."""
        if self._reads is None:
            self._reads = {id(r.token): r for r in (getattr(self.step, "reads", None) or [])}
        return self._reads

    @property
    def keywords(self) -> List[Any]:
        return [t for t in self.tokens if t.kind == "keyword"]

    def _read_codes(self) -> None:
        interp = self.interp
        data = self.data
        tokens = self.tokens
        count = len(tokens)
        for i, token in enumerate(tokens):
            kind = token.kind
            if kind == "word":
                address = (token.address or "").upper()
                if address == "" or not data.has_head(address) or gedit_nc.is_assignment(token):
                    continue
                code = address + (token.value_text or "")
                entry = interp.entry(code)
                if entry is not None:
                    self.codes[id(token)] = (entry, _canonical(entry, code))
            elif kind == "call":
                entry = interp.entry(token.address or "")
                if entry is not None:
                    self.codes[id(token)] = (entry, _canonical(entry, token.address or ""))
            elif kind == "keyword":
                name = token.address or token.text
                number = token.value_text
                if number is None:
                    nxt = next((t for t in tokens[i + 1 : count] if t.kind != "whitespace"), None)
                    if nxt is not None and nxt.kind == "word" and nxt.address is None and nxt.value_text is not None:
                        number = nxt.value_text
                        self.consumed.add(id(nxt))
                entry = None
                if number is not None:
                    entry = interp.entry("%s %s" % (name, number))
                    whole, dot, _ = number.partition(".")
                    if entry is None and dot == "." and whole.isdigit():
                        entry = interp.entry("%s %s" % (name, whole))
                    if entry is None and gedit_nc.normalize_code(name) in data.families:
                        self.unknown_family.append("%s %s" % (name.strip(), number))
                if entry is None:
                    entry = interp.entry(name)
                if entry is not None:
                    self.codes[id(token)] = (entry, _canonical(entry, name))

    def param(self, address: str, extra: Sequence[Any] = ()) -> Optional[Tuple[Dict[str, Any], Dict[str, Any]]]:
        return _param(list(self.entries) + list(extra) + list(self.in_force), address)

    def number_class(self, address: str, entries: Optional[Sequence[Dict[str, Any]]] = None) -> Optional[str]:
        interp = self.interp
        return self.data.number_class(address, interp.feed_unit, entries if entries is not None else self.entries, interp.pitch_feed, self.in_force)

    def incremental(self, token: Any, address: str) -> Optional[bool]:
        """How an axis word is read: the tracker's reading where it has one, else the word's
        twin, its incremental prefix, its value function and the distance mode."""
        read = self.reads.get(id(token))
        if read is not None and read.incremental is not None:
            return bool(read.incremental)
        if address in self.data.twins or token.incremental:
            return True
        _, function = _nc_path.literal_of(token)
        if function is not None:
            return function == "incremental"
        if self.distance == "incremental":
            return True
        if self.distance == "absolute":
            return False
        return None

    def mode_from_distance(self, token: Any, address: str) -> bool:
        """The word is absolute or incremental only because of the distance mode in force."""
        if address in self.data.twins or token.incremental:
            return False
        _, function = _nc_path.literal_of(token)
        return function is None

    def distance_assumed(self) -> bool:
        """Q4-5: the distance mode is not known, or only assumed from the profile's default."""
        if not self.data.distance_groups:
            return self.distance not in ("absolute", "incremental")
        if self.distance not in ("absolute", "incremental"):
            return True
        groups = _dict(self.state.get("groups"))
        for group in self.data.distance_groups:
            found = _dict(groups.get(group))
            if found and found.get("assumed") is True and found.get("from") != "machine":
                return True
        return False


def _block_of(step: Any, tracker: Any) -> _Block:
    data = _data(tracker)
    last = getattr(data, "_last", None)
    if last is not None and last[0] is step and last[1] is tracker.interp:
        return last[2]
    block = _Block(step, tracker)
    data._last = (step, tracker.interp, block)  # type: ignore[attr-defined]
    return block


# ---------------------------------------------------------------------------
# The roles (contract items 1, 2)
# ---------------------------------------------------------------------------


#: The number class a role gives its word where the profile does not list the address (the
#: polar words, a radius word other than ``R``): a polar angle is an angle, a radius a length.
_ROLE_CLASS = {
    "polar-angle": "angle",
    "polar-angle-inc": "angle",
    "polar-radius": "length",
    "polar-radius-inc": "length",
    "radius": "length",
    "turns": "count",
}


def _kept_role(number_class: Optional[str]) -> str:
    return "length" if number_class in ("length", "increment") else "untouched"


def _class_of_param(param: Optional[Dict[str, Any]]) -> Optional[str]:
    unit = _dict(param).get("unit")
    return unit if isinstance(unit, str) else None


def _classify(block: _Block, token: Any) -> Tuple[str, Optional[str], Optional[Dict[str, Any]]]:
    """``(role, axis, entry)`` of one word with an address."""
    data = block.data
    address = (token.address or "").upper()
    value_text = token.value_text or ""
    assignment = gedit_nc.is_assignment(token)

    if not assignment and (address + value_text) in data.direction_words:
        return "direction", None, None
    if value_text == "":
        if address in data.untouched:
            return "untouched", None, None
        if block.blank and data.axis_of(address) is not None:
            # P4a fix B1 (NC-12, plan §7 #318): `BLK FORM 0.1 Z` names the tool axis, as
            # `TOOL CALL 1 Z` does; no position.
            return "untouched", None, None
        return "unknown", None, None
    axis = data.axis_of(address)

    # Data and machine positions: values, not positions of this program.
    if block.words_are_data:
        return "data", None, block.data_entries[0] if block.data_entries else None
    if block.pole_set and axis is not None:
        incremental = block.incremental(token, address)
        return ("pole-inc" if incremental else "pole"), axis, None
    if block.data_entries:
        found = _param(block.data_entries, address)
        if axis is not None or found is not None:
            return "data", None, found[0] if found is not None else block.data_entries[0]
    if block.machine_entries and axis is not None:
        return "data", None, block.machine_entries[0]

    # The polar words, the turns and the opening angle (the vocabulary of _nc_path).
    if address == _nc_path.POLAR_RADIUS:
        return ("polar-radius-inc" if token.incremental else "polar-radius"), None, None
    if address == _nc_path.POLAR_ANGLE:
        return ("polar-angle-inc" if token.incremental else "polar-angle"), None, None
    if block.arc is not None and address == _nc_path.TURNS_WORD:
        return "turns", None, block.arc
    if block.arc is not None and address == _nc_path.ANGLE_WORD:
        return "arc-angle", None, block.arc

    # A cycle that runs here: its axis words are its positions, its parameters say the rest.
    if block.cycles:
        found = _param(block.cycles, address)
        if axis is not None:
            incremental = block.incremental(token, address)
            return ("point-inc" if incremental else "cycle-position"), axis, found[0] if found is not None else block.cycles[0]
        if found is not None:
            entry, param = found
            position = gedit_nc.position_of(param)
            if position == "tool-axis":
                incremental = block.incremental(token, address)
                return ("point-inc" if incremental else "tool-axis"), block.tool_axis, entry
            if position == "other":
                return "cycle-position", None, entry
            if position == "mode":
                return "data", None, entry
            return _kept_role(block.number_class(address)), None, entry

    # An arc: its centre, its radius, its intermediate point.
    if block.arc is not None:
        arc = block.arc
        found = _param([arc], address)
        if found is not None and isinstance(found[1].get("axis"), str) and found[1]["axis"] != "":
            # An intermediate point (`CIP I1=`): a coordinate of its axis, read like a move.
            incremental = block.incremental(token, address)
            return ("centre-inc" if incremental else "centre"), found[1]["axis"].upper(), arc
        if address in data.centre_words and block.number_class(address) == "length":
            _, function = _nc_path.literal_of(token)
            absolute = function == "absolute" or (function is None and data.centre_absolute)
            return ("centre" if absolute else "centre-inc"), _nc_path.CENTRE_AXIS[address], arc
        if address in _nc_path.RADIUS_WORDS:
            return "radius", None, arc
        if found is not None and axis is None and block.number_class(address) == "length":
            return "radius", None, arc  # a radius the arc code declares (Okuma `L`)

    if axis is not None:
        incremental = block.incremental(token, address)
        return ("point-inc" if incremental else "point"), axis, None

    if address in data.untouched:
        return "untouched", None, None
    if data.spindle is not None and assignment and address.startswith(data.spindle):
        return "untouched", None, None  # the speed of a numbered spindle (`S1=`, `S2=`)
    found = block.param(address)
    if found is not None:
        coordinate = found[1].get("axis")
        if isinstance(coordinate, str) and coordinate != "" and data.axis_of(coordinate.upper()) is not None:
            # Manual-check fix D5-1: a parameter that is a coordinate of an axis outside an arc
            # (Okuma LAP `G84` `XA=`, `ZA=`, `XB=`, `ZB=`, absolute change points). It moves with
            # its axis where the distance mode is known absolute; in incremental mode or with
            # the mode not known, whether it is absolute is not certain: refused.
            if block.incremental(token, address) is False:
                return "cycle-position", data.axis_of(coordinate.upper()), found[0]
            return "cycle-position", None, found[0]
        return _kept_role(block.number_class(address)), None, found[0]
    if address in data.angular:
        return "untouched", None, None
    owner = data.group_params.get(address) or (data.own_params.get(address) if assignment else None)
    if owner is not None:
        # A parameter of the codes of one group, written without its code (`G1 X10. D2`): a
        # number of that group (the offset register), no position.
        return _kept_role(block.number_class(address, [owner])), None, owner
    return "unknown", None, None


def _call_roles(block: _Block, token: Any, entry: Dict[str, Any]) -> List[WordRole]:
    """The arguments of a cycle written as a call (``CYCLE81(10,0,2,-5)``), by position."""
    text = token.value_text or ""
    offset = token.text.find("(")
    if offset < 0 or token.text[offset + 1 : offset + 1 + len(text)] != text:
        return []
    base = token.start + offset + 1
    params = _params(entry)
    out: List[WordRole] = []
    for position, (arg, start, end) in enumerate(_split_arguments(text), 1):
        if arg == "":
            continue
        param = params[position - 1] if position <= len(params) else None
        literal = gedit_nc.parse_number(arg)
        address = param["address"].upper() if param is not None else "#%d" % position
        synthetic = _synthetic(arg, base + start, base + end, address, arg, literal)
        out.append(_param_role(block, synthetic, entry, param))
    return out


def _param_role(block: _Block, token: Any, entry: Dict[str, Any], param: Optional[Dict[str, Any]]) -> WordRole:
    """A cycle parameter that is not a word of its own (a call argument, a Klartext Q parameter)."""
    position = gedit_nc.position_of(param)
    if param is None:
        return WordRole(token, "unknown", None, None, entry)
    if position == "tool-axis":
        cls = gedit_nc.number_class_of(block.tool_axis, block.data.profile, block.interp.feed_unit, [], False, [])
        return WordRole(token, "tool-axis", block.tool_axis, cls, entry)
    if position == "other":
        return WordRole(token, "cycle-position", None, None, entry)
    if position == "mode":
        return WordRole(token, "data", None, _class_of_param(param), entry)
    cls = _class_of_param(param)
    return WordRole(token, _kept_role(cls), None, cls, entry)


def _q_role(block: _Block, tokens: Sequence[Any], i: int) -> Tuple[Optional[WordRole], int]:
    """A Klartext parameter written ``Q203=+0`` (a variable, ``=`` and its value): its role when
    it belongs to the cycle defined in this block or continued on this line, and the index of
    the token after it."""
    count = len(tokens)
    token = tokens[i]
    j = i + 1
    while j < count and tokens[j].kind == "whitespace":
        j += 1
    if j >= count or tokens[j].kind != "operator" or tokens[j].text.strip() != "=":
        return None, i + 1
    k = j + 1
    while k < count and tokens[k].kind == "whitespace":
        k += 1
    end = k
    while end < count and tokens[end].kind not in ("comment", "continuation"):
        end += 1
    values = [t for t in tokens[k:end] if t.kind != "whitespace"]
    if not values:
        return None, end
    defines = [e for e in block.judged if _sets(e).get("cycle") == "define"]
    owners = defines or ([block.defined] if block.defined is not None and not block.keywords else [])
    if not owners:
        return None, end
    first, last = values[0], values[-1]
    literal = first.value if len(values) == 1 and first.kind == "word" and first.address is None else None
    start = token.start
    text = "".join(t.text for t in tokens[i : tokens.index(last) + 1])
    name = token.text.strip().upper()
    value_text = "".join(t.text for t in tokens[k : tokens.index(last) + 1])
    synthetic = _synthetic(text, start, last.end, name, value_text, literal)
    found = _param(owners, name)
    return _param_role(block, synthetic, owners[0], found[1] if found is not None else None), end


def _continuation_mark(data: _Data, tokens: Sequence[Any], i: int) -> bool:
    """The token at ``i`` is the leading mark of a line that continues the block above it (the
    profile's ``syntax.continuationStart``, Okuma ``$``): the first token of the line that is not
    blank, matched in full by that pattern."""
    pattern = data.continuation_start
    if pattern is None or not hasattr(pattern, "match"):
        return False
    if any(t.kind != "whitespace" for t in tokens[:i]):
        return False
    text = tokens[i].text
    found = pattern.match(text)
    return found is not None and found.end() >= len(text.rstrip())


def _marker_code(block: _Block, token: Any) -> bool:
    """Wave Y (T017): a token the tokenizer leaves unread whose text is a one-shot code of the
    database that takes no value and sets nothing (the Okuma ``CALRG``, the larger arc of an
    ``L`` radius): a code of the block, kept as written by every transform, no word nobody
    describes. Only such a marker: a code that sets a mode would need the interpreter, which
    did not read it."""
    entry = block.interp.entry(token.text.strip())
    if not isinstance(entry, dict) or entry.get("group") != "nonmodal":
        return False
    return not _params(entry) and not _sets(entry) and gedit_nc.axis_words_of(entry) is None


def roles_of(step: "_nc_path.Step", tracker: "_nc_path.PathTracker") -> List[WordRole]:
    """Every word and every code of ``step``, in written order, with its role (contract item 1,
    2). Codes that set an arc direction or a compensation side are ``code-arc`` / ``code-comp``;
    other codes, comments and block numbers are not listed. The arguments of a cycle written as
    a call and the Klartext parameters ``Q203=+0`` of a cycle are listed as words of their own
    (a :class:`gedit_nc.Token` whose ``start``/``end`` say where the value stands in the line).

    Read right after the tracker's line (the module docstring): the plane, the distance mode,
    the motion code and the cycle in force are the tracker's state after that line.
    """
    block = _block_of(step, tracker)
    tokens = block.tokens
    out: List[WordRole] = []
    i = 0
    count = len(tokens)
    while i < count:
        token = tokens[i]
        kind = token.kind
        code = block.codes.get(id(token))
        if code is not None:
            entry = code[0]
            if gedit_nc.arc_direction_of(entry) is not None:
                out.append(WordRole(token, "code-arc", None, None, entry))
            elif gedit_nc.comp_side_of(entry) is not None:
                out.append(WordRole(token, "code-comp", None, None, entry))
            if kind == "call" and _sets(entry).get("cycle") in _CYCLE_RUNS:
                out.extend(_call_roles(block, token, entry))
            i += 1
            continue
        if kind == "variable":
            role, i = _q_role(block, tokens, i)
            if role is not None:
                out.append(role)
            continue
        if kind == "unknown" and token.text.strip() != "":
            if not _continuation_mark(block.data, tokens, i) and not _marker_code(block, token):
                out.append(WordRole(token, "unknown", None, None, None))
        elif kind == "word" and id(token) not in block.consumed:
            if not token.address:
                out.append(WordRole(token, "unknown", None, None, None))
            else:
                role, axis, entry = _classify(block, token)
                cls = _ROLE_CLASS.get(role) or (None if role in ("unknown", "direction") else block.number_class(token.address))
                out.append(WordRole(token, role, axis, cls, entry))
        i += 1
    return out


# ---------------------------------------------------------------------------
# Reading and writing one word (contract item 5)
# ---------------------------------------------------------------------------


def _reading(token: Any, interp: Any, data: _Data, role: Optional[WordRole] = None) -> str:
    """``'diameter'``, ``'radius'`` or ``'unknown'``: how the control reads this word's X (AD-43;
    Sinumerik ``DIAM90`` per word by its value function, as ``diameter_reading`` does). An
    absolute arc centre along a diameter axis (``I=AC(…)`` under ``DIAMON``) is read as the
    tracker reads it (``_nc_path.centre_reading``, plan §7 #302)."""
    if role is not None and role.role == "centre" and role.axis in data.diameter:
        found = _nc_path.centre_reading(interp, role.axis, _dict(interp.state.get("diameter")).get("mode"))
        return found if found is not None else "unknown"
    address = (token.address or "").upper()
    if role is not None and role.role == "cycle-position" and role.axis in data.diameter and address not in data.diameter:
        # Manual-check fix D5-1: a coordinate parameter of a diameter axis (Okuma `G84` `XA=`)
        # is read as that axis is.
        address = role.axis
    if address not in data.diameter:
        return "radius"
    reading = interp.diameter_reading(address)
    mode = _dict(interp.state.get("diameter")).get("mode")
    _, function = _nc_path.literal_of(token)
    if mode == "absolute-only" and function is not None:
        reading = "diameter" if function == "absolute" else "radius"
    return reading if reading in ("diameter", "radius") else "unknown"


def _units_of(tracker: Any, units: Optional[str]) -> str:
    if units in ("mm", "inch"):
        return units  # type: ignore[return-value]
    value = _dict(tracker.interp.state.get("units")).get("value")
    return value if value in ("mm", "inch") else "mm"


def read_word(role: WordRole, tracker: "_nc_path.PathTracker", units: Optional[str], context: Dict[str, Any]) -> Tuple[Optional[Decimal], List[Dict[str, Any]]]:
    """``(value, readings)``: the word's value in ``units`` (the block's), geometric (a word the
    control reads as a diameter is halved), or ``None`` and the readings the profile's presets
    give it when no machine settles it (D57); ``(None, [])`` for an expression or a word with no
    value on this machine. The twin of :func:`write_word`."""
    data = _data(tracker)
    token = role.token
    literal, _ = _nc_path.literal_of(token)
    if literal is None or role.number_class is None:
        return None, []
    units = _units_of(tracker, units)
    text, readings = data.resolve(literal, role.number_class, context, units)
    value = _nc_path.dec(text)
    if value is None:
        return None, readings
    reading = _reading(token, tracker.interp, data, role)
    if reading == "unknown":
        return None, []
    return (value / _TWO if reading == "diameter" else value), []


def _write_value(
    target: Decimal, literal: Any, cls: str, machine: Dict[str, Any], units: str, exact: bool, fmt: Dict[str, Any], data: Optional[_Data] = None
) -> Tuple[Optional[str], bool, Optional[str]]:
    """``gedit_nc.write_back`` with the decimals of Q4-4: an exact result keeps the word's own
    decimals and adds what it needs (at most :data:`MAX_DECIMALS`); a rounded one keeps its own
    and gets at least :data:`MIN_DECIMALS`. A point-less word read in increments stays whole
    increments (``write_back`` sees to that); one read as written drops trailing zeros, so a
    whole result stays point-less."""
    use = dict(fmt)
    own = len(literal.frac_part or "")
    as_written = data is not None and data.reads_as_written(bool(literal.has_point), cls, machine, units)
    if as_written:
        in_literal = target  # a unit of 1 divides nothing
    else:
        if data is not None:
            unit = data.unit_of(bool(literal.has_point), cls, machine, units)
        else:
            probe = gedit_nc.parse_number("1." if literal.has_point else "1")
            unit = _nc_path.dec(gedit_nc.value_of(probe, cls, machine, units)) if probe is not None else None
        with localcontext() as context:
            context.prec = 80
            in_literal = target / unit if unit not in (None, _ZERO) else target
    if exact:
        use["decimals"] = max(own, min(_frac_digits(in_literal), MAX_DECIMALS))
    else:
        use["decimals"] = max(own, MIN_DECIMALS.get(units, 3))
    if not literal.has_point:
        use["trailingZeros"] = "drop"
    if as_written:
        # `write_back` of a word read as written is the format and a read back: the same two
        # steps without asking the machine again (``test_nc_geom`` holds the two to each other).
        wanted = _trim(target)
        text = gedit_nc.format_number(wanted, literal, use, True)
        back = gedit_nc.decimal_of(text)
        rounded = back is None or _trim(back) != wanted
        if rounded and exact:
            return (None, True, gedit_nc.WRITE_BACK_ERRORS["rounded"])
        return (text, rounded, None)
    return gedit_nc.write_back(_trim(target), literal, cls, machine, units, use, refuse_rounding=exact)


def _as_written_everywhere(has_point: bool, cls: str, presets: Sequence[Dict[str, Any]]) -> bool:
    """Every preset reads this word as written (the calculator reading, or increments with a
    point): then they all write a result back the same way (address arithmetic's rule)."""
    if cls == "increment":
        return False
    for preset in presets:
        number_input = _dict(preset.get("numberInput"))
        entry = _dict(_dict(number_input.get("classes")).get(cls))
        mode = entry.get("mode") or number_input.get("mode")
        if not (mode == "calculator" or (mode == "increment" and has_point)):
            return False
    return True


def _with_value(token: Any, number_text: str) -> str:
    """The word's text with its number replaced: the address, ``=`` and a value function stay."""
    text = token.text
    value = token.value_text or ""
    if value == "" or not text.endswith(value):
        return number_text
    prefix = text[: len(text) - len(value)]
    open_at = value.find("(")
    close_at = value.rstrip().rfind(")")
    if token.value is None and open_at > 0 and close_at > open_at:
        inner = value[open_at + 1 : close_at]
        lead = inner[: len(inner) - len(inner.lstrip())]
        trail = inner[len(inner.rstrip()) :]
        return prefix + value[: open_at + 1] + lead + number_text + trail + value[close_at:]
    return prefix + number_text


def write_word(
    role: WordRole,
    value: Decimal,
    tracker: "_nc_path.PathTracker",
    units: str,
    exact: bool,
    context: Dict[str, Any],
) -> Union[Written, Refusal]:
    """The word ``role.token`` with ``value`` (geometric for a diameter word: doubled here) in
    its own form (contract item 5). ``exact``: a result that does not fit is refused
    (``resolution``); otherwise it is rounded as Q4-4 says and :attr:`Written.rounded` is set.

    ``value`` is in ``units`` (the block's). With no machine chosen, a result the profile's
    presets would write differently is refused (``machine-dependent``, D57). A refusal carries
    line 0: the caller knows the line (``refusal._replace(line=n)``)."""
    data = _data(tracker)
    token = role.token
    written = _quote(token.text)
    literal, _ = _nc_path.literal_of(token)
    if literal is None:
        return Refusal(0, "expression", written, token.text.strip())
    cls = role.number_class
    if cls is None or cls == "count":
        return Refusal(0, "machine-dependent", written, token.text.strip())
    reading = _reading(token, tracker.interp, data, role)
    if reading == "unknown":
        return Refusal(0, "distance-assumed", written, token.text.strip())
    target = Decimal(value) * _TWO if reading == "diameter" else Decimal(value)
    units = _units_of(tracker, units)
    machine = data.machine_of(context)
    text, rounded, error = _write_value(target, literal, cls, machine, units, exact, data.fmt, data)
    if error is not None or text is None:
        reason = "resolution" if error == gedit_nc.WRITE_BACK_ERRORS["rounded"] else "machine-dependent"
        return Refusal(0, reason, written, error or "")
    chosen = _dict(machine.get("source")).get("numberInput") == "machine"
    if data.presets and not chosen and not data.writes_alike(bool(literal.has_point), cls, machine, units):
        for preset in data.presets:
            other = _write_value(target, literal, cls, preset, units, exact, data.fmt, data)
            if other != (text, rounded, None):
                return Refusal(0, "machine-dependent", written, token.text.strip())
    return Written(_with_value(token, text), rounded)


def write_added(
    address: str,
    like: WordRole,
    value: Decimal,
    tracker: "_nc_path.PathTracker",
    units: str,
    exact: bool,
    context: Dict[str, Any],
) -> Union[Written, Refusal]:
    """A word a rotation adds to a block that wrote only one axis of the plane (AD-44, contract
    item 10): ``address`` written in the form of ``like``, the other word of the plane in that
    block (its address style, its value function, its point and decimals, its sign style)."""
    token = like.token
    old = (token.address or "").upper()
    text = token.text
    value_text = token.value_text or ""
    prefix = text[: len(text) - len(value_text)] if value_text and text.endswith(value_text) else text
    at = prefix.upper().find(old) if old else -1
    new_prefix = prefix[:at] + address + prefix[at + len(old) :] if at >= 0 else address
    synthetic = gedit_nc.Token(
        kind="word", start=token.start, end=token.end, text=new_prefix + value_text, address=address,
        value_text=value_text, value=token.value, incremental=token.incremental, index=token.index,
    )
    return write_word(WordRole(synthetic, like.role, like.axis, like.number_class, like.entry), value, tracker, units, exact, context)


# ---------------------------------------------------------------------------
# The swaps of AD-42 (contract item 4)
# ---------------------------------------------------------------------------

_OTHER = {"cw": "ccw", "ccw": "cw", "left": "right", "right": "left"}


def _flag_of(entry: Any, flag: str) -> Optional[str]:
    if flag == "arcDirection":
        return gedit_nc.arc_direction_of(entry)
    if flag == "compSide":
        return gedit_nc.comp_side_of(entry)
    raise ValueError("no such flag: %r (arcDirection or compSide)" % flag)


def swap_partner(entry: Dict[str, Any], codes: Sequence[Dict[str, Any]], flag: str) -> Optional[str]:
    """The canonical code a mirror writes instead of ``entry`` (contract item 4): the one entry
    of ``entry``'s group whose ``sets[flag]`` (``'arcDirection'`` or ``'compSide'``) is the other
    value; ``None`` when there is none or more than one."""
    value = _flag_of(entry, flag)
    group = _dict(entry).get("group")
    if value is None or not isinstance(group, str):
        return None
    wanted = _OTHER[value]
    found = [e for e in codes if isinstance(e, dict) and e.get("group") == group and _flag_of(e, flag) == wanted]
    if len(found) != 1:
        return None
    code = found[0].get("code")
    return code if isinstance(code, str) and code != "" else None


def swap_word(word: str, profile: Dict[str, Any]) -> Optional[str]:
    """The direction word a mirror writes instead of ``word`` (``DR+`` → ``DR-``), from the
    profile's ``addresses.arcDirectionWords``; ``None`` when the profile has no single word for
    the other direction."""
    words = gedit_nc.arc_direction_words_of(profile)
    direction = words.get(word.strip().upper())
    if direction is None:
        return None
    others = [w for w, d in words.items() if d == _OTHER[direction]]
    return others[0] if len(others) == 1 else None


def partner_text(written: str, partner: str) -> str:
    """``partner`` in the written style of the code it replaces (contract item 9): ``G02`` →
    ``G03``, ``g2`` → ``g3``, ``G2`` → ``G3``; a code of another shape is written canonical."""
    match = re.match(r"^(\s*)([A-Za-z]+)(\s*)(0*)(\d+(?:\.\d+)?)(\s*)$", written)
    target = re.match(r"^([A-Za-z]+)(\d+(?:\.\d+)?)$", partner)
    if match is None or target is None:
        return partner
    lead, letters, gap, zeros, digits, trail = match.groups()
    width = len(zeros) + len(digits.split(".")[0])
    head = target.group(1)
    head = head.lower() if letters.islower() else head
    number = target.group(2)
    whole, dot, frac = number.partition(".")
    return "%s%s%s%s%s" % (lead, head, gap, whole.zfill(width) + dot + frac, trail)


# ---------------------------------------------------------------------------
# The refusals (X22, contract items 2, 6, 7) and the information rows
# ---------------------------------------------------------------------------


def _line_has_call(block: _Block) -> Optional[str]:
    """The subprogram or macro call the block writes, or ``None`` (from data: ``call``, a
    parameter that names a program, the profile's ``subprogram-call`` outline rule, a call
    token the database does not know, a modal macro call in force)."""
    for entry in block.entries:
        if entry.get("call") is True or any(p.get("programNumber") for p in _params(entry)):
            return str(entry.get("code"))
    for token in block.tokens:
        if token.kind == "call" and id(token) not in block.codes:
            return token.text.strip()
    text = getattr(block.step, "masked", None) or "".join(t.text for t in block.tokens)
    for regex in block.data.calls:
        match = regex.search(text)
        if match is None:
            continue
        found = match.groupdict().get("text") or match.group(0)
        name = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)", found or "")
        entry = block.interp.entry(name.group(1)) if name is not None else None
        if entry is not None and (_sets(entry).get("cycle") is not None or gedit_nc.frame_of(entry) is not None):
            continue  # a cycle or a frame written as a call (`CYCLE800()`): their rules judge it
        return (found or "").strip()
    for entry in block.in_force_all:
        if entry.get("modal") is True and entry.get("wordsAreData") is True and any(p.get("programNumber") for p in _params(entry)):
            if any((t.kind == "word" and block.data.axis_of(t.address or "") is not None and (t.value_text or "")) for t in block.tokens):
                return str(entry.get("code"))
    return None


def _writes_values(block: _Block, axes_only: bool) -> List[str]:
    out = []
    for token in block.tokens:
        if token.kind != "word" or id(token) in block.codes or id(token) in block.consumed or not (token.value_text or ""):
            continue
        if not token.address:
            continue
        if axes_only and block.data.axis_of(token.address) is None:
            continue
        out.append(token.text.strip())
    return out


def _writes_tool_offset(block: _Block, entry: Dict[str, Any]) -> bool:
    """v1.2 NC fix round (T013): the block of a shift code writes a tool offset, no coordinate
    system (``_nc_path.writes_tool_offset``, which the tracker asks too since NCR-10)."""
    return _nc_path.writes_tool_offset(entry, block.tokens, block.codes)


def _taper_word(block: _Block) -> Optional[str]:
    """The taper ``R`` a pass block writes, unless it is written as a plain 0 (no taper)."""
    for token in block.tokens:
        if token.kind != "word" or (token.address or "").upper() != "R" or not (token.value_text or ""):
            continue
        literal, function = _nc_path.literal_of(token)
        number = gedit_nc.decimal_of(literal) if literal is not None and function is None else None
        if number is None or number != _ZERO:
            return token.text.strip()
    return None


def _all_zero(block: _Block) -> bool:
    """Every axis value the block writes is a written zero (``X+0``, ``Y0.``, ``Z-0,000``):
    no variable, no expression, no other number."""
    found = False
    for token in block.tokens:
        if token.kind != "word" or id(token) in block.codes or id(token) in block.consumed or not (token.value_text or ""):
            continue
        if not token.address or block.data.axis_of(token.address) is None:
            continue
        literal, function = _nc_path.literal_of(token)
        number = gedit_nc.decimal_of(literal) if literal is not None else None
        if number is None or number != 0:
            return False
        found = True
    return found


def _machine_change(block: _Block, roles: Sequence[WordRole], tracker: Any, op: Op, context: Dict[str, Any]) -> Optional[bool]:
    """For a machine block whose code takes its axis words as an intermediate point in the
    program's coordinates (``G28``/``G30``: the code declares them): whether ``op`` would move
    that point (``None`` when it cannot be told). ``False`` for any other machine block."""
    declared = [e for e in block.machine_entries if _params(e)]
    if not declared:
        return False
    absolute: Dict[str, Decimal] = {}
    incremental: Dict[str, Decimal] = {}
    for role in roles:
        token = role.token
        address = (token.address or "").upper()
        axis = block.data.axis_of(address)
        if axis is None or _param(declared, address) is None:
            continue
        mode = block.incremental(token, address)
        if mode is None:
            return None
        literal, _ = _nc_path.literal_of(token)
        if literal is None:
            return None
        cls = block.number_class(address)
        value, _ = read_word(WordRole(token, "point", axis, cls, None), tracker, block.units, context)
        if value is None:
            return None
        (incremental if mode else absolute)[axis] = value
    if isinstance(op, Translate):
        return any(axis in op.shift and Decimal(op.shift[axis]) != _ZERO for axis in absolute)
    if isinstance(op, LatheZMirror):
        if op.y_turns and ("Y" in absolute and absolute["Y"] != _ZERO or "Y" in incremental and incremental["Y"] != _ZERO):
            return True  # Q-B: Y changes sign about 0
        return ("Z" in absolute and absolute["Z"] != Decimal(op.z0)) or ("Z" in incremental and incremental["Z"] != _ZERO)
    if isinstance(op, Rotate) and _quarter(op.degrees) == 0 and Decimal(op.degrees) % 360 == 0:
        return False
    if "X" in incremental or "Y" in incremental:
        moved, _ = transform("point-inc", {"X": incremental.get("X", _ZERO), "Y": incremental.get("Y", _ZERO)}, op)
        if moved != {"X": incremental.get("X", _ZERO), "Y": incremental.get("Y", _ZERO)}:
            return True
    if isinstance(op, Mirror) and _quarter(op.degrees) is not None:
        vertical = _quarter(op.degrees) in (1, 3)
        if vertical:
            return "X" in absolute and absolute["X"] != Decimal(op.point[0])
        return "Y" in absolute and absolute["Y"] != Decimal(op.point[1])
    return "X" in absolute or "Y" in absolute


#: Wave Y (T015): the detail of the ``roughing-cycle`` refusal of the first block of a two-block
#: roughing cycle, which its second block, judged next, settles (the script's walk).
SECOND_BLOCK = "waits for its second block"


def number_of(text: Any) -> Optional[str]:
    """A block number as a key: its digits without the leading zeros (``N0010`` and ``10`` are
    ``'10'``), or ``None`` for anything that is not a whole number."""
    digits = str(text or "").strip()
    if digits[:1] in ("N", "n"):
        digits = digits[1:]
    if not digits.isdigit():
        return None
    return digits.lstrip("0") or "0"


def set_block_numbers(tracker: Any, scope: Dict[str, List[int]], above: Sequence[str]) -> None:
    """Wave Y (T015): the block numbers of the scope (number -> its lines) and of the lines
    above it, which a script that walks the whole scope hands the rules before its walk: a lathe
    roughing or finishing cycle under the Z mirror is judged only when its contour is in them."""
    data = _data(tracker)
    data.scope_numbers = {k: list(v) for k, v in scope.items()}
    data.numbers_above = frozenset(above)


def _contour_range(block: _Block) -> Optional[Tuple[str, str]]:
    """Wave Y (T015): the first and the last block number of the contour a cycle block names
    (``G70``-``G73`` ``P``/``Q``: a rule of the profile's ``numbering.references`` with two
    addresses matches the block), or ``None``."""
    data = block.data
    if not data.ranges:
        return None
    text = getattr(block.step, "masked", None) or "".join(t.text for t in block.tokens)
    words = getattr(block.step, "words", None) or {}
    for regex, (first, last) in data.ranges:
        if regex.search(text) is None:
            continue
        a = number_of(getattr(words.get(first), "value_text", None))
        b = number_of(getattr(words.get(last), "value_text", None))
        if a is not None and b is not None:
            return a, b
    return None


def _contour_in_scope(block: _Block, found: Tuple[str, str]) -> bool:
    """Wave Y (T015): the contour from block number ``found[0]`` to ``found[1]`` lies in the scope:
    each number stands on one line of it and on no line above it, the first not after the last.
    The numbers below a selection are not known; the control finds the contour by its numbers."""
    data = block.data
    numbers = data.scope_numbers
    if numbers is None:
        return False
    first, last = (numbers.get(n, []) for n in found)
    if len(first) != 1 or len(last) != 1 or found[0] in data.numbers_above or found[1] in data.numbers_above:
        return False
    return first[0] <= last[0]


def contour_flips(block: _Block, roles: Sequence[WordRole], op: Op) -> Optional[List[WordRole]]:
    """Wave Y (T015, the P4a prelude's case list): the words of a lathe roughing cycle block (a
    ``'start'`` cycle whose words are data: ``G71``-``G73``) that the Z mirror changes the sign of,
    or ``None`` when one cannot be judged. A word of the cycle on an axis the mirror turns (``W``,
    the twin of Z; ``V`` of Y where Y turns) is an allowance or a relief whose sign gives its side
    of the contour, which the mirror reverses (FANUC 0i-F lathe manual, the stock removal cycles:
    the four patterns of the signs of U and W), unless the code declares it without a sign
    (``min`` 0: the depth of cut ``W`` of the first block of ``G72``), which stays. One the code does
    not declare for the block is not judged."""
    entries = [e for e in block.entries if _sets(e).get("cycle") == "start" and gedit_nc.axis_words_of(e) == "data"]
    if not entries:
        return []
    entry = entries[-1]
    written = [(r.token.address or "").upper() for r in roles if r.token.kind == "word" and r.token.address]
    number = gedit_nc.cycle_block_of(entry, written)
    params = gedit_nc.params_of_block(entry, number)
    turned = lathe_mirror_axes(op) if isinstance(op, LatheZMirror) else ()
    out: List[WordRole] = []
    for role in roles:
        address = (role.token.address or "").upper()
        if role.role != "data" or not address:
            continue
        axis = block.data.axis_of(address)
        if axis is None or axis not in turned:
            continue
        param = next((p for p in params if str(p.get("address") or "").upper() == address), None)
        if param is None:
            return None
        low = param.get("min")
        if isinstance(low, (int, float)) and not isinstance(low, bool) and low >= 0:
            continue
        out.append(role)
    return out


def _lathe_reasons(block: _Block, moving: bool, tracker: Any = None) -> List[Tuple[str, str]]:
    """The case list of the prelude for the lathe Z mirror (contract item 7), from data. v1.2.0
    (NCR-2): a pass block also refuses while the taper the passes share, written above it, lies
    along Z (`G94`, `G79`: `CodeParam.lengthAlong`) and is not 0 or not known; the passes keep it
    until a block writes it again or a one-shot code other than a dwell, or a plane code, clears
    it (`_nc_path.PathTracker.pass_taper`). A taper along X (`G90`, `G77`) keeps its sign."""
    out: List[Tuple[str, str]] = []
    written = list(block.entries)
    running = [e for e in block.cycles if e not in written]
    considered = written + running + ([e for e in block.in_force_all if e not in written] if moving else [])
    for entry in considered:
        if entry.get("pitchFeed") is True or entry.get("tapping") is True:
            out.append(("thread", str(entry.get("code"))))
            break
    # Wave Y (T015): a roughing cycle (`G71`-`G73`) or a finishing pass along a contour (`G70`)
    # whose contour, named by its block numbers, lies whole in the scope is mirrored: its contour
    # blocks are points, and the words of the cycle along Z change sign or stay
    # (:func:`contour_flips`, the script's rewrite). The first block of a two-block cycle names no
    # contour: its second block, next, settles it (`SECOND_BLOCK`). The Okuma LAP stays refused:
    # how its cutting direction along Z follows the mirrored shape is not in the manuals at hand.
    contour = _contour_range(block) if written else None
    along = contour is not None and _contour_in_scope(block, contour)
    first_block = False
    if not along and written and not running:
        starts = [e for e in written if _sets(e).get("cycle") == "start" and gedit_nc.axis_words_of(e) == "data"]
        if starts:
            names = [(t.address or "").upper() for t in block.tokens if t.kind == "word" and t.address and (t.value_text or "")]
            first_block = gedit_nc.cycle_block_of(starts[-1], names) == 1
    contour_groups = block.data.contour_groups
    for entry in written + running:
        cycle = _sets(entry).get("cycle")
        if (cycle == "start" and gedit_nc.axis_words_of(entry) == "data") or entry.get("group") in contour_groups:
            if entry.get("group") not in contour_groups and (along or first_block) and entry in written:
                break
            out.append(("roughing-cycle", str(entry.get("code"))))
            break
    for entry in written + running:
        cycle = _sets(entry).get("cycle")
        if cycle is not None and cycle not in ("cancel", "call-modal-next"):
            if cycle == "start" and entry in written and entry.get("group") not in contour_groups and (along or first_block):
                break
            out.append(("lathe-cycle", str(entry.get("code"))))
            break
    if first_block and not any(reason in ("roughing-cycle", "lathe-cycle") for reason, _ in out):
        out.append(("roughing-cycle", SECOND_BLOCK))
    motion = block.motion
    threaded = any(reason == "thread" for reason, _ in out)
    if _sets(motion).get("path") == "cycle" and (moving or block.motion_written) and not threaded:
        # v1.2.0 (NCF-C): the threading passes `G92`/`G78` are whole passes too; their taper
        # is part of the thread, which refuses the block on its own.
        code = str(_dict(motion).get("code"))
        if _taper_word(block) is not None:
            out.append(("single-pass-taper", code))
        elif hasattr(tracker, "pass_taper"):
            for address, along in tracker.pass_lengths_of(motion).items():
                if along != "Z":
                    continue
                found = tracker.pass_taper(address)
                if found is None:
                    continue
                value, word, _, _ = found
                if value is None or value != _ZERO:
                    out.append(("single-pass-taper", "%s, %s in force: %s" % (code, address, word)))
                    break
    return out


def _judge_cycles(block: _Block, roles: Sequence[WordRole], add: Any) -> None:
    """Contract item 6: a cycle the database describes, whose every value has a reviewed role."""
    data = block.data
    for name in block.unknown_family:
        add("cycle-not-reviewed", name)
    for entry in block.judged:
        if not any(gedit_nc.position_of(p) is not None for p in _params(entry)):
            add("cycle-not-reviewed", str(entry.get("code")))
    written = {(t.address or "").upper() for t in block.tokens if t.kind == "word" and t.address and (t.value_text or "")}
    for entry in block.judged + block.call_entries:
        others = [p["address"] for p in _params(entry) if gedit_nc.position_of(p) == "other" and data.axis_of(p["address"]) is None]
        # Positions named after an axis are the call's position in this block (`CYCL CALL
        # POS X… Y… Z…`); a call that writes none of them runs at positions kept elsewhere
        # (`CYCL CALL PAT`: a pattern or a point table), which the transform does not move.
        named = [p["address"] for p in _params(entry) if gedit_nc.position_of(p) == "other" and data.axis_of(p["address"]) is not None]
        if named and not any(address.upper() in written for address in named):
            others.extend(named)
        if others:
            add("cycle-position", "%s (%s)" % (entry.get("code"), ", ".join(others)))
    for entry in block.entries:
        # T093 (Wave Y, BL-NC-data): a DEF-active cycle with positions (Klartext cycle 20
        # CONTOUR DATA: Q5 and Q7 on the tool axis). Its parameters stand on the lines below
        # its head, which this walk reads without the cycle (no definition owns them), so it is
        # refused, as it was while the database lacked it. Moving Q5 and Q7 with the path is
        # left to the transforms' own batch.
        if entry.get("group") == "cycle" and not _sets(entry).get("cycle"):
            held = [str(p.get("address")) for p in _params(entry) if gedit_nc.position_of(p) in ("tool-axis", "other")]
            if held:
                add("cycle-position", "%s (%s)" % (entry.get("code"), ", ".join(held)))
    for entry in block.entries:
        # A code that is nothing but positions of its own (Klartext `PATTERN DEF`, plan §7 #301).
        params = _params(entry)
        if params and entry not in block.judged and entry not in block.call_entries and all(gedit_nc.position_of(p) == "other" for p in params):
            add("cycle-position", str(entry.get("code")))
    for role in roles:
        entry = role.entry
        if role.role == "cycle-position" and role.axis is None:
            add("cycle-position", role.token.text.strip())
        if entry is None or (entry not in block.judged and entry is not block.defined):
            continue
        address = (role.token.address or "").upper()
        if data.axis_of(address) is not None and not address.startswith("#"):
            continue
        found = _param([entry], address)
        if found is None or role.role == "unknown":
            add("cycle-not-reviewed", role.token.text.strip())
        elif gedit_nc.position_of(found[1]) is None:
            add("cycle-not-reviewed", role.token.text.strip())
        elif gedit_nc.position_of(found[1]) == "mode":
            literal = role.token.value
            number = gedit_nc.decimal_of(literal) if literal is not None else None
            if (role.token.value_text or "").strip() != "" and (number is None or number != 0):
                add("cycle-not-reviewed", role.token.text.strip())
    if any(r.role == "tool-axis" for r in roles) and block.plane != "XY":
        add("cycle-plane", block.plane or "")


# ---------------------------------------------------------------------------
# P4a fix B1: what the straight walk does not see, unknown keywords, system data
# ---------------------------------------------------------------------------

#: The token kinds that stand in front of a block's first word without being one.
_LEAD_KINDS = ("whitespace", "blockNumber", "skip", "comment", "continuation", "label")


def _unknown_head(block: _Block) -> Optional[str]:
    """P4a fix B1 (NC-6, plan §7 #314): a block that starts with a word of letters and no value
    that is no code of the database, no word of the profile and no axis letter (Klartext
    ``TCH PROBE 400``, ``FUNCTION PARAX MODE``, ``DECLARE STRING``): a keyword the database does
    not know. It may change how the positions after it are read (a probe that sets a datum or a
    basic rotation, a turning mode), so it is an unknown code, whether the block moves or not."""
    data = block.data
    for token in block.tokens:
        if token.kind in _LEAD_KINDS:
            continue
        if token.kind != "word" or id(token) in block.codes or id(token) in block.consumed:
            return None
        address = (token.address or "").upper()
        if (token.value_text or "") != "" or len(address) < 2 or not address.isalpha():
            return None
        if address in data.untouched or address in FK_WORDS or data.axis_of(address) is not None:
            return None
        return token.text.strip()
    return None


def _system_write(block: _Block) -> Optional[str]:
    """P4a fix B1 (NC-6, plan §7 #314): the system variable a block assigns (``$P_UIFR[1,X,TR]=10``,
    ``VZOFZ[1]=100.``, ``#5221=10.``), or ``None``. A comparison (``==``) is no assignment."""
    data = block.data
    if data.system_variables is None and data.system_from is None:
        return None
    tokens = block.tokens
    count = len(tokens)
    for i, token in enumerate(tokens):
        if token.kind != "variable":
            continue
        text = token.text.strip()
        system = False
        if data.system_variables is not None:
            match = data.system_variables.match(text)
            system = match is not None and match.end() == len(text)
        if not system and data.system_from is not None:
            digits = re.match(r"^\D*(\d+)$", text)
            system = digits is not None and int(digits.group(1)) >= data.system_from
        if not system:
            continue
        j = i + 1
        while j < count and tokens[j].kind in ("whitespace", "expression"):
            j += 1
        if j < count and tokens[j].kind == "operator" and tokens[j].text.strip() == "=":
            k = j + 1
            if k < count and tokens[k].kind == "operator" and tokens[k].text.strip() == "=":
                continue
            return text
    return None


def _scope_start(tracker: Any, data: _Data, line: int) -> int:
    """The first line of the scope: the tracker's first recorded line (the lines above a
    selection are walked unrecorded), else the first line judged here."""
    first = getattr(tracker, "first_recorded", None)
    if isinstance(first, int):
        return first
    return data.first_line if data.first_line is not None else line


def _in_plane(entry: Any) -> List[str]:
    """The parameters of ``entry`` that are an angle or a side of the working plane (NC-2)."""
    return [p["address"] for p in _params(entry) if p.get("inPlane") in ("angle", "side")]


def _rapid(block: _Block) -> bool:
    """The block moves at rapid: its motion code says so, or it writes the profile's rapid word
    (Klartext ``FMAX``)."""
    if _sets(block.motion).get("motion") == "rapid":
        return True
    rapid = block.data.rapid
    if rapid is None:
        return False
    if any(str(e.get("code") or "").upper() == rapid for e in block.entries):
        return True
    spellings = block.data.rapid_spellings
    words = [(t.address or "").upper() for t in block.tokens if t.kind in ("word", "keyword") and not (t.value_text or "")]
    if any(w in spellings for w in words):
        return True
    return any("%s %s" % pair in spellings for pair in zip(words, words[1:]))


def _changed_axes(op: Op, data: _Data) -> List[str]:
    """The axes whose positions ``op`` changes (NC-9). The lathe Z mirror's Y is left out: a
    turning program that never writes Y works on the turning axis, which the mirror keeps."""
    if isinstance(op, Translate):
        return [a for a, d in op.shift.items() if Decimal(d) != _ZERO and a in data.axes]
    if isinstance(op, LatheZMirror):
        return ["Z"]
    if isinstance(op, Mirror) and _quarter(op.degrees) is not None:
        return ["X"] if _quarter(op.degrees) in (1, 3) else ["Y"]
    return ["X", "Y"]


_MASK_BITS = {"X": 1, "Y": 2, "pole": 4}


def _mask(axes: Any) -> int:
    """The plane axes and the pole as bits; the other axes are none a rotation or a mirror
    reads a start of."""
    out = 0
    for axis in axes:
        out |= _MASK_BITS.get(axis, 0)
    return out


def _needs(block: _Block, roles: Sequence[WordRole], op: Op) -> Set[str]:
    """The axes of the plane (and ``'pole'``) whose position at the start of the block a
    rotation or a mirror reads to write the block (the start the scripts add a word from, or
    turn an increment between): what a jump, a loop or a skipped block must not leave unsure."""
    out: Set[str] = set()
    if not isinstance(op, (Rotate, Mirror)):
        return out
    exact = is_exact(op)
    both = isinstance(op, Rotate) or not exact
    plane = {"X", "Y"}
    for absolute_roles, increment in ((("point", "cycle-position"), "point-inc"), (("pole",), "pole-inc")):
        absolute = {r.axis for r in roles if r.role in absolute_roles and r.axis in plane}
        increments = {r.axis for r in roles if r.role == increment and r.axis in plane}
        if not absolute and not increments:
            continue
        if not absolute:
            if not exact:
                out |= plane  # a rounding run writes an increment between two rounded points
            continue
        if increments:
            out |= plane
        elif both and len(absolute) == 1:
            out |= plane - absolute
    if any(r.role.startswith("polar") for r in roles) or (block.pole_use and any(r.role in VECTOR_ROLES for r in roles)):
        out.add("pole")
    return out


def _flow_reasons(step: Any, block: _Block, roles: Sequence[WordRole], tracker: Any, op: Op, add: Any, found: Dict[str, Refusal]) -> None:
    """P4a fix B1 (NC-5, NC-9, NC-11; plan §7 #312, #313, #315): what the straight walk does not
    see. A jump target, a loop end or a block that may be skipped reached with another modal
    state refuses (``jump``); a block that reads a start the flow leaves unsure refuses
    (``position-unknown``, ``pole-unknown``), and so does the end of a loop or a backward jump
    whose blocks, run again from another start, read one; a rotary axis a frame code turned
    refuses a block that changes the path (``rotary-word``, ``rotary-turned``); a cut while an
    axis the operation changes has never been written refuses (``axis-unwritten``,
    ``position-unknown``)."""
    data = block.data
    line = getattr(step, "line", 0)
    name = op_name(op)
    turning = name in TURNING
    events = getattr(step, "flow", None) or ()
    unsure = getattr(step, "unsure", None) or frozenset()
    flow = getattr(tracker, "flow", None)
    needs = _needs(block, roles, op) if turning else set()
    if needs and flow is not None and getattr(flow, "recording", False):
        data.need_lines.append(line)
        data.need_masks.append(_mask(needs))
    for event in events:
        if event.kind in ("modal", "target"):
            add("jump", event.detail or "")
        elif event.kind == "reentry" and turning:
            axes = set(event.axes)
            first = _scope_start(tracker, data, line)
            if event.line < first:
                add("position-unknown", "the blocks from line %d run again from here" % event.line)
                continue
            wanted = _mask(axes)
            lines = data.need_lines
            for i in range(bisect.bisect_left(lines, event.line), len(lines)):
                if lines[i] > line:
                    break
                if data.need_masks[i] & wanted:
                    add("position-unknown", "line %d runs again from here" % lines[i])
                    break
    if unsure and needs:
        plane = sorted(a for a in needs & unsure if a != "pole")
        if plane:
            add("position-unknown", ", ".join(plane))
    if unsure and "pole" in unsure and "pole" in needs:
        add("pole-unknown")
    if unsure:
        affected = [r for r in roles if affects(r, op)]
        rotary = sorted(a for a in data.rotary_state.rotary if a in unsure)
        if affected and rotary:
            if turning:
                add("rotary-word", "%s (not known)" % rotary[0])
            elif isinstance(op, Translate) and block.interp.tcp is None:
                for role in affected:
                    turned = [a for a in data.rotary_state.turning(role.axis or "") if a in unsure]
                    if turned:
                        add("rotary-turned", turned[0])
                        break
    unwritten = getattr(step, "unwritten", None) or frozenset()
    if unwritten:
        # A feed move cuts from the block's start; a cycle runs where the block's own
        # positioning leaves the tool, so an axis the block writes is written for it.
        motion = _sets(block.motion).get("motion")
        # A block that turns only rotary axes positions them; a cut moves a linear axis.
        linear = [axis for axis, _ in (getattr(step, "moves", None) or ()) if axis not in data.rotary]
        moves = bool(linear) or getattr(step, "arc", None) is not None
        # A move to a machine position is left as written and listed (Q4-6): no cut of the path.
        cut = motion == "feed" and moves and not block.machine_entries and not _rapid(block)
        changed = _changed_axes(op, data)
        if not cut and getattr(step, "cycle", None) and "cycle-position" not in found:
            # The cycle works where the block leaves the tool in the plane; its depths come
            # from its own values, so the tool axis it starts from does not matter.
            written_here = {axis for axis, _ in (getattr(step, "moves", None) or ())}
            unwritten = frozenset(unwritten - written_here)
            changed = [a for a in changed if a != block.tool_axis]
            cut = True
        if cut:
            for axis in changed:
                if axis in unwritten:
                    add("axis-unwritten" if isinstance(op, Translate) else "position-unknown", axis)
                    break


def _tool_direction_turned(block: _Block, role: WordRole, op: Op) -> bool:
    """FB-2: whether ``role`` is a component of the tool direction (an arc-centre word that a
    code of the block, or a mode in force, declares as its own: Fanuc `G43.5 … I J K`) that a
    turn or a mirror would change: a component along an axis the operation moves, written as
    anything but 0."""
    address = (role.token.address or "").upper()
    # A word read as an arc centre has a centre role; the tool direction is a count kept as
    # written, owned by a code that is neither the move nor a cycle (an Okuma `G2` declares
    # its `I` and `K` too, as arc centres).
    if role.role != "untouched" or role.number_class != "count" or role.entry is None or address not in block.data.centre_words:
        return False
    if _dict(role.entry).get("group") in ("cycle", "motion"):
        return False
    if not gedit_nc.redefines_arc_centre(role.entry, block.data.profile):
        return False
    axis = _nc_path.CENTRE_AXIS.get(address)
    moved = lathe_mirror_axes(op) if isinstance(op, LatheZMirror) else ("X", "Y")
    if axis not in moved:
        return False
    literal, _ = _nc_path.literal_of(role.token)
    if literal is None:
        return True
    return ((literal.int_part or "") + (literal.frac_part or "")).strip("0") != ""


def refusals_of(
    step: "_nc_path.Step",
    roles: Sequence[WordRole],
    tracker: "_nc_path.PathTracker",
    op: Op,
    context: Dict[str, Any],
) -> List[Refusal]:
    """Why ``step`` cannot be changed by ``op``: the reasons of :data:`REASONS` that apply, in the
    table's order. Empty when the block can be changed (or needs no change). The cycle groups and
    the selection (contract items 6, 7) are the script's walk; a script passes each member's
    refusal on to the others. A rotary axis the program has not written yet (its position
    unknown) is the script's to judge at the end of its walk, as address arithmetic does; what
    is decided here is a rotary axis known to stand turned (``rotary-turned``)."""
    name = op_name(op)
    block = _block_of(step, tracker)
    data = block.data
    line = getattr(step, "line", 0)
    if data.first_line is None:
        data.first_line = line
    found: Dict[str, Refusal] = {}

    def add(reason: str, detail: str = "") -> None:
        if reason not in found and name in REASONS[reason][0]:
            found[reason] = Refusal(line, reason, block.written, detail)

    affected = [r for r in roles if affects(r, op)]
    positions = [r for r in roles if r.role in VECTOR_ROLES or r.role.startswith("polar")]
    moving = bool(affected) or bool(positions) or block.motion_written or bool(getattr(step, "moves", None))
    lathe_z = isinstance(op, LatheZMirror)

    # The machine kind and the plane (Q4-2, Q4-3).
    if moving:
        if name == "rotate" and data.lathe:
            add("lathe-rotate")
        if name == "mirror" and data.lathe:
            add("lathe-x-mirror")
        if lathe_z and not data.lathe:
            add("mill-z-mirror")
        if found:
            # The transform does not exist for this kind of machine: that is the one reason.
            return list(found.values())
    if affected and name in TURNING and not found:
        # The plane rule is the mill's (and, in ZX, the lathe Z mirror's); a transform the
        # machine kind already refuses says that instead.
        wanted = "ZX" if lathe_z else "XY"
        if block.plane != wanted:
            add("plane", block.plane or "not known")

    # Frames, shifts, settings, machine positions. A code that opens a frame refuses only
    # where the modal state has a frame opened by this block: written as its reset (bare
    # `ROT`, `CYCLE800()`, `PLANE SPATIAL SPA+0 SPB+0 SPC+0`, `CYCL DEF 10.1 ROT+0`, an empty
    # `CYCL DEF 8.1`) it closes the frame instead, and the blocks after it are not in one
    # (plan §7 #299).
    opened = [f for f in block.interp.open_frames if f.get("line") == line]
    if opened and any(gedit_nc.frame_of(entry) == "open" for entry in block.entries):
        add("frame", str(opened[-1].get("code")))
    frame = block.interp.frame
    if frame is not None and moving:
        add("frame", "%s (line %d)" % (frame.get("code"), frame.get("line")))
    for entry in block.entries:
        setting = entry.get("shift") is True or (gedit_nc.axis_words_of(entry) == "data" and entry.get("group") == "offset")
        if not setting:
            continue
        if _writes_tool_offset(block, entry):
            continue  # a tool offset (`G10 L10`-`L13`), no coordinate system (T013)
        values = _writes_values(block, axes_only=not (entry.get("wordsAreData") is True))
        if values and entry.get("shiftZeroIsNone") is True and _all_zero(block):
            continue  # the reset of the shift, or an addition of nothing (§7 #299)
        unplaced = [r.token.text.strip() for r in roles if r.role == "unknown" and (r.token.value_text or "")]
        if values or unplaced:
            # A value nobody describes in a shift block (Klartext `CYCL DEF 7.1 #5`, a line
            # of the datum table) is a shift too.
            add("coordinate-shift", str(entry.get("code")))
    if block.machine_entries:
        change = _machine_change(block, roles, tracker, op, context)
        if change is None or change:
            add("intermediate-point", str(block.machine_entries[0].get("code")))

    # A system variable written by the program (NC-6): its own data, perhaps a datum.
    system = _system_write(block)
    if system is not None:
        add("coordinate-shift", system)

    # The program.
    call = _line_has_call(block)
    if call is not None:
        add("call", call)
    if getattr(step, "unknown_codes", None):
        add("unknown-code", step.unknown_codes[0])
    else:
        head = _unknown_head(block)
        if head is not None:
            add("unknown-code", head)
    for role in affected:
        if role.role in SWAPPED_ROLES:
            continue
        token = role.token
        literal, _ = _nc_path.literal_of(token)
        if literal is None:
            add("expression", token.text.strip())
            continue
        value, readings = read_word(role, tracker, block.units, context)
        if value is None:
            add("distance-assumed" if _reading(token, block.interp, data, role) == "unknown" else "machine-dependent", token.text.strip())
    for role in affected:
        if role.role in ("point", "point-inc", "cycle-position", "tool-axis", "pole", "pole-inc"):
            address = (role.token.address or "").upper()
            if block.mode_from_distance(role.token, address) and block.distance_assumed():
                add("distance-assumed", role.token.text.strip())
    before = _dict(getattr(step, "before", None))
    if isinstance(op, Translate):
        shifted = [a for a, d in op.shift.items() if Decimal(d) != _ZERO and a in data.axes]
        # An incremental move along a shifted axis from a start nobody knows stays where it
        # is; an axis the block does not move incrementally does not matter (plan §7 #303).
        moved = {r.axis for r in roles if r.role == "point-inc" and r.axis is not None}
        for axis in shifted:
            if axis in moved and before.get(axis) is None:
                add("axis-unwritten", axis)
        if block.tool_axis in shifted:
            # v1.2.0 (NCR-9b): a cycle called with a level on the tool axis left empty (or left
            # out) reads it as 0, which the shift cannot move; its twin written (`DPR` for `DP`)
            # gives the depth instead.
            for token in block.tokens:
                code_of = block.codes.get(id(token)) if token.kind == "call" else None
                if code_of is None:
                    continue
                empty = _nc_path.empty_levels(token, code_of[0])
                if empty:
                    add("cycle-level-empty", "%s %s" % (code_of[1], ", ".join(empty)))
                    break
    if isinstance(op, Rotate) or (isinstance(op, Mirror) and _quarter(op.degrees) is None):
        written_axes = {r.axis for r in roles if r.role in ("point", "cycle-position") and r.axis in ("X", "Y")}
        if len(written_axes) == 1:
            other = "Y" if "X" in written_axes else "X"
            if before.get(other) is None:
                add("position-unknown", other)

    # Words nobody describes; rotary axes.
    fk = [t.text.strip() for t in block.tokens if t.kind == "word" and (t.address or "").upper() in FK_WORDS and not (t.value_text or "")]
    if fk:
        add("fk-contour", fk[0])
    elif moving:
        for role in roles:
            if role.role != "unknown":
                continue
            if name in TURNING or gedit_nc.is_assignment(role.token):
                add("word-unknown", role.token.text.strip())
    if name in TURNING:
        # FB-2 (T120): under a mode that makes I, J and K its own words (Fanuc `G43.5`, `G41.6`,
        # `G42.6`), in its own block and in the blocks it governs, they are the tool direction.
        # A turn or a mirror would have to turn it with the path, which gEdit does not do, so
        # such a word is one it cannot place, as it was before T120 read it. A component the
        # operation leaves alone, or one written as 0, needs nothing.
        for role in roles:
            if _tool_direction_turned(block, role, op):
                add("word-unknown", role.token.text.strip())
        # AD-31's rotary rule, for a turn or a mirror about the tool axis (plan §7 #300): a
        # rotary word is fine while it leaves its axis at 0 (`A0 C0`, `G0 B0.`); an axis that
        # ends anywhere else, or that stands turned (or not known) while the block moves the
        # path, would need its angle changed too.
        after = _dict(getattr(step, "after", None))
        for role in roles:
            if role.role in VECTOR_ROLES and role.axis is not None and (role.axis in data.rotary or (role.token.address or "").upper() in data.rotary):
                value = after.get(role.axis)
                if value is None or Decimal(value) != _ZERO:
                    add("rotary-word", role.token.text.strip())
        if affected:
            for rotary in sorted(data.rotary_state.rotary):
                for value in (before.get(rotary), after.get(rotary)):
                    if value is not None and Decimal(value) != _ZERO:
                        add("rotary-word", "%s%s" % (rotary, _trim(Decimal(value))))
    # Review round (SK-1): :func:`observe` reads a block after it was judged, so a block that
    # itself changes the zero point (`G55 G91 G1 X5 Y5`) counts every axis as pending for its
    # own increments: they travel the change of the offset too.
    shift_pending = _linear_axes(data) if data.increment_travels_shift and _shifts_zero(step) else data.shift_pending
    if name in TURNING and shift_pending:
        # D6-7 (SD42440): an increment along an axis the transform changes, while one of
        # those axes has not been written absolutely since the last shift.
        pending = [a for a in _changed_axes(op, data) if a in shift_pending]
        if pending and any(r.role == "point-inc" for r in affected):
            add("shift-increment", ", ".join(pending))
    if isinstance(op, Translate) and block.interp.tcp is None and affected:
        after = _dict(getattr(step, "after", None))
        for role in affected:
            for rotary in data.rotary_state.turning(role.axis or ""):
                for value in (before.get(rotary), after.get(rotary)):
                    if value is not None and Decimal(value) != _ZERO:
                        add("rotary-turned", rotary)

    # Cycles (contract item 6); under the lathe Z mirror the case list of item 7 instead.
    if lathe_z:
        for reason, detail in _lathe_reasons(block, moving, tracker):
            add(reason, detail)
        if "roughing-cycle" not in found and contour_flips(block, roles, op) is None:
            # T015: a word of a roughing cycle along the turned axis that the code does not
            # declare for this block: its sign cannot be judged.
            add("roughing-cycle", "")
        # P4a fix B1 (NC-8, plan §7 #316): a value whose sign is the direction of the next
        # move (Okuma `G75 L-2.`) would have to change in some blocks and not in others.
        written_words = {(t.address or "").upper() for t in block.tokens if t.kind == "word" and (t.value_text or "")}
        for entry in block.entries:
            signed = [p["address"] for p in _params(entry) if p.get("signOf") == "next-move" and p["address"].upper() in written_words]
            if signed:
                add("chamfer-sign", "%s %s" % (entry.get("code"), signed[0]))
    else:
        _judge_cycles(block, roles, add)
        # P4a fix B1 (NC-2, plan §7 #311): a pocket, slot or stud turned or placed by an angle or
        # a corner of its own; refused where it is defined and where it is called.
        cycles = list(block.judged)
        defined = block.defined
        if defined is not None and defined not in cycles and (block.call_entries or getattr(step, "cycle", None) == defined.get("code")):
            cycles.append(defined)
        for entry in cycles:
            angles = _in_plane(entry)
            if angles:
                add("cycle-angle", "%s (%s)" % (entry.get("code"), ", ".join(angles)))
                break

    # Arcs.
    arc = block.arc
    if arc is not None and moving:
        code = str(arc.get("code"))
        if code in _nc_path.UNRESOLVED_ARCS:
            # Wave Y (T016): a tangential arc (Klartext `CT`, `CTP`, Sinumerik `CT`) and an arc
            # through an intermediate point (`CIP`) follow from the path around them: the
            # tangent of the element before, or the point they pass. Under an exact operation
            # (a quarter turn, a mirror in an axis, the lathe Z mirror) those turn or reflect
            # exactly with the path, so the arc is the transformed arc; only a rounding one,
            # which the arc check cannot follow through such an arc, refuses it.
            if not is_exact(op):
                add("arc-tangential", code)
        elif gedit_nc.arc_direction_of(arc) is None and not data.direction_words:
            add("arc-unsupported", code)
        elif gedit_nc.arc_direction_of(arc) is not None and any(
            r.role == "radius" and (r.token.address or "").upper() not in _nc_path.RADIUS_WORDS for r in roles
        ):
            # Wave Y (T017): an arc by the radius its code declares (the Okuma `L`, with or
            # without `CALRG`) keeps its radius and its choice of the arc under every exact
            # operation, as `R` does (the prelude's case list): the end points move, a mirror
            # swaps the direction. A rounding one would need the arc checked against a radius
            # the tracker reads only without `CALRG`: refused there.
            declared = _nc_path.declared_radius(arc)
            plain = all(
                (r.token.address or "").upper() == declared
                for r in roles
                if r.role == "radius" and (r.token.address or "").upper() not in _nc_path.RADIUS_WORDS
            )
            if not (plain and declared is not None and is_exact(op)):
                add("arc-unsupported", code)
    if name in ("mirror", "lathe-z-mirror"):
        for role in roles:
            if role.role == "code-arc" and swap_partner(role.entry or {}, data.codes, "arcDirection") is None:
                add("swap-unknown", role.token.text.strip())
            elif role.role == "code-comp" and swap_partner(role.entry or {}, data.codes, "compSide") is None:
                add("swap-unknown", role.token.text.strip())
            elif role.role == "direction" and swap_word(role.token.text, data.profile) is None:
                add("swap-unknown", role.token.text.strip())
        for entry in block.entries:
            if _sets(entry).get("radiusComp") == "on" and gedit_nc.comp_side_of(entry) is None:
                add("swap-unknown", str(entry.get("code")))
    if block.pole_use and (positions or getattr(step, "moves", None)):
        # A pole code that moves nothing (a bare `C`, as `M138 A C` names the rotary axes) is
        # no move around the pole.
        pair = _nc_path.PLANE_AXES.get(block.plane or "")
        pole = _dict(getattr(step, "pole", None))
        if pair is None or any(pole.get(axis) is None for axis in pair):
            add("pole-unknown")
        else:
            # P4a fix B1 (NC-4, plan §7 #322): a pole set above the selection is not moved
            # with it, so no move around it may be, whatever the operation.
            set_at = getattr(step, "pole_line", 0) or 0
            first = _scope_start(tracker, data, line)
            if set_at and set_at < first:
                add("pole-unknown", "set on line %d" % set_at if set_at else "")

    _flow_reasons(step, block, roles, tracker, op, add, found)

    return sorted(found.values(), key=lambda r: _REASON_ORDER[r.reason])


def notes_of(
    step: "_nc_path.Step",
    roles: Sequence[WordRole],
    tracker: "_nc_path.PathTracker",
    op: Op,
    context: Dict[str, Any],
) -> List[Refusal]:
    """The information rows of :data:`INFO` for ``step`` (the block is left as written, or a word
    of it, and the run still writes): a machine position or an incremental return the transform
    does not move (``machine-position``, Q4-6), a plain word nobody describes under translate
    (``word-left``). ``rounded`` is the script's count of :attr:`Written.rounded`."""
    name = op_name(op)
    block = _block_of(step, tracker)
    line = getattr(step, "line", 0)
    out: List[Refusal] = []
    if block.machine_entries and _writes_values(block, axes_only=True):
        if _machine_change(block, roles, tracker, op, context) is False:
            out.append(Refusal(line, "machine-position", block.written, str(block.machine_entries[0].get("code"))))
    if block.blank and name in INFO["blank"][0] and not block.data.blank_noted:
        # Q-D (2026-10-16, plan §7 #318): the blank is left as written; said once per run.
        block.data.blank_noted = True
        out.append(Refusal(line, "blank", block.written, "BLK FORM"))
    if name == "translate":
        moving = any(r.role in VECTOR_ROLES for r in roles) or block.motion_written
        for role in roles:
            if moving and role.role == "unknown" and not gedit_nc.is_assignment(role.token):
                out.append(Refusal(line, "word-left", block.written, role.token.text.strip()))
                break
        data = block.data
        affected = [r for r in roles if affects(r, op)]
        if data.tcp_table and not data.tcp_noted and block.interp.tcp is not None and affected:
            # D6-4: said once per run, at the first block the shift moves under TCP.
            data.tcp_noted = True
            out.append(Refusal(line, "tcp-table", block.written, ""))
        if data.cycle_r_with and affected:
            left = _cycle_r_left(block, context)
            if left is not None:
                out.append(Refusal(line, "cycle-r-left", block.written, left))
    return out


def _cycle_r_left(block: "_Block", context: Dict[str, Any]) -> Optional[str]:
    """NC-9: the ``R`` word a drilling cycle of ``block`` writes and the shift leaves (``position:
    'none'``), on a machine whose point-less-feeds choice is one the profile names in
    ``syntax.cycleRAbsoluteWith`` (the Series 15 format, where parameter 5102 bit 6 can make R
    an absolute position); ``None`` otherwise."""
    data = block.data
    kept = [
        p for e in block.cycles for p in _params(e)
        if str(p.get("address") or "").upper() == "R" and p.get("position") == "none"
    ]
    if not kept:
        return None
    word = next((t for t in block.tokens if t.kind == "word" and (t.address or "").upper() == "R" and (t.value_text or "").strip()), None)
    if word is None:
        return None
    number_input = _dict(_dict(data.machine_of(context).get("params")).get("numberInput"))
    classes = _dict(number_input.get("classes"))
    for choice in data.feed_choices:
        if choice.get("value") not in data.cycle_r_with:
            continue
        steps = _dict(choice.get("classes"))
        if not steps:
            continue
        if all(
            (_dict(classes.get(cls)).get("mode") or number_input.get("mode")) == "increment"
            and _dict(classes.get(cls)).get("increment") == _dict(step).get("increment")
            for cls, step in steps.items()
        ):
            return word.text.strip()
    return None


# ---------------------------------------------------------------------------
# The arc check of AD-44
# ---------------------------------------------------------------------------


def check_arcs(arcs: Sequence["_nc_path.Arc"], units: str) -> List[Refusal]:
    """The arc check of AD-44 on the arcs of the **written** program (the tracker run over the
    result, so each start is the end the control will see): ``arc-check`` for every arc whose
    radii (``_nc_path.arc_radii``) differ by more than :data:`ARC_TOLERANCE`. A radius arc's
    chord is checked by :func:`check_chord` (its centre is computed from the radius, so its two
    radii agree by construction)."""
    tolerance = ARC_TOLERANCE.get(units, ARC_TOLERANCE["mm"])
    out: List[Refusal] = []
    for arc in arcs:
        start, end = _nc_path.arc_radii(arc)
        if abs(start - end) > tolerance:
            out.append(Refusal(arc.line, "arc-check", "", "%s at the start, %s at the end" % (_trim(start), _trim(end))))
    return out


def check_chord(line: int, start: Tuple[Decimal, Decimal], end: Tuple[Decimal, Decimal], radius: Decimal, units: str) -> Optional[Refusal]:
    """The arc check of a radius arc (``R``, ``CR=``) after rounding: the chord from ``start`` to
    ``end`` (the written end points, coordinates of the plane) may exceed the diameter by at
    most :data:`ARC_TOLERANCE`; otherwise ``arc-check`` at ``line``."""
    tolerance = ARC_TOLERANCE.get(units, ARC_TOLERANCE["mm"])
    chord = _nc_path.distance(end[0] - start[0], end[1] - start[1])
    if chord - _TWO * abs(Decimal(radius)) > tolerance:
        return Refusal(line, "arc-check", "", "chord %s, radius %s" % (_trim(chord), _trim(abs(Decimal(radius)))))
    return None


# ---------------------------------------------------------------------------
# Findings (contract item 8)
# ---------------------------------------------------------------------------


def finding_of(item: Refusal) -> Dict[str, Any]:
    """A refusal of :data:`REASONS` (``severity: 'error'``) or a row of :data:`INFO`
    (``'info'``) as a finding: the block as written, ``": "``, the text and a full stop."""
    if item.reason in REASONS:
        severity, text = "error", REASONS[item.reason][1]
    elif item.reason in INFO:
        severity, text = "info", INFO[item.reason][1]
    else:
        raise ValueError("not a reason of _nc_geom: %r" % item.reason)
    message = "%s: %s." % (item.written, text) if item.written else "%s%s." % (text[0].upper(), text[1:])
    return {"line": item.line, "severity": severity, "message": message, "reason": item.reason}


def warning_of(reason: str, line: int) -> Dict[str, Any]:
    """A warning of :data:`WARNINGS` as a finding: the text with a capital and a full stop."""
    text = WARNINGS[reason][1]
    return {"line": line, "severity": "warning", "message": "%s%s." % (text[0].upper(), text[1:]), "reason": reason}


__all__ = [
    "ABSOLUTE_ROLES",
    "ALL_OPS",
    "ARC_TOLERANCE",
    "FK_WORDS",
    "INCREMENTAL_ROLES",
    "INFO",
    "COUNTER_SPINDLE_VARIANT",
    "COUNTER_SPINDLE_Y_STAYS",
    "LATHE_MIRROR_AXES",
    "LatheZMirror",
    "MAX_DECIMALS",
    "MIN_DECIMALS",
    "Mirror",
    "OPS",
    "Op",
    "REASONS",
    "ROLES",
    "Refusal",
    "Rotate",
    "SWAPPED_ROLES",
    "TURNING",
    "Translate",
    "VECTOR_ROLES",
    "WARNINGS",
    "WordRole",
    "Written",
    "affects",
    "check_arcs",
    "check_chord",
    "contour_flips",
    "counter_spindle_y_turns",
    "finding_of",
    "is_exact",
    "lathe_mirror_axes",
    "notes_of",
    "observe",
    "op_name",
    "partner_text",
    "read_word",
    "refusals_of",
    "roles_of",
    "set_block_numbers",
    "swap_partner",
    "swap_word",
    "transform",
    "warning_of",
    "write_added",
    "write_word",
]
