#!/usr/bin/env python3
# /// gedit
# name = "Translate"
# description = "Moves the path by a shift in X, Y and Z: every absolute position, absolute arc centre, pole and cycle position moves; incremental moves, incremental centres, radii and polar values stay. On a turning program the X shift is read as the machine reads X. If one block cannot be moved, nothing is changed and every such block is listed."
# input = "selection-or-document"
# output = "replace"
# timeout = 900
# envelope = true
#
# [[params]]
# id = "dx"
# type = "number"
# label = "X shift"
# help = "In the program's units (mm or inch). On a turning program, as the machine reads X: a diameter on a machine that reads X as a diameter, a radius on one that reads it as a radius."
# default = 0
# decimals = 6
#
# [[params]]
# id = "dy"
# type = "number"
# label = "Y shift"
# help = "In the program's units (mm or inch)."
# default = 0
# decimals = 6
#
# [[params]]
# id = "dz"
# type = "number"
# label = "Z shift"
# help = "In the program's units (mm or inch). Also moves the cycle positions on the tool axis (the R plane of a drilling cycle, Q203, RTP, RFP, DP). A Klartext cycle called with CYCL CALL POS cannot be moved in Z (the call's Z adds to the cycle's surface)."
# default = 0
# decimals = 6
#
# [[params]]
# id = "decimals"
# type = "choice"
# label = "Decimal places"
# help = "As written: each word keeps the form it is written in and gets the decimals the shift needs. A shift is never rounded; one a word cannot hold (finer than the machine's increments) refuses the run."
# default = "keep"
# choices = [
#   { label = "As written", value = "keep" }
# ]
# ///
"""Translate (Phase 4 plan §5 P4a, P4.3; X19, X22; `nc-transformations.md`, "Translate
coordinates").

Moves a program's path by a shift dX, dY, dZ and hands the program back through the
`envelope` output with a summary and one finding per block it refused or left as written.
The rules of what moves are `_nc_geom.py` (the roles of AD-41, the arithmetic, the write-back,
the refusal reasons); the positions are `_nc_path.py` (the tracker). This script walks the
program, asks both about every block, and writes only when nothing refused.

Settled defaults (the owner's answers of 2026-10-12, plan §9; the same as `_nc_geom.py`)
---------------------------------------------------------------------------------------

* **Q4-1, all or nothing.** A run that meets one refused block writes **nothing** and lists
  **every** refused block with its line and its reason: the text handed back is the input,
  so the app makes no edit and no undo step. A path moved except for one block is a broken
  path.
* **Q4-2, the lathe.** On a turning program the X shift is asked as the machine reads `X`
  (`machine.params.diameter`: `on` a diameter, `off` a radius) and lands on each `X` word in
  its own reading (Sinumerik `DIAMON`/`DIAMOF`/`DIAM90` per word, AD-43): a diameter shift of
  1 moves a diameter word by 1 and a radius word by 0.5. `U` and `W` are incremental and stay.
* **Q4-4, rounding.** Translate is exact (decimal arithmetic): no word is rounded. A word
  keeps its own form (a point stays a point, a point-less word stays whole increments) and
  gets the decimals the shift needs; a result the word cannot hold refuses the run
  (`resolution`).
* **Q4-5, the distance mode.** The mode at a moved block comes from the program or from the
  machine's power-on mode; a mode only assumed from the profile refuses (`distance-assumed`).
* **Q4-6, returns and machine positions.** `G53`, `M91`, `SUPA` and an incremental
  `G28`/`G30` return are left and listed as information (`machine-position`); an absolute
  intermediate point the shift would change refuses (`intermediate-point`).

What moves and what stays
-------------------------
Moved: absolute points, absolute arc centres (`I=AC(…)`, an absolute `arcCenterMode`), the
Klartext pole `CC`, cycle positions (the `X`/`Y`/`Z` of a block under `G81`, `CYCL CALL POS`,
the positions behind `MCALL`) and the cycle parameters on the tool axis (`R` under `G90`,
`Q203`, `RTP`, `RFP`, `DP`) with a Z shift. Left as written: incremental moves and twins
(`G91`, `U`, `W`, Klartext `IX`), incremental centres, radii, polar radii and angles, and
every word that is no position. A cycle moves with the blocks that run it in one piece,
which the all-or-nothing rule gives for free. The shift is in the units of the first block
that states them; a block in the other units gets it converted (25.4 exactly).

**A cycle called at a position** (Klartext `CYCL CALL POS X… Y… Z…`) moves with a shift in
X and Y. Its tool-axis position adds to the surface coordinate the definition gives (`Q203`),
so a shift along the tool axis refuses the call and the definition it runs
(`cycle-position`), as address arithmetic refuses such a call: moving both would move the
cycle twice, moving one would leave the other where it was.

**Rotary axes.** A block moved while a rotary axis that turns its axes stands turned (tool
centre point control off) is refused (`rotary-turned`); so is one moved before the axis is
first written, when the program turns it anywhere. An incremental index from a position the
program has not written (`G91 G0 A90.`) counts as turned.

**Selections.** A run over a selection is primed with the lines above it
(`input.precedingLines`), so the distance mode, the plane, the units, a frame and a cycle in
force there are known. A selection from line 1 has nothing above it, and its end is judged
as any selection's. A selection that starts or ends inside a cycle (a block of it runs a
cycle started or defined above the selection; a modal cycle started in it is still in
force at its end; a cycle defined in it, whose definition the shift changes, can still be
called below it) or inside a block written over several lines (Klartext `~`, Okuma `$`) is
refused (`selection-inside`): select the whole of it. Without the lines above, the run
says so and refuses: what is in force above the selection decides how its words are read.

Two refusals concern the whole run rather than a block, with reasons of their own: a run
with no code database (`no-database`: a move cannot be told from a machine position or a
frame) and a selection whose lines above were not sent (`selection-unprimed`: the distance
mode, the units, a frame and a cycle in force there are not known).

Everything outside the values it changes — line endings, spacing, block numbers, comments —
is handed back byte for byte: the only edits are the spans of the words that move.
"""

from __future__ import annotations

import sys
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Sequence, Tuple

import gedit_nc
import _nc_geom
import _nc_path

#: The axes of the form, in its order.
AXES = ("X", "Y", "Z")
#: The form ids of the axes.
PARAM_IDS = {"X": "dx", "Y": "dy", "Z": "dz"}
#: The labels of the form, for its errors.
PARAM_LABELS = {"X": "X shift", "Y": "Y shift", "Z": "Z shift"}

#: At most this many findings; the rest are counted in the message. The app takes 1000.
MAX_FINDINGS = 500

#: One inch in millimetres, exactly.
INCH = Decimal("25.4")

#: What the message calls a count of refused blocks by their first reason (singular, plural),
#: for the refusals of `_nc_geom.REASONS` that apply to translate.
REASON_TEXT = {
    "frame": ("block in or opening a frame", "blocks in or opening a frame"),
    "coordinate-shift": ("coordinate shift or setting", "coordinate shifts or settings"),
    "intermediate-point": ("absolute intermediate point of a return", "absolute intermediate points of a return"),
    "call": ("subprogram or macro call", "subprogram or macro calls"),
    "jump": ("block a jump or a loop may reach with other settings", "blocks a jump or a loop may reach with other settings"),
    "expression": ("block with a variable or calculation in a moved word", "blocks with a variable or calculation in a moved word"),
    "machine-dependent": ("block with a word whose reading depends on the machine", "blocks with a word whose reading depends on the machine"),
    "distance-assumed": ("block whose distance mode is not stated", "blocks whose distance mode is not stated"),
    "axis-unwritten": ("move from a start the program has not written", "moves from a start the program has not written"),
    "unknown-code": ("block with a code the database does not know", "blocks with a code the database does not know"),
    "word-unknown": ("block with a word gEdit cannot place", "blocks with a word gEdit cannot place"),
    "rotary-turned": ("move while a rotary axis stands turned", "moves while a rotary axis stands turned"),
    "selection-inside": ("block at a selection edge inside a cycle or a block", "blocks at a selection edge inside a cycle or a block"),
    "cycle-not-reviewed": ("cycle not reviewed", "cycles not reviewed"),
    "cycle-position": ("cycle with positions of its own", "cycles with positions of their own"),
    "cycle-plane": ("cycle outside the XY plane", "cycles outside the XY plane"),
    "fk-contour": ("free contour (FK)", "free contours (FK)"),
    "arc-unsupported": ("arc gEdit cannot compute", "arcs gEdit cannot compute"),
    "pole-unknown": ("move around a pole that is not known", "moves around a pole that is not known"),
    "resolution": ("block with a word that cannot hold the shift", "blocks with a word that cannot hold the shift"),
}
#: The information rows: a machine position is a return or a position in machine coordinates.
INFO_TEXT = {
    "return": ("return to the reference point", "returns to the reference point"),
    "machine-position": ("position in machine coordinates", "positions in machine coordinates"),
    "word-left": ("word gEdit cannot place", "words gEdit cannot place"),
}

#: NC-3 (P4a review): a Klartext `CYCL CALL POS` adds its tool-axis position to the surface
#: coordinate of the cycle it calls (TNC 640 cycle manual, cycle call with CYCL CALL POS: the
#: tool-axis coordinate acts as an additional datum shift), so a shift along the tool axis
#: moved by both the call and the definition would move the cycle twice, and moved by one of
#: them only would leave the other unmoved: refused, as address arithmetic refuses it. The
#: refusals carry these details; `collect` words their findings.
CALL_POSITION = "call-position"
CALLED_AT_POSITION = "called-at-position"
CALL_POSITION_TEXT = (
    "the %s of a cycle call at a position adds to the surface coordinate of the cycle, so a "
    "%s shift would move the cycle twice; a shift in %s alone can be made"
)
CALLED_AT_POSITION_TEXT = (
    "this cycle is called at a position (%s, line %d), whose %s adds to the surface coordinate "
    "of the cycle, so a %s shift would move the cycle twice; a shift in %s alone can be made"
)
#: The order of the findings of one line.
SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def trim(value: Decimal) -> str:
    """``1.25`` for ``Decimal('1.2500')``, ``0`` for zero, ``-2`` for ``-2.0``."""
    if value == 0:
        return "0"
    text = format(value.normalize(), "f")
    return text


def count_text(count: int, singular: str, plural: Optional[str] = None) -> str:
    return "%s %s" % ("{:,}".format(count), singular if count == 1 else (plural or singular + "s"))


def decimal_text(value: Any) -> Optional[Decimal]:
    """A form value as a decimal: a JSON number as the user typed it (``repr`` of a float
    gives its shortest form), or a numeric string; ``None`` for anything else."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return Decimal(repr(value))
    if isinstance(value, str) and value.strip() != "":
        try:
            found = Decimal(value.strip().replace(",", "."))
        except InvalidOperation:
            return None
        return found if found.is_finite() else None
    return None


def entry_params(entry: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    params = entry.get("params") if isinstance(entry, dict) else None
    return [p for p in params if isinstance(p, dict)] if isinstance(params, list) else []


# ---------------------------------------------------------------------------
# The form
# ---------------------------------------------------------------------------


class Params:
    """The run's parameters, checked. A value that cannot be used is an error, not a guess."""

    def __init__(self, values: Dict[str, Any], profile: Dict[str, Any]) -> None:
        addresses = as_dict(profile.get("addresses"))
        axes = {str(a).upper() for a in (addresses.get("axes") or []) if isinstance(a, str)}
        self.shift: Dict[str, Decimal] = {}
        for axis in AXES:
            raw = values.get(PARAM_IDS[axis])
            if raw is None or raw == "":
                number = Decimal(0)
            else:
                found = decimal_text(raw)
                if found is None:
                    raise ValueError("%s: %r is not a number." % (PARAM_LABELS[axis], raw))
                number = Decimal(trim(found))
            if number != 0 and axis not in axes:
                raise ValueError("%s: this control has no %s axis." % (PARAM_LABELS[axis], axis))
            self.shift[axis] = number
        decimals = values.get("decimals")
        if decimals not in (None, "", "keep"):
            raise ValueError("Decimal places: %r is not a choice of this form (As written)." % (decimals,))


# ---------------------------------------------------------------------------
# One run
# ---------------------------------------------------------------------------


class Line:
    """One line of the selection or the document, and what the run makes of it."""

    __slots__ = ("index", "number", "text", "block", "edits", "refusals", "notes")

    def __init__(self, index: int, number: int, text: str, block: int) -> None:
        self.index = index
        self.number = number
        self.text = text
        self.block = block
        #: (start, end, text) of every word that moves.
        self.edits: List[Tuple[int, int, str]] = []
        self.refusals: List[_nc_geom.Refusal] = []
        self.notes: List[_nc_geom.Refusal] = []


class Run:
    """Walks the program once with the tracker and judges every line with `_nc_geom`."""

    def __init__(self, context: Dict[str, Any], cp: Any, params: Params) -> None:
        self.context = context
        self.params = params
        self.tracker = _nc_path.PathTracker(context, cp, reach=False)
        self.cp = cp
        profile = self.tracker.profile
        self.profile = profile
        self.lathe = gedit_nc.machine_type_of(profile) == "lathe"
        self.machine = gedit_nc.machine_params(context)
        diameter = as_dict(self.machine.get("params")).get("diameter")
        #: How the form's X shift is meant (AD-43): on a turning program with a diameter X,
        #: as the machine reads X; on a mill X is a coordinate (a diameter word written with
        #: `DIAMON` on a mill moves by twice the shift, as address arithmetic does it).
        self.x_reading: Optional[str] = None
        if self.lathe and "X" in gedit_nc.diameter_axes(profile):
            self.x_reading = "radius" if diameter == "off" else "diameter"
        self.op = _nc_geom.Translate(dict(params.shift), self.x_reading)
        self.rotary = gedit_nc.RotaryState(profile)
        self.lines: List[Line] = []
        #: The units of the first block that states them: the units of the shift.
        self.units: Optional[str] = None
        self._ops: Dict[str, _nc_geom.Translate] = {}
        #: Lines whose moved words wait on a rotary axis not written yet, with those axes.
        self.pending_rotary: List[Tuple[Line, frozenset]] = []
        #: The first line where each rotary axis is known to stand turned.
        self.turned_at: Dict[str, int] = {}
        self.base_line = 1
        self.diameter_words = frozenset(gedit_nc.diameter_axes(profile))
        #: Whether the run is over a selection (then its edges are judged).
        self.is_selection = False
        #: What `moved` has answered, by spelling and reading.
        self._moved: Dict[Any, Any] = {}
        #: The roles of the line just judged (`note_rotary` reads them).
        self._roles: List[_nc_geom.WordRole] = []
        #: NC-3: the cycle definitions called at a position along a shifted tool axis, as
        #: (line of the definition, the call's line, the call's code, the tool axis).
        self.called_at: List[Tuple[int, int, str, str]] = []

    def op_for(self, units: Optional[str]) -> _nc_geom.Translate:
        """The shift in the units of a block: the form's shift is in the program's units (the
        first a block states); a block in the other units gets it converted, exactly where
        it can be (a conversion to inch that needs more decimals refuses at the word)."""
        if units is None or self.units is None or units == self.units:
            return self.op
        found = self._ops.get(units)
        if found is None:
            factor = INCH if (self.units, units) == ("inch", "mm") else Decimal(1) / INCH
            found = _nc_geom.Translate({a: v * factor for a, v in self.op.shift.items()}, self.x_reading)
            self._ops[units] = found
        return found

    # -- the walk ---------------------------------------------------------------

    def walk(self, preceding: Sequence[str], lines: Sequence[str], base_line: int) -> None:
        tracker = self.tracker
        cp = self.cp
        state = None
        continued = False
        self.base_line = base_line
        first_number = base_line - len(preceding)
        for offset, text in enumerate(preceding):
            state, step = tracker.line(text, first_number + offset, state, False)
            continued = any(t.kind == "continuation" for t in step.tokens)
            self.note_rotary(step, record=False)
        block = 0
        edge: Optional[_nc_geom.Refusal] = None
        if preceding and (continued or gedit_nc.continues_block(lines[0] if lines else "", cp)):
            # The selection starts on a continued line of a block above it.
            edge = _nc_geom.Refusal(base_line, "selection-inside", _quote(lines[0] if lines else ""), "the block starts above")
        last_line: Optional[Line] = None
        last_continued = False
        selection_continued = False
        for index, text in enumerate(lines):
            number = base_line + index
            head = gedit_nc.continues_block(text, cp)
            if index > 0 and not (last_continued or head):
                block += 1
            line = Line(index, number, text, block)
            self.lines.append(line)
            if edge is not None and index == 0:
                line.refusals.append(edge)
            state, step = tracker.line(text, number, state, True)
            if step.units is not None and self.units is None:
                self.units = step.units
            self.judge(line, step)
            self.call_position(line, step)
            self.note_rotary(step, record=True, line=line)
            self.selection_start(line, step)
            continues = any(t.kind == "continuation" for t in step.tokens)
            if text.strip() != "":
                # The trailing empty element of a selection that ends with a line break is
                # no line of the block: the last written line says whether it goes on.
                last_line = line
                selection_continued = continues
            last_continued = continues
        if self.is_selection:
            # CODE-3: every selection, from line 1 too (a cycle started in it can still be in
            # force below it).
            self.selection_end(last_line, selection_continued)
        self.settle_called_at()
        self.settle_rotary()

    # -- one line -----------------------------------------------------------------

    def judge(self, line: Line, step: _nc_path.Step) -> None:
        tracker = self.tracker
        context = self.context
        op = self.op_for(step.units)
        roles = _nc_geom.roles_of(step, tracker)
        refusals = list(_nc_geom.refusals_of(step, roles, tracker, op, context))
        notes = _nc_geom.notes_of(step, roles, tracker, op, context)
        edits: List[Tuple[int, int, str]] = []
        # A block refused for a reason that comes before every reason `moved` can give is listed
        # with that one, and the run writes nothing: its words are not moved.
        decided = bool(refusals) and min(REASON_PLACE[r.reason] for r in refusals) < MOVED_FROM
        for role in ([] if decided else roles):
            if not _nc_geom.affects(role, op):
                continue
            written = self.moved(role, op, step.units)
            if written is None:
                # refusals_of judges such a word (an expression, a reading the machine
                # decides); one it let through and that still has no value is not guessed.
                if not refusals:
                    refusals.append(_nc_geom.Refusal(line.number, "machine-dependent", _quote(line.text), role.token.text.strip()))
                continue
            if isinstance(written, _nc_geom.Refusal):
                # write_word does not know the line (plan §7 #298): it is set here.
                refusals.append(written._replace(line=line.number, written=_quote(line.text)))
                continue
            token = role.token
            if written.text != token.text:
                edits.append((token.start, token.end, written.text))
        line.edits = edits
        line.refusals.extend(refusals)
        line.notes = list(notes)
        self._roles = roles

    def moved(self, role: _nc_geom.WordRole, op: _nc_geom.Translate, units: Optional[str]) -> Any:
        """The word of ``role`` moved by ``op``: a ``Written``, a ``Refusal`` (line 0) or
        ``None`` when it has no value. A long program writes the same few hundred words again
        and again, so the answer is kept per spelling and reading (the word, its role, its
        number class, the block's units, and how a diameter word is read there)."""
        token = role.token
        address = (token.address or "").upper()
        reading = None
        if address in self.diameter_words or (role.role == "centre" and role.axis in self.diameter_words):
            # An absolute centre along the diameter axis is read like it (`I=AC(…)` under DIAMON).
            interp = self.tracker.interp
            reading = (interp.diameter_reading(address), as_dict(interp.state.get("diameter")).get("mode"))
        key = (token.text, role.role, role.axis, role.number_class, units, reading, id(op))
        found = self._moved.get(key, self._missing)
        if found is not self._missing:
            return found
        tracker = self.tracker
        value, _ = _nc_geom.read_word(role, tracker, units, self.context)
        if value is None:
            result: Any = None
        else:
            moved, exact = _nc_geom.transform(role.role, {role.axis: value}, op)
            result = _nc_geom.write_word(role, moved[role.axis], tracker, units, exact, self.context)  # type: ignore[index]
        if len(self._moved) > 20000:
            self._moved = {}
        self._moved[key] = result
        return result

    _missing = object()

    # -- a cycle called at a position (NC-3) ---------------------------------------

    def call_position(self, line: Line, step: _nc_path.Step) -> None:
        """A cycle call that writes its own position (Klartext `CYCL CALL POS X… Y… Z…`: a
        call whose database entry names its positions after the axes) while the shift along
        the tool axis is not zero: the call and the definition it runs are refused."""
        words = step.words or {}
        for entry, _, _ in step.entries:
            sets = entry.get("sets") if isinstance(entry.get("sets"), dict) else {}
            if sets.get("cycle") not in ("call", "call-modal"):
                continue
            named = [
                str(p.get("address")).upper()
                for p in entry_params(entry)
                if gedit_nc.position_of(p) == "other" and str(p.get("address")).upper() in AXES
            ]
            if not named or not any(axis in words for axis in named):
                # A call that writes none of its positions runs at positions kept elsewhere
                # (`CYCL CALL PAT`), which `_nc_geom` refuses on its own.
                continue
            axis = self.tool_axis()
            if axis not in named or self.params.shift[axis] == 0:
                continue
            code = str(entry.get("code"))
            line.refusals.append(_nc_geom.Refusal(line.number, "cycle-position", _quote(line.text), "%s:%s" % (CALL_POSITION, axis)))
            defined = as_dict(self.tracker.interp.state.get("definedCycle"))
            start = defined.get("line")
            if isinstance(start, int) and not isinstance(start, bool):
                self.called_at.append((start, line.number, code, axis))
            return

    def tool_axis(self) -> str:
        """The tool axis of the working plane in force; Z when the plane is not known, as
        `_nc_geom` reads it (it refuses a definition's tool-axis parameters there,
        `cycle-plane`, so a call's own position is then the only shift and moves once)."""
        plane = self.tracker.interp.state.get("plane")
        return _nc_path.PLANE_NORMAL.get(plane if isinstance(plane, str) else "XY", "Z")

    def settle_called_at(self) -> None:
        """The definition a cycle call at a position runs is refused with it, when it is in
        the run (one above a selection refuses the call as `selection-inside`)."""
        by_number = {line.number: line for line in self.lines}
        for start, call_line, code, axis in self.called_at:
            target = by_number.get(start)
            if target is None:
                continue
            if any(r.reason == "cycle-position" and r.detail.startswith(CALLED_AT_POSITION) for r in target.refusals):
                continue
            target.refusals.append(
                _nc_geom.Refusal(start, "cycle-position", _quote(target.text), "%s:%s:%d:%s" % (CALLED_AT_POSITION, code, call_line, axis))
            )

    # -- rotary axes not written yet (refusals_of leaves them to the walk) --------

    def note_rotary(self, step: _nc_path.Step, record: bool, line: Optional[Line] = None) -> None:
        rotary = self.rotary.rotary
        if not rotary:
            return
        after = step.after or {}
        for axis in rotary:
            if axis in self.turned_at:
                continue
            value = after.get(axis)
            if value is not None and value != 0:
                self.turned_at[axis] = step.line
            elif value is None and turned_blind(step, axis):
                # NC-10: an incremental index from a position nobody knows (`G91 G0 A90.` on
                # an axis the program has not written) leaves the axis turned somewhere.
                self.turned_at[axis] = step.line
        if not record or line is None or not line.edits or self.tracker.interp.tcp is not None:
            return
        before = step.before or {}
        waiting = set()
        for role in self._roles:
            if not _nc_geom.affects(role, self.op_for(step.units)):
                continue
            for axis in self.rotary.turning(role.axis or ""):
                if before.get(axis) is None and after.get(axis) is None:
                    waiting.add(axis)
        if waiting:
            self.pending_rotary.append((line, frozenset(waiting)))

    def settle_rotary(self) -> None:
        """A rotary axis not written yet when a block moved, and that the program writes to
        anything but zero at any point, stood somewhere nobody knows (address arithmetic's
        rule): the block is refused (`rotary-turned`)."""
        for line, axes in self.pending_rotary:
            later = sorted(a for a in axes if a in self.turned_at)
            if later and not any(r.reason == "rotary-turned" for r in line.refusals):
                line.refusals.append(_nc_geom.Refusal(line.number, "rotary-turned", _quote(line.text), ", ".join(later)))

    # -- the selection (contract item 6) ------------------------------------------

    def selection_start(self, line: Line, step: _nc_path.Step) -> None:
        """A block in the selection that runs a cycle started or defined above it."""
        if self.base_line <= 1 and not self.is_selection:
            return
        running = step.cycle
        if not running:
            return
        state = self.tracker.interp.state
        found = None
        for key in ("activeCycle", "definedCycle"):
            cycle = as_dict(state.get(key))
            if cycle.get("code") == running:
                found = cycle
                break
        start = found.get("line") if found is not None else None
        if isinstance(start, int) and start < self.base_line:
            if not any(r.reason == "selection-inside" for r in line.refusals):
                line.refusals.append(
                    _nc_geom.Refusal(line.number, "selection-inside", _quote(line.text), "%s (line %d)" % (running, start))
                )

    def selection_end(self, last: Optional[Line], continued: bool) -> None:
        """The selection ends inside a block (its last line goes on below it), while a modal
        cycle started in it is in force, or while a cycle defined in it, whose definition
        the shift changed, can still be called below it."""
        if last is None:
            return
        if continued:
            last.refusals.append(_nc_geom.Refusal(last.number, "selection-inside", _quote(last.text), "the block goes on below"))
        state = self.tracker.interp.state
        by_number = {line.number: line for line in self.lines}
        active = as_dict(state.get("activeCycle"))
        start = active.get("line")
        if isinstance(start, int) and start in by_number:
            target = by_number[start]
            target.refusals.append(
                _nc_geom.Refusal(start, "selection-inside", _quote(target.text), "%s is still in force at the end" % active.get("code"))
            )
            return
        defined = as_dict(state.get("definedCycle"))
        start = defined.get("line")
        if isinstance(start, int) and start in by_number:
            members = [line for line in self.lines if line.number >= start and line.block == by_number[start].block]
            if any(line.edits for line in members):
                target = by_number[start]
                target.refusals.append(
                    _nc_geom.Refusal(start, "selection-inside", _quote(target.text), "%s can be called below the selection" % defined.get("code"))
                )


def _quote(text: str) -> str:
    text = " ".join(text.split())
    limit = _nc_geom.QUOTE_LENGTH
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def turned_blind(step: _nc_path.Step, axis: str) -> bool:
    """Whether a move turns the rotary ``axis`` by an increment from a position not known: a
    word read as incremental (or in a distance mode not known) whose value is not zero (or
    cannot be read). A machine position, a data block and a frame are not moves of it."""
    if step.kind != "move":
        return False
    for read in step.reads or []:
        if read.axis != axis or read.incremental is False:
            continue
        literal = read.token.value if read.token is not None else None
        number = gedit_nc.decimal_of(literal) if literal is not None else None
        if number is None or number != 0:
            return True
    return False


#: The place of each reason of `_nc_geom.REASONS` in its order.
REASON_PLACE = {reason: place for place, reason in enumerate(_nc_geom.REASONS)}

#: The first place of the reasons `Run.moved` can add to a block (a word with no value, one that does not fit its form).
MOVED_FROM = min(REASON_PLACE[reason] for reason in ("expression", "machine-dependent", "distance-assumed", "resolution"))


def first_refusal(refusals: Sequence[_nc_geom.Refusal]) -> _nc_geom.Refusal:
    """The refusal a block is listed with: the first of `_nc_geom.REASONS` that applies."""
    return sorted(refusals, key=lambda r: (REASON_PLACE[r.reason], r.line))[0]


# ---------------------------------------------------------------------------
# Findings and the message
# ---------------------------------------------------------------------------


class Findings:
    """The findings of a run, capped so that a huge program cannot flood the panel."""

    def __init__(self, limit: int = MAX_FINDINGS) -> None:
        self.items: List[Dict[str, Any]] = []
        self.dropped = 0
        self.limit = limit

    def add(self, finding: Dict[str, Any]) -> None:
        if len(self.items) >= self.limit:
            self.dropped += 1
            return
        self.items.append(finding)


def own_text(refusal: _nc_geom.Refusal) -> Optional[str]:
    """The text of a refusal translate words itself (NC-3), or ``None``."""
    if refusal.reason != "cycle-position":
        return None
    parts = refusal.detail.split(":")
    axis = parts[-1]
    others = " and ".join(a for a in AXES if a != axis)
    if parts[0] == CALL_POSITION and len(parts) == 2:
        return CALL_POSITION_TEXT % (axis, axis, others)
    if parts[0] == CALLED_AT_POSITION and len(parts) == 4:
        return CALLED_AT_POSITION_TEXT % (parts[1], int(parts[2]), axis, axis, others)
    return None


def is_return(run: Run, note: _nc_geom.Refusal) -> bool:
    """A machine block whose code takes an intermediate point (`G28`, `G30`: the code
    declares its axis words), as opposed to a position in machine coordinates."""
    entry = run.tracker.interp.entry(note.detail) if note.detail else None
    return bool(entry_params(entry))


def collect(run: Run, findings: Findings) -> Tuple[Dict[str, int], Dict[str, int], int]:
    """The findings in line order; the counts of the refusals (by the first reason of each
    refused block) and of the information rows."""
    rows: List[Tuple[int, int, Dict[str, Any]]] = []
    refused: Dict[str, int] = {}
    info: Dict[str, int] = {}
    # One finding per refused block (a block written over several lines is one block): its
    # first reason in the order of `_nc_geom.REASONS`, at the line that has it.
    by_block: Dict[int, List[_nc_geom.Refusal]] = {}
    for line in run.lines:
        by_block.setdefault(line.block, []).extend(line.refusals)
    refused_blocks = {block for block, found in by_block.items() if found}
    for block in sorted(refused_blocks):
        first = first_refusal(by_block[block])
        refused[first.reason] = refused.get(first.reason, 0) + 1
        item = _nc_geom.finding_of(first)
        own = own_text(first)
        if own is not None:
            item["message"] = "%s: %s." % (first.written, own)
        rows.append((first.line, SEVERITY_ORDER[item["severity"]], item))
    for line in run.lines:
        for note in ([] if line.block in refused_blocks else line.notes):
            # A refused block is listed once, with its reason; what it would have left as
            # written does not matter any more.
            key = note.reason
            if key == "machine-position" and is_return(run, note):
                key = "return"
            info[key] = info.get(key, 0) + 1
            if note.reason == "word-left" and note.detail:
                # The word itself, as address arithmetic names a word it leaves.
                note = note._replace(written=_quote(note.detail))
            item = _nc_geom.finding_of(note)
            rows.append((line.number, SEVERITY_ORDER[item["severity"]], item))
    rows.sort(key=lambda row: (row[0], row[1]))
    for _, _, item in rows:
        findings.add(item)
    return refused, info, len(refused_blocks)


def shift_text(run: Run) -> str:
    """``X1.25 Y-2 Z0.5``; ``X1 (diameter) Z-2`` on a turning program; ``X0 Y0 Z0`` for no shift."""
    parts = []
    for axis in AXES:
        value = run.params.shift[axis]
        if value == 0:
            continue
        text = "%s%s" % (axis, trim(value))
        if axis == "X" and run.x_reading is not None:
            text += " (%s)" % run.x_reading
        parts.append(text)
    return " ".join(parts) if parts else "X0 Y0 Z0"


def machine_note(run: Run) -> str:
    """The machine, always last, as every script that reads numbers on the machine says it."""
    machine = run.machine
    if machine.get("id") is None:
        return "No machine chosen: a word whose reading depends on the machine would refuse the run."
    name = machine.get("name") or machine.get("id")
    params = as_dict(machine.get("params"))
    parts: List[str] = []
    if as_dict(machine.get("source")).get("numberInput") == "machine":
        number_input = as_dict(params.get("numberInput"))
        length = as_dict(as_dict(number_input.get("classes")).get("length"))
        mode = length.get("mode") or number_input.get("mode")
        inch = params.get("units") == "inch"
        unit = length.get("incrementInch" if inch else "increment") or number_input.get("incrementInch" if inch else "incrementMm")
        unit_name = "inch" if inch else "mm"
        if mode == "increment" and isinstance(unit, str):
            parts.append("numbers without a point are increments of %s %s" % (unit, unit_name))
        elif mode == "scale" and isinstance(unit, str):
            parts.append("every number counts in units of %s %s, with or without a point" % (unit, unit_name))
        elif mode == "calculator":
            parts.append("numbers are read as written")
    else:
        parts.append("it does not say how it reads numbers, so a word whose reading depends on that would refuse the run")
    if run.x_reading is not None:
        parts.append("X is a %s" % run.x_reading)
    return "Machine '%s': %s." % (name, "; ".join(parts))


def info_sentence(info: Dict[str, int]) -> Optional[str]:
    blocks = info.get("return", 0) + info.get("machine-position", 0)
    words = info.get("word-left", 0)
    if not blocks and not words:
        return None
    what = []
    if blocks:
        what.append(count_text(blocks, "block"))
    if words:
        what.append(count_text(words, "word"))
    parts = [count_text(info[key], *INFO_TEXT[key]) for key in ("return", "machine-position", "word-left") if info.get(key)]
    return "Left %s as written: %s." % (" and ".join(what), ", ".join(parts))


def summary(run: Run, findings: Findings, refused: Dict[str, int], info: Dict[str, int], blocks_refused: int) -> str:
    sentences: List[str] = []
    if blocks_refused:
        parts = [count_text(refused[reason], *REASON_TEXT.get(reason, (reason, reason))) for reason in _nc_geom.REASONS if refused.get(reason)]
        sentences.append(
            "Nothing was changed: %s cannot be moved by %s: %s."
            % (count_text(blocks_refused, "block"), shift_text(run), ", ".join(parts))
        )
    else:
        words = sum(len(line.edits) for line in run.lines)
        blocks = len({line.block for line in run.lines if line.edits})
        if words:
            sentences.append("Moved by %s: %s on %s." % (shift_text(run), count_text(words, "word"), count_text(blocks, "block")))
        else:
            sentences.append("Moved by %s: no word changed." % shift_text(run))
        left = info_sentence(info)
        if left is not None:
            sentences.append(left)
    if findings.dropped:
        sentences.append("%s further findings are not listed." % "{:,}".format(findings.dropped))
    sentences.append(machine_note(run))
    return " ".join(sentences)


def apply_edits(lines: Sequence[str], run: Run) -> List[str]:
    out = list(lines)
    for line in run.lines:
        if not line.edits:
            continue
        text = line.text
        parts: List[str] = []
        at = 0
        for start, end, new in sorted(line.edits):
            parts.append(text[at:start])
            parts.append(new)
            at = end
        parts.append(text[at:])
        out[line.index] = "".join(parts)
    return out


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main() -> int:
    context = gedit_nc.load_context()
    lines = gedit_nc.read_input()

    profile = context.get("profile")
    if not isinstance(profile, dict) or not profile:
        print(
            "Translate needs a dialect profile. Run it from gEdit, which puts the profile into "
            "the script context.",
            file=sys.stderr,
        )
        return 1
    try:
        cp = gedit_nc.compile_profile(profile)
    except ValueError as err:
        print("Translate cannot use this profile: %s" % err, file=sys.stderr)
        return 1
    try:
        params = Params(as_dict(context.get("params")), profile)
    except ValueError as err:
        print("Translate: %s" % err, file=sys.stderr)
        return 1

    text = "\n".join(lines)
    codes = context.get("codes") if isinstance(context.get("codes"), list) else []
    scope = as_dict(context.get("input"))
    start = scope.get("startLine")
    base_line = start if isinstance(start, int) and not isinstance(start, bool) and start >= 1 else 1
    # CODE-3: a selection is a selection from line 1 too (its end is judged); only one that
    # starts lower has lines above it to prime the walk with.
    selection = scope.get("scope") == "selection"
    fragment = selection and base_line > 1
    preceding = gedit_nc.preceding_lines(context) if fragment else []

    run = Run(context, cp, params)
    if not codes:
        gedit_nc.envelope(
            text,
            "Nothing was changed: this run had no code database, so it cannot tell a machine "
            "position, a frame or a cycle from a move. " + machine_note(run),
            [
                {
                    "line": base_line,
                    "severity": "error",
                    "message": "This run had no code database for this control; nothing was moved.",
                    "reason": "no-database",
                }
            ],
        )
        return 0
    if fragment and not preceding:
        # What is in force above the selection (the distance mode, the units, a frame, a
        # cycle) decides how its words are read; without it a move is a guess.
        gedit_nc.envelope(
            text,
            "Nothing was changed: this run saw only the selection, from line %d, so what is in "
            "force above it is not known. Run Translate on the whole program. %s" % (base_line, machine_note(run)),
            [
                {
                    "line": base_line,
                    "severity": "error",
                    "message": "The lines above the selection were not available, so the distance mode, the "
                    "units, a frame and a cycle in force there are not known; nothing was moved.",
                    "reason": "selection-unprimed",
                }
            ],
        )
        return 0

    run.is_selection = selection
    run.walk(preceding, lines, base_line)
    findings = Findings()
    refused, info, blocks_refused = collect(run, findings)
    out = lines if blocks_refused else apply_edits(lines, run)
    gedit_nc.envelope("\n".join(out), summary(run, findings, refused, info, blocks_refused), findings.items)
    return 0


if __name__ == "__main__":
    sys.exit(main())
