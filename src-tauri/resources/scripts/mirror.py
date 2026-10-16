#!/usr/bin/env python3
# /// gedit
# name = "Mirror"
# description = "Mirrors a milling program's path in the XY plane: in X, in Y, or about a line at an angle. On a turning program, mirrors it in Z for the counter spindle. Points, arc centres and incremental moves mirror, and G2/G3 and G41/G42 swap. The result says that climb milling became conventional milling (on a lathe: set the tool nose direction for the counter spindle). If one block cannot be mirrored safely, nothing is changed and every such block is listed."
# input = "selection-or-document"
# output = "replace"
# timeout = 900
# envelope = true
#
# [[params]]
# id = "about"
# type = "choice"
# label = "Mirror"
# help = "Automatic mirrors a turning program in Z for the counter spindle and a milling program in X. In X flips the X values about the line through Point X parallel to Y; in Y flips the Y values about the line through Point Y parallel to X. A turning program can only be mirrored in Z, for the counter spindle."
# default = "auto"
# choices = [
#   { label = "Automatic (in Z on a turning program, in X on a milling program)", value = "auto" },
#   { label = "In X (about a line parallel to Y)", value = "y-axis" },
#   { label = "In Y (about a line parallel to X)", value = "x-axis" },
#   { label = "About a line at an angle", value = "line" },
#   { label = "In Z for the counter spindle (turning)", value = "z" }
# ]
#
# [[params]]
# id = "px"
# type = "number"
# label = "Point X"
# help = "The X the mirror line goes through, in the program's units (in X: X' = 2 x Point X - X)."
# default = 0
# decimals = 6
#
# [[params]]
# id = "py"
# type = "number"
# label = "Point Y"
# help = "The Y the mirror line goes through, in the program's units (in Y: Y' = 2 x Point Y - Y)."
# default = 0
# decimals = 6
#
# [[params]]
# id = "angle"
# type = "number"
# label = "Line angle (degrees)"
# help = "Only for a line at an angle: its angle from the X axis, counter-clockwise positive. 0, 90, 180 and 270 are exact; any other angle rounds the words and checks the arcs."
# default = 0
# decimals = 6
#
# [[params]]
# id = "z0"
# type = "number"
# label = "Mirror Z (turning)"
# help = "Only for the Z mirror: the Z the program is mirrored about (Z' = 2 x Mirror Z - Z)."
# default = 0
# decimals = 6
#
# [[params]]
# id = "decimals"
# type = "choice"
# label = "Decimal places"
# help = "Only for a line at an angle that is not a multiple of 90 degrees. As written keeps each word's own decimals, with at least 3 in mm and 4 in inch; 3 or 4 writes every rounded word with a point with that many (an inch program keeps at least 4). A word without a point stays whole increments where the machine reads it in increments; where the machine reads numbers as written, a rounded word gets a point and 3 decimals in mm, 4 in inch."
# default = "keep"
# choices = [
#   { label = "As written", value = "keep" },
#   { label = "3", value = "3" },
#   { label = "4", value = "4" }
# ]
# ///
"""Mirror (Phase 4 plan §5 P4a, P4.4; AD-41 to AD-44; exit criteria X21 and X22).

Mirrors the path of a program and hands it back through the ``envelope`` output. The script
walks the program with the path tracker (``_nc_path``) and asks the transform rules
(``_nc_geom``) what every word is; it keeps no list of codes of its own. The golden format,
the form ids and the message are ``tests/fixtures/scripts/README.md``, "The geometry goldens".

On a milling program (Q4-3: the XY plane only)
-----------------------------------------------
``about`` chooses the mirror line: ``y-axis`` (the line through ``px`` parallel to Y, so X
flips: ``X' = 2·px − X``), ``x-axis`` (through ``py`` parallel to X, so Y flips) or ``line``
(through ``px``, ``py`` at ``angle`` degrees from X). Points, cycle positions, the Klartext
pole ``CC`` and absolute arc centres reflect; incremental moves and arc centre vectors
(``I``, ``J``) reflect as vectors; ``PA`` becomes ``2·angle − PA`` and ``IPA`` changes sign.
Radii keep their value and sign (a mirror keeps the angle an arc spans), and so do the
Sinumerik opening angle ``AR=``, ``TURN=``, the Klartext ``CCA`` and ``LEN`` and the axes outside
the plane. **The arc direction and the compensation side swap from data** (AD-42): a code
with ``CodeSets.arcDirection`` becomes the one code of its group with the other direction
(``G2``↔``G3``, written in the style of the code it replaces: ``G02`` → ``G03``), a code with
``CodeSets.compSide`` the one with the other side (``G41``↔``G42``, Klartext ``RL``↔``RR``), and
the Klartext direction word follows ``addresses.arcDirectionWords`` (``DR+``↔``DR-``). A code
with no single partner refuses the run (``swap-unknown``).

A mirror reverses the cutting direction: climb milling becomes conventional milling. The
result says so in one warning (``climb-milling``, Q4-7); the path is not reversed. A helical
move turns the other way, so a thread milled with it changes hand (``helix-hand``).

The axis mirrors write only the words that were there (AD-44) and are exact on the decimal
text: nothing is rounded, and a result that does not fit the word refuses the run
(``resolution``). A line at another angle writes X and Y on every block that now moves in
both, rounds each word half away from zero and checks every arc of the written program, as
``rotate.py`` does (``arc-check``).

On a turning program (Q4-2): the Z mirror for the counter spindle
----------------------------------------------------------------
``about = "z"`` mirrors Z about ``z0`` (``Z' = 2·z0 − Z``) in the ZX plane (``G18``): an
incremental Z and ``W`` and the centre word along Z (``K``) change sign; a ``Y`` changes sign
about the turning axis (``Y' = −Y``), and so do an incremental Y and ``J`` (the owner's decision
Q-B, ``_nc_geom.LATHE_MIRROR_AXES``); ``X``, ``U``, ``I`` and the radii stay; ``G2``↔``G3`` and ``G41``↔``G42`` swap from data. It is exact. A thread, a
roughing cycle, any other turning, grooving or drilling cycle and a single pass with a taper
refuse the run (``thread``, ``roughing-cycle``, ``lathe-cycle``, ``single-pass-taper``; the
prelude's case list, plan §5 P4a item 5); Sinumerik ``DIAMON``/``DIAMOF``/``DIAM90`` refuse
nothing, because the Z mirror reads no X. The result carries the warning ``tool-nose``: the
tool nose direction is a number in each tool's offset, not in the program. A turning program
is not mirrored in X (``lathe-x-mirror``), and the Z mirror is not for a milling program
(``mill-z-mirror``). ``about = "auto"`` (the form's first choice), or left empty, is ``z`` on a
turning profile and ``y-axis`` on a milling one.

Settled defaults (the owner's answers of 2026-10-12, plan §9)
--------------------------------------------------------------

* **Q4-1, all or nothing.** A run that meets one refused block writes **nothing** and lists
  **every** refused block with its line and its reason. The input is handed back unchanged,
  so the app makes no edit and no undo step.
* **Q4-2, the lathe**: the Z mirror for the counter spindle, as above; no X mirror.
* **Q4-3, planes.** On a mill, XY only (``plane``); the lathe Z mirror needs ``G18``.
* **Q4-4, rounding and the arc tolerance.** Exact where the line is parallel to an axis and
  for the Z mirror; elsewhere each word is rounded and every arc checked (0.002 mm,
  0.0001 in).
* **Q4-5, the distance mode.** From the program or the machine's power-on mode; a mode only
  assumed from the profile refuses the run (``distance-assumed``).
* **Q4-6, returns and machine positions.** ``G53``, ``M91``, ``SUPA`` and an incremental
  ``G28``/``G30`` return of zero are left and listed as information (``machine-position``); an
  intermediate point the mirror would move refuses the run (``intermediate-point``).
* **Q4-7, the cutting direction.** A warning only; the path is not reversed.

A selection is primed with the lines above it (``input.precedingLines``); one whose lines
above were not sent refuses the run (``selection-unprimed``). One that starts or ends inside a
cycle or a block that runs over several lines refuses the run (``selection-inside``); so does
one whose blocks run under an arc direction or a compensation side set above it
(``selection-mode``: the mirror would have to swap a code it cannot see). The first move of a
selection starts where the lines above leave the tool, a point the mirror does not move: a move
to an absolute point is written with the other axis too, an arc or an incremental move there
refuses the run, and so does, on a lathe, a first move without Z, or without Y while the tool
stands away from Y0 (``selection-start``). The Klartext workpiece blank (``BLK FORM``) is left as
written, with one information row per run (``blank``, the owner's decision Q-D).
Everything outside the words it changes is handed back byte for byte.
"""

from __future__ import annotations

import sys
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Sequence, Tuple

import gedit_nc
import _nc_geom
import _nc_path

#: The script's name in an error on stderr.
SCRIPT = "Mirror"

#: The mirror lines of the form.
ABOUT = ("auto", "y-axis", "x-axis", "line", "z")


class Params:
    """The form, checked. A value that cannot be used is an error, not a guess."""

    def __init__(self, values: Dict[str, Any], profile: Dict[str, Any]) -> None:
        self.lathe = gedit_nc.machine_type_of(profile) == "lathe"
        about = values.get("about")
        if about not in (None, "") and about not in ABOUT:
            raise ValueError("Mirror: %r is not auto, y-axis, x-axis, line or z." % (about,))
        if about in (None, "", "auto"):
            about = "z" if self.lathe else "y-axis"
        self.about = about
        self.px = number_param(values, "px", "Point X")
        self.py = number_param(values, "py", "Point Y")
        self.angle = number_param(values, "angle", "Line angle")
        self.z0 = number_param(values, "z0", "Mirror Z")
        self.decimals = decimals_param(values)

    def op(self) -> Any:
        if self.about == "z":
            return _nc_geom.LatheZMirror(self.z0)
        degrees = {"x-axis": Decimal(0), "y-axis": Decimal(90)}.get(self.about, self.angle)
        return _nc_geom.Mirror((self.px, self.py), degrees)

    def headline(self) -> str:
        if self.about == "z":
            return "Mirrored in Z about Z%s for the counter spindle" % trim(self.z0)
        if self.about == "y-axis":
            return "Mirrored in X about X%s" % trim(self.px)
        if self.about == "x-axis":
            return "Mirrored in Y about Y%s" % trim(self.py)
        return "Mirrored about the line through X%s Y%s at %s°" % (trim(self.px), trim(self.py), trim(self.angle))

    def verb(self) -> str:
        return "mirrored for the counter spindle" if self.about == "z" else "mirrored"


# ===========================================================================
# The run: the same text in rotate.py and mirror.py, from here to the end of
# the file (``tests/python/test_mirror.py`` holds the two copies to each other).
# ===========================================================================

_ZERO = Decimal(0)
INCH = Decimal("25.4")
#: The plane rotate and the mill mirror work in (Q4-3).
PLANE = ("X", "Y")
#: The centre word of each axis of the plane (the inverse of ``_nc_path.CENTRE_AXIS``).
CENTRE_WORD = {axis: word for word, axis in _nc_path.CENTRE_AXIS.items()}
#: The most findings a run hands back; the message counts the rest (the app takes 1000).
MAX_FINDINGS = 1000
QUOTE_LENGTH = _nc_geom.QUOTE_LENGTH

#: What the message calls a refused block, by reason: (one, several).
REASON_LABEL = {
    "frame": ("block in a frame", "blocks in a frame"),
    "coordinate-shift": ("coordinate setting or shift", "coordinate settings or shifts"),
    "intermediate-point": ("return through an intermediate point", "returns through an intermediate point"),
    "call": ("subprogram or macro call", "subprogram or macro calls"),
    "jump": ("block a jump or a loop may reach with other settings", "blocks a jump or a loop may reach with other settings"),
    "expression": ("block with a variable or a calculation", "blocks with a variable or a calculation"),
    "machine-dependent": ("block whose reading depends on the machine", "blocks whose reading depends on the machine"),
    "distance-assumed": ("block with an assumed distance mode", "blocks with an assumed distance mode"),
    "axis-unwritten": ("block with an axis not written yet", "blocks with an axis not written yet"),
    "position-unknown": ("block whose start is not known", "blocks whose start is not known"),
    "unknown-code": ("block with an unknown code", "blocks with an unknown code"),
    "word-unknown": ("block with a word gEdit cannot place", "blocks with a word gEdit cannot place"),
    "rotary-word": ("block with a rotary axis away from 0", "blocks with a rotary axis away from 0"),
    "rotary-turned": ("block with a turned rotary axis", "blocks with a turned rotary axis"),
    "selection-inside": ("block cut by the selection", "blocks cut by the selection"),
    "selection-mode": ("block under a direction or side set above the selection", "blocks under a direction or side set above the selection"),
    "cycle-not-reviewed": ("cycle not reviewed", "cycles not reviewed"),
    "cycle-position": ("cycle with positions of its own", "cycles with positions of their own"),
    "cycle-angle": ("cycle with an angle or a corner of its own", "cycles with an angle or a corner of their own"),
    "cycle-plane": ("cycle outside the XY plane", "cycles outside the XY plane"),
    "fk-contour": ("free contour (FK) block", "free contour (FK) blocks"),
    "arc-tangential": ("tangential arc or arc through a point", "tangential arcs or arcs through a point"),
    "arc-unsupported": ("arc gEdit cannot compute", "arcs gEdit cannot compute"),
    "swap-unknown": ("direction or side with no opposite code", "directions or sides with no opposite code"),
    "arc-check": ("arc off its radius after rounding", "arcs off their radius after rounding"),
    "resolution": ("word that does not fit its form", "words that do not fit their form"),
    "pole-unknown": ("move around a pole that is not known", "moves around a pole that is not known"),
    "plane": ("block outside the working plane", "blocks outside the working plane"),
    "lathe-rotate": ("block of a turning program", "blocks of a turning program"),
    "lathe-x-mirror": ("block of a turning program", "blocks of a turning program"),
    "mill-z-mirror": ("block of a milling program", "blocks of a milling program"),
    "thread": ("thread block", "thread blocks"),
    "roughing-cycle": ("roughing cycle block", "roughing cycle blocks"),
    "lathe-cycle": ("turning cycle block", "turning cycle blocks"),
    "single-pass-taper": ("taper pass", "taper passes"),
    "chamfer-sign": ("chamfer or corner round whose sign sets the next move", "chamfers or corner rounds whose sign sets the next move"),
    "selection-start": ("first move of the selection that would miss the moved path", "first moves of the selection that would miss the moved path"),
}

#: The refusals of the run itself, beside ``_nc_geom.REASONS``: id -> the plain text after
#: "<as written>: " (plan §7, the P4a fix round).
RUN_REASONS = {
    "selection-start": (
        "this first move of the selection starts where the lines above the selection leave the "
        "tool, and that point is not moved with the selection, so an arc, an incremental move or "
        "(on a lathe) a move without Z, or without Y away from the turning axis, from there would "
        "miss the moved path. Start the selection at a block that moves to an absolute position, "
        "with Z on a lathe (and Y where Y is not 0)"
    ),
}


def as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def trim(value: Decimal) -> str:
    """A number as the message shows it: ``90``, ``-12.5``, ``0``."""
    if value == _ZERO:
        return "0"
    text = format(value.normalize(), "f")
    return text


def number_param(values: Dict[str, Any], key: str, label: str) -> Decimal:
    """A number of the form (``0`` when it is left empty); the text of a number is read as written."""
    raw = values.get(key)
    if raw is None or raw == "":
        return _ZERO
    if isinstance(raw, bool):
        raise ValueError("%s: %r is not a number." % (label, raw))
    try:
        if isinstance(raw, int):
            value = Decimal(raw)
        elif isinstance(raw, float):
            value = Decimal(repr(raw))
        elif isinstance(raw, str):
            value = Decimal(raw.strip().replace(",", "."))
        else:
            raise ValueError("%s: %r is not a number." % (label, raw))
    except InvalidOperation:
        raise ValueError("%s: %r is not a number." % (label, raw))
    if not value.is_finite():
        raise ValueError("%s: %r is not a number." % (label, raw))
    return Decimal(trim(value))


def decimals_param(values: Dict[str, Any]) -> Optional[int]:
    """``None`` for "as written", else the decimals a rounded word with a point gets."""
    raw = values.get("decimals")
    if raw in (None, "", "keep"):
        return None
    if isinstance(raw, int) and not isinstance(raw, bool) and raw in (3, 4):
        return raw
    if isinstance(raw, str) and raw.strip() in ("3", "4"):
        return int(raw.strip())
    raise ValueError("Decimal places: %r is not 'keep', 3 or 4." % (raw,))


def count_text(count: int, singular: str, plural: Optional[str] = None) -> str:
    return "%s %s" % ("{:,}".format(count), singular if count == 1 else (plural or singular + "s"))


def quote(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= QUOTE_LENGTH else text[: QUOTE_LENGTH - 1].rstrip() + "…"


#: The place of each reason in the order the findings and the message use: the reasons of `_nc_geom`, then the run's own.
REASON_PLACE = {reason: place for place, reason in enumerate(list(_nc_geom.REASONS) + list(RUN_REASONS))}


def reason_order(reason: str) -> int:
    return REASON_PLACE.get(reason, len(REASON_PLACE))


def finding_of(item: _nc_geom.Refusal) -> Dict[str, Any]:
    """A refusal or an information row as a finding (``_nc_geom.finding_of``, and the run's own
    reasons of :data:`RUN_REASONS`)."""
    if item.reason in RUN_REASONS:
        return {"line": item.line, "severity": "error", "message": "%s: %s." % (item.written, RUN_REASONS[item.reason]), "reason": item.reason}
    return _nc_geom.finding_of(item)


class Block:
    """One line of the scope: what refuses it, what is noted, and the edits that change it."""

    __slots__ = ("line", "index", "text", "refusals", "notes", "edits", "words", "added", "swaps", "rounded", "helix", "arc")

    def __init__(self, line: int, index: int, text: str) -> None:
        self.line = line
        self.index = index
        self.text = text
        self.refusals: List[_nc_geom.Refusal] = []
        self.notes: List[_nc_geom.Refusal] = []
        #: (start, end, text) in the line.
        self.edits: List[Tuple[int, int, str]] = []
        self.words = 0
        self.added = 0
        self.swaps = 0
        self.rounded = 0
        self.helix = False
        self.arc = False

    def refuse(self, reason: str, written: str, detail: str = "") -> None:
        if all(r.reason != reason for r in self.refusals):
            self.refusals.append(_nc_geom.Refusal(self.line, reason, written, detail))


class Run:
    """One walk over the scope with the path tracker: every block judged and rewritten in
    memory; the text is written only when nothing refused (Q4-1)."""

    def __init__(self, context: Dict[str, Any], cp: Any, params: Any) -> None:
        self.context = context
        self.cp = cp
        self.params = params
        self.op = params.op()
        self.name = _nc_geom.op_name(self.op)
        self.exact = _nc_geom.is_exact(self.op)
        self.lathe_z = isinstance(self.op, _nc_geom.LatheZMirror)
        #: A mirror swaps arc directions and compensation sides (AD-42).
        self.swapping = self.name in ("mirror", "lathe-z-mirror")
        #: Rotate and a mirror about a line at an angle write X and Y on every block that now
        #: moves in both; the axis mirrors write only the words that were there (AD-44).
        self.both = self.name == "rotate" or (self.name == "mirror" and not self.exact)
        degrees = Decimal(getattr(self.op, "degrees", 0))
        #: A rotation by whole turns changes nothing.
        self.identity = self.name == "rotate" and degrees % Decimal(360) == _ZERO
        self.tracker = _nc_path.PathTracker(context, cp, reach=False)
        self.profile = self.tracker.profile
        self.codes = [e for e in self.tracker.codes if isinstance(e, dict)]
        self.machine = gedit_nc.machine_params(context)
        scope = as_dict(context.get("input"))
        self.selection = scope.get("scope") == "selection"
        self.blocks: List[Block] = []
        #: The swapped pairs, in the order the message names them: arcs, then sides.
        self.arc_pairs: List[str] = []
        self.side_pairs: List[str] = []
        # A selection's start (set by `walk`).
        self.first = 1
        self.continued_at_start = False
        self.inherited_comp: Optional[Tuple[str, Dict[str, Any]]] = None
        self.inherited_arc: Optional[Dict[str, Any]] = None
        #: A selection's first moves start where the lines above it leave the tool, a point the
        #: run does not move: True until the first block that moves the tool (`check_outside`).
        self.outside = False
        #: The axes whose position the tracker computed (after a polar move, Klartext ``LP``,
        #: ``CP``): a word written from it is an approximation and counts as rounded.
        self.computed: set = set()

    # -- the walk ---------------------------------------------------------------

    def walk(self, preceding: Sequence[str], lines: Sequence[str], first: int) -> None:
        tracker = self.tracker
        state: Any = None
        for number, text in enumerate(preceding, first - len(preceding)):
            state, _ = tracker.line(text, number, state, False)
        self.first = first
        if self.selection:
            self.prime_selection(state, first)
        for index, text in enumerate(lines):
            number = first + index
            state, step = tracker.line(text, number, state, True)
            block = self.judge(step, index, text)
            self.blocks.append(block)
        if self.selection and self.blocks:
            self.end_selection(state)

    def prime_selection(self, state: Any, first: int) -> None:
        """What the lines above a selection leave in force that the selection cannot judge:
        a block that runs on into the selection, and (for a mirror) an arc direction or a
        compensation side the mirror would have to swap above the selection."""
        self.continued_at_start = bool(state is not None and state.continuation)
        self.outside = True
        if not self.swapping:
            return
        interp = self.tracker.interp
        for group, value in as_dict(interp.state.get("groups")).items():
            code = as_dict(value).get("code")
            line = as_dict(value).get("line")
            if not isinstance(code, str) or not isinstance(line, int) or line >= first:
                continue
            entry = interp.entry(code)
            if gedit_nc.comp_side_of(entry) is not None:
                self.inherited_comp = (group, entry or {})
            elif gedit_nc.arc_direction_of(entry) is not None:
                self.inherited_arc = entry

    def selection_reasons(self, step: Any, block: Block, written: str) -> None:
        """``selection-inside`` for a block the selection cuts off from its cycle, its block
        or the direction and side in force above it."""
        if block.index == 0 and self.continued_at_start:
            block.refuse("selection-inside", written, "a block that starts above the selection")
        state = self.tracker.interp.state
        active = as_dict(state.get("activeCycle"))
        defined = as_dict(state.get("definedCycle"))
        if active and isinstance(active.get("line"), int) and active["line"] < self.first and step.moves:
            block.refuse("selection-inside", written, "%s (line %d)" % (active.get("code"), active["line"]))
        if getattr(step, "cycle", None) and defined and defined.get("code") == step.cycle and isinstance(defined.get("line"), int) and defined["line"] < self.first:
            block.refuse("selection-inside", written, "%s (line %d)" % (defined.get("code"), defined["line"]))
        entries = [e for e, _, _ in step.entries]
        if self.inherited_comp is not None:
            group, entry = self.inherited_comp
            if any(e.get("group") == group for e in entries):
                self.inherited_comp = None
            elif step.moves:
                block.refuse("selection-mode", written, str(entry.get("code")))
        if self.inherited_arc is not None:
            if any(e.get("group") == "motion" for e in entries):
                self.inherited_arc = None
            elif step.arc is not None or any(isinstance(e, _nc_path.Unknown) and e.kind == "arc" for e in step.events):
                block.refuse("selection-mode", written, str(self.inherited_arc.get("code")))

    def end_selection(self, state: Any) -> None:
        """A selection that ends inside a block or while a cycle it started is still in force."""
        last = self.blocks[-1]
        if state is not None and state.continuation:
            last.refuse("selection-inside", quote(last.text), "a block that runs on below the selection")
        active = as_dict(self.tracker.interp.state.get("activeCycle"))
        line = active.get("line")
        if active and isinstance(line, int) and line >= self.first:
            target = next((b for b in self.blocks if b.line == line), last)
            target.refuse("selection-inside", quote(target.text), "%s (line %d)" % (active.get("code"), line))

    # -- one block ----------------------------------------------------------------

    def judge(self, step: Any, index: int, text: str) -> Block:
        tracker = self.tracker
        block = Block(step.line, index, text)
        roles = _nc_geom.roles_of(step, tracker)
        refusals = _nc_geom.refusals_of(step, roles, tracker, self.op, self.context)
        block.refusals.extend(refusals)
        block.notes.extend(_nc_geom.notes_of(step, roles, tracker, self.op, self.context))
        written = quote("".join(t.text for t in step.tokens))
        if self.selection:
            self.selection_reasons(step, block, written)
        moving = False
        if self.outside and not self.identity:
            moving = self.check_outside(step, roles, block, written)
        if not block.refusals and not self.identity:
            # A rotation by whole turns changes no word (a polar angle would otherwise come
            # back as the same angle written another way, PA+30 as PA-330).
            self.rewrite(step, roles, block)
        if moving:
            self.outside = False
        self.note_computed(step)
        block.refusals.sort(key=lambda r: reason_order(r.reason))
        arc = step.arc
        block.arc = arc is not None or any(isinstance(e, _nc_path.Unknown) and e.kind == "arc" for e in step.events)
        if arc is not None and self.swapping:
            block.helix = any(end is not None and start != end for start, end in arc.helix.values())
        return block

    def check_outside(self, step: Any, roles: Sequence[Any], block: Block, written: str) -> bool:
        """A block of a selection while the tool still stands where the lines above left it,
        which the run does not move. Refuses (``selection-start``) the first move that cannot
        start from there when that point moves: an arc, an incremental move (on a mill; on a
        lathe one along an axis the mirror moves) or a polar move with an incremental part, and
        on a lathe a move that does not write every axis the mirror moves. A move to an absolute
        point is a join and is written whole (``vector``). Returns whether the block moves the
        tool, which ends this state."""
        axes = ("X", "Y", "Z") if self.lathe_z else PLANE
        arc = step.arc is not None or any(isinstance(e, _nc_path.Unknown) and e.kind == "arc" for e in step.events)
        polar = [r for r in roles if r.role in ("polar-radius", "polar-radius-inc", "polar-angle", "polar-angle-inc")]
        moving = arc or step.polar is not None or bool(polar) or any(
            r.role in ("point", "point-inc", "cycle-position") and r.axis in axes for r in roles
        )
        units = self.units_of(step)
        start = {axis: self.start(step, axis, units) for axis in axes}
        known = {axis: value for axis, value in start.items() if value is not None}
        if not self.lathe_z and len(known) != len(PLANE):
            # Where the tool stands is not known: the other rules decide (`position-unknown`).
            return moving
        moved_to, _ = _nc_geom.transform("point", dict(known), self.op)
        moved = {axis for axis, value in known.items() if differs(moved_to[axis], value)}  # type: ignore[index]
        if not moved:
            return moving  # it stands on a point the run does not move
        increments = [r for r in roles if r.role in ("point-inc", "pole-inc") and r.axis in axes]
        polar_inc = any(r.role in ("polar-angle-inc", "polar-radius-inc") for r in polar)
        if arc:
            block.refuse("selection-start", written, "an arc")
        elif polar_inc:
            block.refuse("selection-start", written, "an incremental polar move")
        elif increments and (not self.lathe_z or any(r.axis in moved for r in increments)):
            block.refuse("selection-start", written, "an incremental move")
        elif self.lathe_z and moving:
            absolute = {r.axis for r in roles if r.role in ("point", "cycle-position")}
            if any(axis not in absolute for axis in moved):
                block.refuse("selection-start", written, "a move without %s" % "".join(sorted(moved - absolute)))
        return moving

    def note_computed(self, step: Any) -> None:
        """Which axes stand at a position the tracker computed after this block."""
        for read in step.reads:
            if read.incremental is False and read.value is not None:
                self.computed.discard(read.axis)
            elif read.value is None:
                self.computed.discard(read.axis)
        if step.polar is not None:
            self.computed |= set(step.polar.plane)

    def units_of(self, step: Any) -> str:
        units = getattr(step, "units", None)
        if units in ("mm", "inch"):
            return units
        value = as_dict(self.tracker.interp.state.get("units")).get("value")
        return value if value in ("mm", "inch") else "mm"

    def start(self, step: Any, axis: str, units: str) -> Optional[Decimal]:
        """Where ``axis`` is at the start of the block, as a coordinate in ``units``."""
        value = step.before.get(axis)
        if value is None:
            return None
        value = self.tracker.axes.geo(axis, value)
        report = self.tracker.report_units
        if report == "mm" and units == "inch":
            value = value / INCH
        elif report == "inch" and units == "mm":
            value = value * INCH
        return value

    def read(self, role: Any, units: str) -> Optional[Decimal]:
        value, _ = _nc_geom.read_word(role, self.tracker, units, self.context)
        return value

    def form_of(self, role: Any) -> Any:
        """The role a rounded word is written through: with the decimals the form asks (a
        word with a point only; the word's text and its form stay the same)."""
        places = self.params.decimals
        token = role.token
        literal = token.value
        if places is None or self.exact or literal is None or not literal.has_point:
            return role
        frac = literal.frac_part or ""
        frac = frac[:places] if len(frac) >= places else frac + "0" * (places - len(frac))
        raw = "%s%s.%s" % (literal.sign, literal.int_part, frac)
        new_literal = gedit_nc.NumericLiteral(raw=raw, sign=literal.sign, int_part=literal.int_part, frac_part=frac, has_point=True)
        new_token = gedit_nc.Token(
            kind=token.kind, start=token.start, end=token.end, text=token.text, address=token.address,
            value_text=token.value_text, value=new_literal, incremental=token.incremental, index=token.index,
        )
        return role._replace(token=new_token)

    def places_of(self, role: Any, units: str) -> Optional[int]:
        """The decimals a rounded word of ``role`` is written with (for the increments a
        rounding run writes as the difference of two rounded points)."""
        literal = role.token.value
        if literal is None:
            return None
        if literal.has_point:
            own = len(literal.frac_part or "")
            asked = self.params.decimals
            return max(asked if asked is not None else own, _nc_geom.MIN_DECIMALS.get(units, 3))
        probe = gedit_nc.parse_number("1")
        unit = _nc_path.dec(gedit_nc.value_of(probe, role.number_class or "length", self.machine, units)) if probe is not None else None
        if unit is None or unit <= _ZERO:
            return None
        if unit == Decimal(1):
            # Read as written (the calculator reading): the rounded word gets a point and the
            # decimals `_nc_geom.write_word` gives it, not whole millimetres.
            return _nc_geom.MIN_DECIMALS.get(units, 3)
        exponent = unit.normalize().as_tuple().exponent
        return -exponent if isinstance(exponent, int) and exponent < 0 else 0

    @staticmethod
    def rounded(value: Decimal, places: Optional[int]) -> Decimal:
        if places is None:
            return value
        return value.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)

    def put(self, block: Block, role: Any, old: Optional[Decimal], new: Decimal, exact: bool, units: str, approx: bool = False) -> None:
        """Writes ``new`` into the word of ``role``; a value that did not change keeps its text.
        ``approx``: ``new`` is already rounded (an increment between two rounded points)."""
        if old is not None and new == old:
            return
        written = _nc_geom.write_word(self.form_of(role), new, self.tracker, units, exact, self.context)
        if isinstance(written, _nc_geom.Refusal):
            block.refusals.append(written._replace(line=block.line))
            return
        block.edits.append((role.token.start, role.token.end, written.text))
        block.words += 1
        if written.rounded or approx:
            block.rounded += 1

    def add(self, block: Block, axis: str, address: str, like: Any, value: Decimal, exact: bool, units: str, line: str, approx: bool = False) -> None:
        """Adds the word of ``axis`` a rotation needs, in the form of ``like`` (AD-44)."""
        written = _nc_geom.write_added(address, self.form_of(like), value, self.tracker, units, exact, self.context)
        if isinstance(written, _nc_geom.Refusal):
            block.refusals.append(written._replace(line=block.line))
            return
        token = like.token
        # The block's own spacing: a packed block (`G1X5.F100`) stays packed.
        if token.start > 0:
            spaced = line[token.start - 1 : token.start].isspace()
        elif token.end < len(line):
            spaced = line[token.end : token.end + 1].isspace()
        else:
            spaced = True
        gap = " " if spaced else ""
        if PLANE.index(axis) > PLANE.index(like.axis):
            block.edits.append((token.end, token.end, gap + written.text))
        else:
            block.edits.append((token.start, token.start, written.text + gap))
        block.words += 1
        block.added += 1
        if written.rounded or approx:
            block.rounded += 1

    def rewrite(self, step: Any, roles: Sequence[Any], block: Block) -> None:
        units = self.units_of(step)
        if self.lathe_z:
            for role in roles:
                # Z about Mirror Z, and Y about the turning axis (the owner's decision Q-B).
                if role.role in _nc_geom.VECTOR_ROLES and role.axis in _nc_geom.LATHE_MIRROR_AXES:
                    old = self.read(role, units)
                    if old is None:
                        block.refuse("machine-dependent", quote(role.token.text))
                        continue
                    new, exact = _nc_geom.transform(role.role, {role.axis: old}, self.op)
                    self.put(block, role, old, new[role.axis], exact, units)
        else:
            points = [r for r in roles if r.role in ("point", "cycle-position", "point-inc") and r.axis in PLANE]
            self.vector(block, step, points, ("point", "cycle-position"), units)
            poles = [r for r in roles if r.role in ("pole", "pole-inc") and r.axis in PLANE]
            self.vector(block, step, poles, ("pole",), units)
            self.centres(block, step, [r for r in roles if r.role in ("centre", "centre-inc") and r.axis in PLANE], units)
            for role in roles:
                if role.role in ("polar-angle", "polar-angle-inc"):
                    old = self.read(role, units)
                    if old is None:
                        block.refuse("machine-dependent", quote(role.token.text))
                        continue
                    new, exact = _nc_geom.transform(role.role, old, self.op)
                    self.put(block, role, old, new, exact, units)
        if self.swapping:
            self.swap(block, roles)

    def vector(self, block: Block, step: Any, roles: Sequence[Any], absolute: Tuple[str, ...], units: str) -> None:
        """The points (or the pole) of one block in the XY plane: absolute words, increments,
        or both; the word a rotation adds."""
        if not roles:
            return
        line = block.text
        op = self.op
        absolute_words: Dict[str, Tuple[Any, Decimal]] = {}
        increments: Dict[str, Tuple[Any, Decimal]] = {}
        for role in roles:
            value = self.read(role, units)
            if value is None:
                block.refuse("machine-dependent", quote(role.token.text))
                return
            target = absolute_words if role.role in absolute else increments
            if role.axis in absolute_words or role.axis in increments:
                block.refuse("word-unknown", quote(role.token.text))
                return
            target[role.axis] = (role, value)
        start = {axis: self.start(step, axis, units) for axis in PLANE}
        known = all(start[axis] is not None for axis in PLANE)

        if not absolute_words:
            approx_of: Dict[str, bool] = {}
            moved = {axis: increments[axis][1] if axis in increments else _ZERO for axis in PLANE}
            new, exact = _nc_geom.transform("point-inc", moved, op)
            if exact or not known:
                # Exact (an axis mirror, a quarter turn, a line at 45 degrees: `transform` says
                # so), or no start to round from: the increment itself, turned or reflected.
                values = {axis: new[axis] for axis in PLANE}
            else:
                # Rounded: the difference of the two rounded points, so the path does not drift.
                exact = False
                target = {axis: start[axis] + moved[axis] for axis in PLANE}  # type: ignore[operator]
                after, _ = _nc_geom.transform("point", target, op)
                before, _ = _nc_geom.transform("point", dict(start), op)
                like = next(iter(increments.values()))[0]
                values = {}
                for axis in PLANE:
                    places = self.places_of(increments[axis][0] if axis in increments else like, units)
                    values[axis] = self.rounded(after[axis], places) - self.rounded(before[axis], places)
                    approx_of[axis] = differs(values[axis], after[axis] - before[axis])
            for axis, (role, value) in increments.items():
                self.put(block, role, value, values[axis], exact, units, approx_of.get(axis, False))
            if self.both and len(increments) == 1:
                missing = next(a for a in PLANE if a not in increments)
                if values[missing] != _ZERO:
                    like = next(iter(increments.values()))[0]
                    self.add(block, missing, self.address_of(like, missing), like, values[missing], exact, units, line, approx_of.get(missing, False))
            return

        target: Dict[str, Decimal] = {}
        #: A value computed from a position the tracker computed is not exact.
        approx = False
        for axis in PLANE:
            if axis in absolute_words:
                target[axis] = absolute_words[axis][1]
            elif axis in increments:
                if start[axis] is None:
                    block.refuse("position-unknown", quote(line), axis)
                    return
                target[axis] = start[axis] + increments[axis][1]  # type: ignore[operator]
                approx = approx or axis in self.computed
            elif start[axis] is not None:
                target[axis] = start[axis]  # type: ignore[assignment]
                approx = approx or (self.both and axis in self.computed)
            elif not self.both:
                # An axis mirror: the other axis does not change what this one becomes.
                target[axis] = Decimal(op.point[PLANE.index(axis)])
            else:
                block.refuse("position-unknown", quote(line), axis)
                return
        after, exact = _nc_geom.transform("point", target, op)
        exact = exact and not approx
        for axis, (role, value) in absolute_words.items():
            self.put(block, role, value, after[axis], exact, units)
        before: Optional[Dict[str, Decimal]] = None
        if known:
            before, _ = _nc_geom.transform("point", dict(start), op)  # type: ignore[arg-type]
        if self.outside and not increments and len(absolute_words) == 1:
            # The first move of a selection starts where the lines above left the tool, not at
            # the moved point: the other axis is written whenever it ends anywhere else.
            missing = next(a for a in PLANE if a not in absolute_words)
            if start[missing] is not None and after[missing] != start[missing]:
                like = next(iter(absolute_words.values()))[0]
                self.add(block, missing, self.address_of(like, missing), like, after[missing], exact and missing not in self.computed, units, line)
            return
        if increments:
            if before is None:
                block.refuse("position-unknown", quote(line), "")
                return
            exact = exact and not any(axis in self.computed for axis in PLANE)
            for axis, (role, value) in increments.items():
                if exact:
                    new = after[axis] - before[axis]
                    self.put(block, role, value, new, exact, units)
                else:
                    places = self.places_of(role, units)
                    new = self.rounded(after[axis], places) - self.rounded(before[axis], places)
                    self.put(block, role, value, new, exact, units, differs(new, after[axis] - before[axis]))
            return
        if self.both and len(absolute_words) == 1:
            missing = next(a for a in PLANE if a not in absolute_words)
            if self.identity:
                return
            if before is not None and after[missing] == before[missing]:
                return  # the block still does not move along that axis (a half turn)
            like = next(iter(absolute_words.values()))[0]
            self.add(block, missing, self.address_of(like, missing), like, after[missing], exact, units, line)

    def address_of(self, like: Any, axis: str) -> str:
        """The address the added word of ``axis`` is written with: the axis itself, or the
        centre word of the axis for an arc centre."""
        if like.role in ("centre", "centre-inc"):
            return CENTRE_WORD.get(axis, axis)
        return axis

    def centres(self, block: Block, step: Any, roles: Sequence[Any], units: str) -> None:
        """The arc centre of one block in the XY plane: a vector from the start (``I``, ``J``) or
        an absolute point (``I=AC(…)``)."""
        if not roles:
            return
        kinds = {r.role for r in roles}
        if len(kinds) > 1:
            block.refuse("position-unknown", quote(block.text), "a centre written partly absolute")
            return
        words: Dict[str, Tuple[Any, Decimal]] = {}
        for role in roles:
            value = self.read(role, units)
            if value is None:
                block.refuse("machine-dependent", quote(role.token.text))
                return
            if role.axis in words:
                block.refuse("word-unknown", quote(role.token.text))
                return
            words[role.axis] = (role, value)
        kind = roles[0].role
        if kind == "centre-inc":
            vector = {axis: words[axis][1] if axis in words else _ZERO for axis in PLANE}
            new, exact = _nc_geom.transform("centre-inc", vector, self.op)
            for axis, (role, value) in words.items():
                self.put(block, role, value, new[axis], exact, units)
            if len(words) == 1:
                missing = next(a for a in PLANE if a not in words)
                if new[missing] != _ZERO:
                    like = next(iter(words.values()))[0]
                    self.add(block, missing, self.address_of(like, missing), like, new[missing], exact, units, block.text)
            return
        if len(words) != len(PLANE):
            block.refuse("position-unknown", quote(block.text), "an absolute centre with one coordinate")
            return
        point = {axis: words[axis][1] for axis in PLANE}
        new, exact = _nc_geom.transform("centre", point, self.op)
        for axis, (role, value) in words.items():
            self.put(block, role, value, new[axis], exact, units)

    def swap(self, block: Block, roles: Sequence[Any]) -> None:
        """AD-42: the arc direction and the compensation side, from the data."""
        for role in roles:
            token = role.token
            if role.role == "code-arc" or role.role == "code-comp":
                flag = "arcDirection" if role.role == "code-arc" else "compSide"
                partner = _nc_geom.swap_partner(role.entry or {}, self.codes, flag)
                if partner is None:
                    block.refuse("swap-unknown", quote(token.text))
                    continue
                text = _nc_geom.partner_text(token.text, partner)
                pair = " and ".join(sorted((str((role.entry or {}).get("code")), partner), key=natural))
            elif role.role == "direction":
                partner = _nc_geom.swap_word(token.text, self.profile)
                if partner is None:
                    block.refuse("swap-unknown", quote(token.text))
                    continue
                text = partner
                pair = " and ".join(sorted((token.text.strip().upper(), partner), key=natural))
            else:
                continue
            if text == token.text:
                continue
            block.edits.append((token.start, token.end, text))
            block.swaps += 1
            pairs = self.side_pairs if role.role == "code-comp" else self.arc_pairs
            if pair not in pairs:
                pairs.append(pair)

    # -- the arc check after rounding (AD-44) ---------------------------------------

    def check_arcs(self, preceding: Sequence[str], written: Sequence[str]) -> None:
        """Walks the written program and checks every arc of a changed block."""
        if not any(b.edits and b.arc for b in self.blocks):
            return  # no arc was written differently: the walk would find nothing to check
        tracker = _nc_path.PathTracker(self.context, self.cp, reach=False, flow=False)
        state: Any = None
        for number, text in enumerate(preceding, self.first - len(preceding)):
            state, _ = tracker.line(text, number, state, False)
        by_index = {b.index: b for b in self.blocks}
        for index, text in enumerate(written):
            state, step = tracker.line(text, self.first + index, state, True)
            block = by_index.get(index)
            if block is None or not block.edits or not block.arc:
                continue
            units = self.units_of(step)
            found: List[_nc_geom.Refusal] = []
            arc = step.arc
            if arc is not None and arc.plane == PLANE and arc.form != "radius":
                found.extend(_nc_geom.check_arcs([arc], units))
            radius = None
            # Only a block that writes a radius word can have a radius role (a word of its own).
            if any(t.kind == "word" and (t.address or "").upper() in _nc_path.RADIUS_WORDS for t in step.tokens):
                roles = _nc_geom.roles_of(step, tracker)
                radius = next((r for r in roles if r.role == "radius" and (r.token.address or "").upper() in _nc_path.RADIUS_WORDS), None)
            if radius is not None:
                value, _ = _nc_geom.read_word(radius, tracker, units, self.context)
                ends = [self.start(step, axis, units) for axis in PLANE]
                after = [step.after.get(axis) for axis in PLANE]
                if value is not None and None not in ends and None not in after:
                    report = tracker.report_units
                    end = []
                    for axis, v in zip(PLANE, after):
                        v = tracker.axes.geo(axis, v)  # type: ignore[arg-type]
                        if report == "mm" and units == "inch":
                            v = v / INCH
                        elif report == "inch" and units == "mm":
                            v = v * INCH
                        end.append(v)
                    refusal = _nc_geom.check_chord(step.line, (ends[0], ends[1]), (end[0], end[1]), value, units)  # type: ignore[arg-type]
                    if refusal is not None:
                        found.append(refusal)
            for refusal in found:
                block.refusals.append(refusal._replace(line=block.line, written=quote(block.text)))

    # -- the result ---------------------------------------------------------------

    def refused(self) -> List[Block]:
        return [b for b in self.blocks if b.refusals]

    def apply(self, lines: Sequence[str]) -> List[str]:
        out = list(lines)
        for block in self.blocks:
            if not block.edits:
                continue
            text = out[block.index]
            parts: List[str] = []
            at = 0
            for start, end, new in sorted(block.edits):
                parts.append(text[at:start])
                parts.append(new)
                at = end
            parts.append(text[at:])
            out[block.index] = "".join(parts)
        return out


#: Below this a computed value counts as the value itself (the double precision of a turn).
NOISE = Decimal("1e-9")


def differs(written: Decimal, wanted: Decimal) -> bool:
    """Whether an increment written as the difference of two rounded points is not the
    turned increment itself (it then counts as rounded)."""
    return abs(written - wanted) > NOISE


def natural(code: str) -> Tuple[Any, ...]:
    """``G2`` before ``G3`` before ``G41``: letters, then the number by its value."""
    head = code.rstrip("0123456789.+-")
    rest = code[len(head):]
    try:
        return (head, float(rest), rest)
    except ValueError:
        return (head, 0.0, rest)


def machine_note(context: Dict[str, Any], profile: Dict[str, Any]) -> str:
    """The machine, always the last sentence of the message (README, "The message")."""
    machine = gedit_nc.machine_params(context)
    if machine.get("id") is None:
        return "No machine chosen: a word whose reading depends on the machine would refuse the run."
    name = machine.get("name") or machine.get("id")
    params = as_dict(machine.get("params"))
    if as_dict(machine.get("source")).get("numberInput") != "machine":
        return "Machine '%s': it does not say how it reads numbers, so a word whose reading depends on that would refuse the run." % name
    number_input = as_dict(params.get("numberInput"))
    length = as_dict(as_dict(number_input.get("classes")).get("length"))
    mode = length.get("mode") or number_input.get("mode")
    inch = params.get("units") == "inch"
    unit = length.get("incrementInch" if inch else "increment") or number_input.get("incrementInch" if inch else "incrementMm")
    if mode == "increment" and isinstance(unit, str):
        how = "numbers without a point are increments of %s %s" % (unit, "inch" if inch else "mm")
    elif mode == "scale" and isinstance(unit, str):
        how = "every number counts in units of %s %s, with or without a point" % (unit, "inch" if inch else "mm")
    else:
        how = "numbers are read as written"
    return "Machine '%s': %s." % (name, how)


def message(run: Run, refused: List[Block], dropped: int) -> str:
    params = run.params
    sentences: List[str] = []
    if refused:
        counts: Dict[str, int] = {}
        for block in refused:
            reason = block.refusals[0].reason
            counts[reason] = counts.get(reason, 0) + 1
        parts = []
        for reason in sorted(counts, key=reason_order):
            one, many = REASON_LABEL.get(reason, (reason, reason))
            parts.append("%s %s" % ("{:,}".format(counts[reason]), one if counts[reason] == 1 else many))
        sentences.append(
            "Nothing was changed: %s cannot be %s: %s."
            % (count_text(len(refused), "block"), params.verb(), ", ".join(parts))
        )
    else:
        changed = [b for b in run.blocks if b.edits]
        words = sum(b.words for b in changed)
        swaps = sum(b.swaps for b in changed)
        added = sum(b.added for b in changed)
        rounded = sum(b.rounded for b in changed)
        if not changed:
            sentences.append("%s: no word needed a change." % params.headline())
        else:
            what = count_text(words, "word")
            if swaps:
                what += " and %s" % count_text(swaps, "code")
            first = "%s: %s on %s" % (params.headline(), what, count_text(len(changed), "block"))
            extras = []
            if added:
                extras.append("%s of them added" % "{:,}".format(added))
            if rounded:
                extras.append("%s rounded" % "{:,}".format(rounded))
            if extras:
                first += ", " + ", ".join(extras)
            pairs = run.arc_pairs + run.side_pairs
            if pairs:
                first += " (%s swapped)" % ", ".join(pairs)
            sentences.append(first + ".")
        # The blank's one row (Q-D) is a sentence of its own: its two or three blocks are one thing.
        blank = any(n.reason == "blank" for b in run.blocks for n in b.notes)
        left = [b for b in run.blocks if b.notes and b.notes[0].reason != "blank"]
        if left:
            returns = sum(1 for b in left if b.notes[0].reason == "machine-position" and has_point_params(run, b))
            positions = sum(1 for b in left if b.notes[0].reason == "machine-position") - returns
            words_left = sum(1 for b in left if b.notes[0].reason == "word-left")
            parts = []
            if returns:
                parts.append(count_text(returns, "return to the reference point", "returns to the reference point"))
            if positions:
                parts.append(count_text(positions, "position in machine coordinates", "positions in machine coordinates"))
            if words_left:
                parts.append(count_text(words_left, "word gEdit cannot place", "words gEdit cannot place"))
            sentences.append("Left %s as written: %s." % (count_text(len(left), "block"), ", ".join(parts)))
        if blank:
            sentences.append("The workpiece blank (BLK FORM) is left as written.")
    if dropped:
        sentences.append("%s further findings are not listed." % "{:,}".format(dropped))
    sentences.append(machine_note(run.context, run.profile))
    return " ".join(sentences)


def has_point_params(run: Run, block: Block) -> bool:
    """A machine block whose code takes its axis words as an intermediate point (``G28``)."""
    detail = block.notes[0].detail
    entry = run.tracker.interp.entry(detail) if detail else None
    params = as_dict(entry).get("params") if entry else None
    return isinstance(params, list) and bool(params)


def findings_of(run: Run, refused: List[Block]) -> Tuple[List[Dict[str, Any]], int]:
    """One error per refused block (its first reason), the information rows, and, on a
    written run, the warnings and one row for the rounded blocks (at the first of them, with
    their count); in line order. The cap cuts errors and information rows, never a warning."""
    rows: List[Tuple[int, int, Dict[str, Any]]] = []
    warnings: List[Tuple[int, int, Dict[str, Any]]] = []
    for block in run.blocks:
        if block.refusals:
            rows.append((block.line, 0, finding_of(block.refusals[0])))
        for note in block.notes:
            rows.append((block.line, 1, finding_of(note)))
    if not refused:
        changed = [b for b in run.blocks if b.edits]
        rounded = [b for b in changed if b.rounded]
        if rounded:
            row = finding_of(_nc_geom.Refusal(rounded[0].line, "rounded", quote(rounded[0].text)))
            if len(rounded) > 1:
                row["message"] = "%s (the first of %s)." % (row["message"][:-1], count_text(len(rounded), "rounded block"))
            rows.append((rounded[0].line, 1, row))
        if changed:
            first = changed[0].line
            for reason in ("climb-milling", "tool-nose"):
                if run.name in _nc_geom.WARNINGS[reason][0]:
                    warnings.append((first, 2, _nc_geom.warning_of(reason, first)))
            helix = next((b for b in changed if b.helix), None)
            if helix is not None and run.name in _nc_geom.WARNINGS["helix-hand"][0]:
                warnings.append((helix.line, 2, _nc_geom.warning_of("helix-hand", helix.line)))
    rows.sort(key=lambda row: (row[0], row[1]))
    room = max(0, MAX_FINDINGS - len(warnings))
    dropped = max(0, len(rows) - room)
    kept = rows[:room] + warnings
    kept.sort(key=lambda row: (row[0], row[1]))
    return [row[2] for row in kept], dropped


def unprimed(context: Dict[str, Any], profile: Dict[str, Any], text: str, first: int) -> None:
    """The run of a selection whose lines above were not sent (the app leaves them out when
    the text above is too large): what is in force there decides how every word is read, so
    nothing is changed (``selection-unprimed``, as translate has it)."""
    gedit_nc.envelope(
        text,
        "Nothing was changed: this run saw only the selection, from line %d, so what is in force "
        "above it is not known. Run %s on the whole program. %s" % (first, SCRIPT, machine_note(context, profile)),
        [
            {
                "line": first,
                "severity": "error",
                "message": "The lines above the selection were not available, so the distance mode, the "
                "units, a frame, a cycle, an arc direction and a compensation side in force there are "
                "not known; nothing was changed.",
                "reason": "selection-unprimed",
            }
        ],
    )


def main() -> int:
    context = gedit_nc.load_context()
    lines = gedit_nc.read_input()
    profile = context.get("profile")
    if not isinstance(profile, dict) or not profile:
        print("%s needs a dialect profile. Run it from gEdit, which puts the profile into the script context." % SCRIPT, file=sys.stderr)
        return 1
    try:
        cp = gedit_nc.compile_profile(profile)
    except ValueError as err:
        print("%s cannot use this profile: %s" % (SCRIPT, err), file=sys.stderr)
        return 1
    try:
        params = Params(as_dict(context.get("params")), profile)
    except (ValueError, ArithmeticError) as err:
        print("%s: %s" % (SCRIPT, err), file=sys.stderr)
        return 1
    codes = context.get("codes") if isinstance(context.get("codes"), list) else []
    text = "\n".join(lines)
    if not codes:
        gedit_nc.envelope(
            text,
            "Nothing was changed: this run had no code database, so it cannot tell a move from a "
            "cycle, a frame or a machine position. " + machine_note(context, profile),
            [],
        )
        return 0
    scope = as_dict(context.get("input"))
    start = scope.get("startLine")
    first = start if isinstance(start, int) and not isinstance(start, bool) and start >= 1 else 1
    fragment = scope.get("scope") == "selection" and first > 1
    preceding = gedit_nc.preceding_lines(context) if fragment else []
    if fragment and not preceding:
        unprimed(context, profile, text, first)
        return 0

    run = Run(context, cp, params)
    run.walk(preceding, lines, first)
    written = run.apply(lines)
    if not run.refused() and (not run.exact or any(b.rounded for b in run.blocks)):
        run.check_arcs(preceding, written)
    refused = run.refused()
    findings, dropped = findings_of(run, refused)
    gedit_nc.envelope(text if refused else "\n".join(written), message(run, refused, dropped), findings)
    return 0


if __name__ == "__main__":
    sys.exit(main())
