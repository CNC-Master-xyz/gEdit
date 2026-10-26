#!/usr/bin/env python3
# /// gedit
# name = "Extents"
# description = "The smallest and largest value of every axis, for the whole program, per work offset and per tool, with arc extremes. A value the script cannot be sure of is counted as not resolved, never guessed."
# input = "selection-or-document"
# output = "report"
# timeout = 300
# ///
"""The extents of a program (plan §6 M10 WP10.3; `nc-transformations.md`, "Extents").

The smallest and largest value of every axis — for the whole program, per work offset and
per tool inside it — so a wrong depth or a stray coordinate shows up without a backplot.
The report format is ``tests/fixtures/scripts/extents/README.md``; this docstring says how
the values are found.

**Effective values only.** Every word goes through ``gedit_nc.number_class_of`` and
``gedit_nc.resolve_value``: ``Z1000`` is 1 mm on an IS-B machine and 1000 mm on a calculator
one, and with no machine chosen a word the profile's presets read differently has no value
at all (AD-31, D57). Such a word is **not resolved**: it is counted in its row and named in
a finding, never put into a range with an assumed reading. So is everything else the script
cannot be sure of — a variable, a position inside a coordinate frame, an incremental word
whose start is not known, a cycle whose positions are its parameters. A range is a claim,
and an honest "not resolved" is worth more than a confident wrong minimum.

**What the data decides** (roadmap R3; no list of machine codes in this file):

* a code with ``axisWords: 'machine'`` (``G28``, ``G53``, ``M91``, ``SUPA``) makes its block a
  machine position: listed in rows of its own, never in a range, and the axes it moved are
  in an unknown place of the program's frame afterwards;
* ``axisWords: 'data'`` / ``wordsAreData`` (``G92``, ``G52``, ``G10``, ``CYCL DEF 7``,
  ``TRANS``, a dwell's ``X``) — values, not positions: left out, one ``info`` per code; a
  code with ``pole: 'set'`` is the **pole** (Klartext ``CC``), the centre of the arcs and
  polar moves after it; a code with ``shift`` (``G52``, ``G92``, ``TRANS``) starts a group
  of its own, ``G54 + G52 (line 8)``, because the positions after it are in another system;
* a linear position written while a rotary axis that turns it (ISO 841) stands turned, or
  at an angle not known, and tool centre point control is off is a position of the
  machine's axes, not of the workpiece: not resolved (``gedit_nc.RotaryState``, which address
  arithmetic reads too);
* a cycle start whose words are data (the Fanuc lathe ``G71``–``G73``): the control
  computes its passes, so they are not resolved;
* a drilling cycle the code database describes step by step (``CodeEntry.expand``, the
  roles of its parameters, plan §6.3) is read the way ``expand_cycles.py`` writes it out
  (v1.2.0, P4.7b, T108): ``_nc_cycles.holes_of`` gives each hole's position and every level
  it goes to, so the ranges reach the bottom of a Klartext 200/201 (``Q203 + Q201``) and of a
  Sinumerik ``CYCLE81``–``CYCLE89`` (``RFP − DPR``, or ``DP`` where ``DPR`` is 0), the set-up
  clearance and the return level, every hole of a repeat count and the point of a
  ``CYCL CALL POS``, and the extents of the program and of its expansion are the same (X23).
  A cycle the expansion refuses (no description, as Klartext 203; a value it cannot read; a
  return mode only assumed) stays as the tracker reads it: a Fanuc cycle's bottom from its
  ``Z`` word under ``G90`` (under ``G91`` it is measured from the R point: not resolved), a
  cycle whose positions are its parameters not resolved;
* a code of the ``offset`` group (``G54``–``G59``, ``CYCL DEF 247``) starts a work-offset
  group; the modal ``frame`` (§7.4 rule 13) makes a position not resolved; tool centre point
  control (``tcp``, rule 14) does not: under it ``X``/``Y``/``Z`` are the tool tip;
* incremental words: the distance mode (``sets.distance``), the profile's
  ``addresses.incremental`` (R6's ``U``/``W`` choice, on the effective profile) and the
  Klartext ``I`` prefix; the plane (``sets.plane``, Klartext's tool axis, rule 15).

**One X column, in diameter values** on a turning profile (``addresses.diameter``): each
word is read by ``ModalInterpreter.diameter_reading`` (AD-19 rule 11), and a radius word —
``DIAMOF``, or ``DIAM90`` under incremental distance — counts double, so a program that
switches never mixes the two in one range. A milling profile that lists diameter words
(``sinumerik-mill``) keeps a plain ``X`` column, and a diameter word there counts half.

**The geometry is the path tracker's** (``_nc_path``, AD-48): where the tool is, the arcs
with their centres and extremes, the polar moves and every reason a position is not known.
The arc direction is data (``CodeSets.arcDirection`` of the motion code, the profile's
``addresses.arcDirectionWords``); the few geometry words the arcs need (radius, polar, turns
and opening-angle words) stand in ``_nc_path`` and nowhere else. This script keeps its
ranges, scopes and texts, and replays what the tracker found into them.

A run over a **selection** is primed from ``input.precedingLines`` (modal state *and*
positions), so an incremental move or an arc right at the top of the selection starts where
the program really is; without the field it starts from the power-on state and says so.

Standard library only, Python 3.9 and newer, like every bundled script. It never changes
the document.
"""

from __future__ import annotations

import sys
from decimal import Decimal
from typing import Any, Dict, List, Optional, Sequence, Tuple

import _nc_cycles
import _nc_path
import gedit_nc
from _nc_path import PathTracker, Reach, Step, Unknown, as_dict, literal_of, rounded

TITLE = "Extents"

COLUMNS = [
    {"key": "where", "label": "Where"},
    {"key": "axis", "label": "Axis"},
    {"key": "min", "label": "Min"},
    {"key": "minLine", "label": "At line"},
    {"key": "max", "label": "Max"},
    {"key": "maxLine", "label": "At line"},
    {"key": "unresolved", "label": "Not resolved"},
]


#: Decimals a range value is written with, by kind: millimetres and degrees, inches.
DECIMALS = {"mm": 4, "inch": 5, "angle": 4}
_ZERO = Decimal(0)

#: v1.2.0 (P4.7b): the axes a drilling cycle's holes move (``_nc_cycles``: the plane XY and the
#: tool axis Z; a cycle in another plane is not written out, so it has no holes).
HOLE_AXES = ("X", "Y", "Z")
#: The peck values the holes of the extents are worked out with. The high-speed peck retract
#: (``G73``) and the deep peck clearance (``G83``) are settings of the control that only shape
#: the moves between the R point and the bottom of the hole (a retract after a peck, a rapid
#: back down to just above the last bottom), never a level outside them, so the extents do
#: not ask for them: a retract of 0 and the smallest clearance stand in, and the levels of the
#: hole (the start, the R point, the bottom, the return level) are the ones the expansion
#: writes with any values of the form.
HOLE_PECKS = _nc_cycles.PeckValues(retract=Decimal(0), clearance=Decimal("0.001"))


def text_of(value: Decimal, places: int) -> str:
    """How a range value is written: rounded, no trailing zeros, no ``-0``."""
    out = rounded(value, places)
    if out == _ZERO:
        return "0"
    text = format(out.normalize(), "f")
    return text


# ---------------------------------------------------------------------------
# The ranges
# ---------------------------------------------------------------------------


class Range:
    """The smallest and the largest value of one axis in one scope, and what was not resolved."""

    __slots__ = ("low", "low_line", "high", "high_line", "unresolved", "first_unresolved")

    def __init__(self) -> None:
        self.low: Optional[Decimal] = None
        self.low_line = 0
        self.high: Optional[Decimal] = None
        self.high_line = 0
        self.unresolved = 0
        self.first_unresolved = 0

    def add(self, value: Decimal, line: int) -> None:
        # The first line that reached the value: a later line with the same value keeps it.
        # (A position held back until the end of the walk, `Extents.held`, comes in late, so
        # an equal value from an earlier line still wins.)
        if self.low is None or value < self.low or (value == self.low and line < self.low_line):
            self.low, self.low_line = value, line
        if self.high is None or value > self.high or (value == self.high and line < self.high_line):
            self.high, self.high_line = value, line

    def miss(self, line: int) -> None:
        self.unresolved += 1
        if self.first_unresolved == 0 or line < self.first_unresolved:
            self.first_unresolved = line


class Scope:
    """One block of rows: the program, a work-offset group, a tool inside it."""

    def __init__(self, kind: str, where: str) -> None:
        self.kind = kind
        self.where = where
        self.ranges: Dict[str, Range] = {}

    def range(self, axis: str) -> Range:
        found = self.ranges.get(axis)
        if found is None:
            found = Range()
            self.ranges[axis] = found
        return found

    def empty(self) -> bool:
        return not self.ranges


class Group:
    """A work-offset group and the tools that cut in it, in order of first use."""

    def __init__(self, code: Optional[str], line: int, label: str) -> None:
        self.code = code
        self.line = line
        self.scope = Scope("offset", label)
        self.label = label
        self.tools: Dict[str, Scope] = {}
        self.order: List[str] = []
        self.positions = False
        #: The work offset a shifted group is in (`G54`, or "No work offset").
        self.base = label.split(" (line")[0]



# ---------------------------------------------------------------------------
# What the program could not tell us
# ---------------------------------------------------------------------------

#: Kind -> (severity, the sentence after the count). The order is the order of the findings
#: for one line; the ids are what a test counts (`reason`, ignored by the app).
KINDS = {
    "machine-dependent": "warning",
    "expression": "warning",
    "distance-unknown": "warning",
    "diameter-unknown": "warning",
    "incremental-start": "warning",
    "called-program": "warning",
    "frame": "warning",
    "unknown-code": "warning",
    "multi-pass": "warning",
    "cycle": "warning",
    "cycle-position": "warning",
    "arc": "warning",
    "polar": "warning",
    "rotary": "warning",
    "data": "info",
    "selection": "info",
}


class Findings:
    """One finding per kind (and per code where the code is the news), counted."""

    def __init__(self) -> None:
        self.found: Dict[Tuple[str, str], Dict[str, Any]] = {}

    def add(self, kind: str, line: int, detail: str = "", key: str = "", **extra: Any) -> None:
        slot = self.found.get((kind, key))
        if slot is None:
            slot = {"kind": kind, "line": line, "count": 0, "detail": detail, "key": key}
            slot.update(extra)
            self.found[(kind, key)] = slot
        elif line < slot["line"]:
            # A held-back position (`Extents.held`) is counted at the end of the walk.
            slot.update({"line": line, "detail": detail})
            slot.update(extra)
        slot["count"] += 1

    def out(self) -> List[Dict[str, Any]]:
        rows = sorted(self.found.values(), key=lambda s: (s["line"], list(KINDS).index(s["kind"]), s["key"]))
        return [
            {"line": s["line"], "severity": KINDS[s["kind"]], "message": message_of(s), "reason": s["kind"]}
            for s in rows
        ]


def times(count: int, one: str, many: str) -> str:
    return ("1 " + one) if count == 1 else ("%d %s" % (count, many))


def message_of(s: Dict[str, Any]) -> str:
    """The sentence of one finding (our words; the goldens pin them)."""
    kind, count, detail = s["kind"], s["count"], s["detail"]
    if kind == "machine-dependent":
        readings = s.get("readings") or ""
        if callable(readings):
            readings = readings()
        return (
            "%s, first %s: the value depends on how the machine reads a number%s. Not "
            "resolved; choose a machine for this document to read them."
            % (times(count, "word", "words"), detail, (" (" + readings + ")") if readings else "")
        )
    if kind == "expression":
        return "%s written as a variable or an expression, first %s: not resolved." % (
            times(count, "word", "words"),
            detail,
        )
    if kind == "distance-unknown":
        return (
            "%s, first %s, before the program says whether positions are absolute or "
            "incremental: not resolved." % (times(count, "word", "words"), detail)
        )
    if kind == "diameter-unknown":
        return (
            "%s, first %s, where it is not known whether X is a diameter or a radius "
            "(an absolute-only diameter mode before the distance mode is known): not resolved."
            % (times(count, "word", "words"), detail)
        )
    if kind == "incremental-start":
        return (
            "%s, first %s, move from a position the program does not state (the start, or "
            "after a machine position, a cycle, a frame or a value that was not resolved): "
            "not resolved." % (times(count, "incremental word", "incremental words"), detail)
        )
    if kind == "called-program":
        return (
            "%s, first %s, in %s before it states the axis: a called program moves from "
            "where the program that calls it left the tool, which the file does not say, so "
            "they are not resolved." % (times(count, "incremental word", "incremental words"), detail, s["key"])
        )
    if kind == "frame":
        return (
            "%s inside the coordinate frame of %s: they are in that frame's coordinates, "
            "not the program's, so they are not resolved." % (times(count, "position", "positions"), detail)
        )
    if kind == "unknown-code":
        return (
            "%s: a code the code database does not know, in %s; the %s of %s are not "
            "resolved, because the code may move them outside the program's frame."
            % (detail, times(count, "block", "blocks"), "positions", "those blocks")
        )
    if kind == "multi-pass":
        return (
            "%s, %s: the control computes the passes of this cycle from its values; the "
            "start point and the profile are in the ranges, the passes are not resolved."
            % (detail, times(count, "block", "blocks"))
        )
    if kind == "cycle":
        return (
            "%s, run in %s: the positions this cycle works to are in its parameters, which "
            "the extents do not compute; they are not resolved (its depth is not in the %s "
            "range)." % (detail, times(count, "block", "blocks"), s.get("names") or "tool-axis")
        )
    if kind == "cycle-position":
        return (
            "%s, %s: its axis words are positions of the cycle it calls, not of the tool, so "
            "they are not resolved." % (detail, times(count, "block", "blocks"))
        )
    if kind == "arc":
        return (
            "%s, first %s, whose centre or plane is not known: the end points are in the "
            "ranges, the arc between them is not resolved." % (times(count, "arc", "arcs"), detail)
        )
    if kind == "polar":
        return (
            "%s, first %s, that cannot be resolved from the pole (no pole, no radius or "
            "angle to start from, or a value that was not resolved)." % (times(count, "polar move", "polar moves"), detail)
        )
    if kind == "rotary":
        return (
            "%s, first %s, written while %s stood turned (or at an angle that is not known) and "
            "tool centre point control was off: they are positions of the machine's axes, not "
            "of the workpiece, so they are not resolved." % (times(count, "position", "positions"), detail, s.get("names") or "a rotary axis")
        )
    if kind == "data":
        return "%s, %s: its axis words are values, not positions; left out of the ranges." % (
            detail,
            times(count, "block", "blocks"),
        )
    if kind == "selection":
        return (
            "The lines above the selection were not sent, so this run starts from the "
            "power-on state: a position or a mode set above it is not known here."
        )
    return detail  # pragma: no cover - every kind is above


# ---------------------------------------------------------------------------
# The walk
# ---------------------------------------------------------------------------


class Extents:
    """Walks a program and collects its ranges.

    Where the tool is comes from :class:`_nc_path.PathTracker` (AD-48): each line's
    :class:`_nc_path.Step` lists what the path reached and what it could not tell, in the
    order the extents count them, and this class replays it into the ranges after its own
    work for the line (offsets, shifts, the held rotary positions, the tool words)."""

    def __init__(self, context: Dict[str, Any], cp: gedit_nc.CompiledProfile) -> None:
        self.tracker = PathTracker(context, cp)
        self.profile = self.tracker.profile
        self.cp = cp
        self.codes = self.tracker.codes
        self.interp = self.tracker.interp
        self.machine = self.tracker.machine
        self.axes = self.tracker.axes
        self.findings = Findings()
        #: v1.2.0 (P4.7b): the holes of the drilling cycles, read as the expansion reads them;
        #: a turning program's drilling cycles are not written out (``expand_cycles.py``).
        self.context = context
        self.holes_on = gedit_nc.machine_type_of(self.profile) != "lathe" and bool(self.codes)

        self.program = Scope("program", "Program")
        self.groups: List[Group] = []
        self.offset_codes = 0
        self.machine_rows: List[Dict[str, Any]] = []
        self.record = False
        self.diameter_start: Optional[Dict[str, Any]] = None
        self.diameter_switches: List[Tuple[str, int]] = []
        #: M10 review (NC-10): where the rotary axes stand while nothing compensates them, the
        #: linear axes the current block's turned rotary axes take out of the ranges, and the
        #: positions held back until the walk shows whether an unwritten rotary axis is ever
        #: written: (scopes, axis, value, line, the unwritten axes).
        self.rotary = gedit_nc.RotaryState(self.profile)
        self.tilt: Dict[str, Tuple[frozenset, frozenset]] = {}
        self._tilts: Dict[Any, Dict[str, Tuple[frozenset, frozenset]]] = {}
        self.held: List[Tuple[List[Scope], str, Decimal, int, frozenset]] = []
        self._tilt_missed: set = set()
        self.linear_axes = [axis for axis in self.axes.order if axis not in self.axes.angular]
        #: M10 review (NC-7): the coordinate shift in force (`G52 (line 8)`), if any.
        self.shift: Optional[str] = None
        #: M13 review (NC-9): the tool word of each tool line, as written (`T010101`).
        self.tool_words: Dict[int, str] = {}
        tool_list = as_dict(self.profile.get("toolList"))
        self.drop_leading_zeros = tool_list.get("dropLeadingZeros") is True
        self.collapse_offset_digits = tool_list.get("collapseOffsetDigits") is True

    # -- what the tracker knows -----------------------------------------------

    @property
    def pos(self) -> Dict[str, Optional[Decimal]]:
        """The position of every axis, in column values, or ``None`` while it is not known."""
        return self.tracker.pos

    @property
    def report_units(self) -> Optional[str]:
        return self.tracker.report_units

    @property
    def units_switched(self) -> bool:
        return self.tracker.units_switched

    # -- scopes ---------------------------------------------------------------

    def group(self) -> Group:
        if not self.groups:
            self.groups.append(Group(None, 0, "No work offset"))
        return self.groups[-1]

    def change_offset(self, code: str, line: int, has_values: bool) -> None:
        """A code of the `offset` group: a new group when it changes the offset."""
        self.offset_codes += 1
        current = self.groups[-1] if self.groups else None
        if current is not None and current.code == code and not (has_values and current.positions):
            return
        if current is not None and not current.positions and current.scope.empty():
            # Nothing was measured in the group it replaces: drop it rather than list an
            # empty group (`G54` written twice before the first move).
            self.groups.pop()
        self.groups.append(Group(code, line, "%s (line %d)" % (code, line)))

    def shift_group(self, code: str, line: int) -> None:
        """NC-7: a code that shifts or sets the coordinate system (`CodeEntry.shift`): the
        positions after it are in another system than those before, so a group of their own,
        named after the work offset it is in (`G54 + G52 (line 8)`)."""
        self.offset_codes += 1
        current = self.group()
        base = current.base
        if not current.positions and current.scope.empty() and current.code is not None:
            self.groups.pop()
        group = Group(current.code, line, "%s + %s (line %d)" % (base, code, line))
        group.base = base
        self.groups.append(group)

    def tool_scope(self) -> Optional[Scope]:
        tool = self.interp.tool
        if tool is None:
            return None
        station = str(tool.get("station") or tool.get("written") or "")
        group = self.group()
        scope = group.tools.get(station)
        if scope is None:
            written = str(tool.get("written") or station).strip()
            line = tool.get("line") if isinstance(tool.get("line"), int) else 0
            # M13 review (NC-9): the tool as the tool list and the map name it, and the word
            # as written when that says more (`T1 (T010101, line 9)`).
            label = gedit_nc.tool_label(str(tool.get("station") or written), self.drop_leading_zeros, self.collapse_offset_digits)
            word = self.tool_words.get(line, written)
            if label == "":
                label = word
            scope = Scope("tool", "%s (line %d)" % (label, line) if word == label else "%s (%s, line %d)" % (label, word, line))
            group.tools[station] = scope
            group.order.append(station)
        return scope

    def scopes(self) -> List[Scope]:
        group = self.group()
        out = [self.program, group.scope]
        tool = self.tool_scope()
        if tool is not None:
            out.append(tool)
        return out

    def note(self, axis: str, value: Decimal, line: int) -> None:
        if not self.record:
            return
        tilt = self.tilt.get(axis)
        if tilt is not None:
            turned, unwritten = tilt
            if turned:
                if (axis, line) not in self._tilt_missed:
                    self._tilt_missed.add((axis, line))
                    names = " and ".join(sorted(turned))
                    self.miss(axis, line, "rotary", "%s (line %d)" % (axis, line), key=names, names=names)
                return
            if unwritten:
                self.group().positions = True
                self.held.append((self.scopes(), axis, value, line, unwritten))
                return
        self.group().positions = True
        for scope in self.scopes():
            scope.range(axis).add(value, line)

    def settle_held(self) -> None:
        """NC-10: a position written before a rotary axis that turns it was first written, to
        anything but zero, is not resolved after all (where that axis stood is not known); the
        others go into their ranges now."""
        for scopes, axis, value, line, unwritten in self.held:
            later = self.rotary.known_later(unwritten)
            if not later:
                for scope in scopes:
                    scope.range(axis).add(value, line)
                continue
            for scope in scopes:
                scope.range(axis).miss(line)
            names = " and ".join(later)
            self.findings.add("rotary", line, "%s (line %d)" % (axis, line), key=names, names=names)
        self.held = []

    def track_rotary(self, moves, entries, state, line: int) -> None:
        """NC-10: the rotary axes after this block, and the linear axes they take out of the
        ranges while tool centre point control is off and no frame is open."""
        rotary = self.rotary
        before = rotary.state
        words = []
        distance = state["distance"]
        for axis, token in moves:
            if axis not in rotary.rotary:
                continue
            literal, function = literal_of(token)
            address = token.address.upper()
            if address in rotary.twins or token.incremental or function == "incremental":
                incremental: Optional[bool] = True
            elif function == "absolute" or distance == "absolute":
                incremental = False
            elif distance == "incremental":
                incremental = True
            else:
                incremental = None
            words.append((address, literal, incremental))
        flags = [gedit_nc.axis_words_of(e) for e in entries]
        if words and "data" not in flags:
            # A data block's words (a macro call's `A1.`) move no axis; a machine position
            # moves it to a place the program's frame does not state.
            before = dict(before)
            rotary.update(words, line, "machine" in flags)
        if self.interp.tcp is not None or self.interp.frame is not None:
            self.tilt = {}
            return
        after = rotary.state
        key = (tuple(sorted(before.items())), tuple(sorted(after.items())))
        found = self._tilts.get(key)
        if found is None:
            found = {}
            for axis in self.linear_axes:
                turned, unwritten = rotary.blocking(axis, before, after)
                if turned or unwritten:
                    found[axis] = (turned, unwritten)
            self._tilts[key] = found
        self.tilt = found

    def miss(self, axis: str, line: int, kind: str, detail: str = "", key: str = "", **extra: Any) -> None:
        """One position of one axis that is not resolved, and the finding that says why."""
        self.miss_axes([axis], line, kind, detail, key, **extra)

    def miss_axes(self, axes: Sequence[str], line: int, kind: str, detail: str = "", key: str = "", **extra: Any) -> None:
        """One thing that left a position of each of ``axes`` not resolved: one finding."""
        if not self.record:
            return
        axes = [axis for axis in axes if axis in self.axes.known]
        if axes:
            self.group().positions = True
            for scope in self.scopes():
                for axis in axes:
                    scope.range(axis).miss(line)
        self.findings.add(kind, line, detail, key, **extra)

    def replay(self, events: Sequence[Any]) -> None:
        """The tracker's events of one line, in its order: a point reached goes into the
        ranges, a position not known is counted with its finding."""
        for event in events:
            if isinstance(event, Reach):
                self.note(event.axis, event.value, event.line)
                continue
            extra = dict(event.extra or {})
            if event.kind == "machine-dependent":
                # The text of the readings is only built for the finding that is kept: a program
                # with thousands of such words asks for one sentence, not thousands.
                r, a, u = extra.pop("readings", []), extra.pop("angle", False), extra.pop("units", None)
                extra["readings"] = lambda r=r, a=a, u=u: readings_text(r, a, u)
            self.miss_axes(event.axes, event.line, event.kind, event.detail, event.key, **extra)

    # -- one line -------------------------------------------------------------

    def line(self, line: str, number: int, state: Optional[gedit_nc.LineState], record: bool) -> Optional[gedit_nc.LineState]:
        if record and self.diameter_start is None:
            # The mode the run starts in: before its first line, which may switch it.
            diameter = self.interp.state["diameter"]
            self.diameter_start = dict(diameter) if diameter is not None else {}
        state, step = self.tracker.line(line, number, state, record)
        # Asked on every line, the priming lines too: a definition, a `MCALL` line and a cycle
        # block leave the values the later blocks run with (`_nc_cycles.holes_of`).
        holes = _nc_cycles.holes_of(step, self.tracker, HOLE_PECKS, self.context)[0] if self.holes_on else []
        tool = self.interp.tool
        if tool is not None and tool.get("line") == number:
            self.tool_words[number] = self.tool_word(step.tokens, step.masked, tool)
        self.record = record
        self.block(step, number, holes)
        return state

    def tool_word(self, tokens: Sequence[gedit_nc.Token], masked: str, tool: Dict[str, Any]) -> str:
        """NC-9: the word of a tool line that names the tool (`T010101`, `T="ROUGH"`), or the
        text the profile's pattern matched when no word of an address does (`TOOL CALL 1 Z`)."""
        written = str(tool.get("written") or "").strip()
        station = str(tool.get("station") or "")
        at = masked.find(written) if written else -1
        if at >= 0 and station:
            for token in tokens:
                if token.kind != "word" or not token.address or token.start >= at + len(written) or token.end <= at:
                    continue
                if station in token.text:
                    return token.text.strip()
        return written

    def block(self, step: Step, line: int, holes: Sequence[_nc_cycles.Hole] = ()) -> None:
        moves = step.moves
        for entry, code, _ in step.entries:
            sets = as_dict(entry.get("sets"))
            if sets.get("diameter") in ("on", "off", "absolute-only") and self.record:
                self.diameter_switches.append((code, line))

        # Work offsets come first: the block's own positions are in the new offset.
        for entry, code, _ in step.entries:
            if entry.get("group") == "offset":
                self.change_offset(code, line, bool(moves) and gedit_nc.axis_words_of(entry) == "data")
            elif entry.get("shift") is True and self.record and (moves or self.bare(step.tokens, step.entries)):
                self.shift_group(code, line)

        if not moves and not step.calls and not step.entries and not step.events:
            # v1.2.0 (NCF-C): a block that writes only the taper of the pass in force (`R-1.`)
            # runs the pass again, and its taper start is an event of its own.
            return
        entries = [e for e, _, _ in step.entries]
        if self.rotary.rotary:
            self.track_rotary(moves, entries, self.interp.state, line)
        if step.kind == "machine":
            self.machine_block(step, entries, line)
        if holes:
            self.replay([e for e in step.events if not self.hole_event(e)])
            self.note_holes(step, holes)
            return
        self.replay(step.events)

    # -- the drilling cycles (v1.2.0, P4.7b) ----------------------------------

    @staticmethod
    def hole_event(event: Any) -> bool:
        """Whether the tracker's ``event`` is about where a cycle's holes take the tool (the
        plane and the tool axis), which the holes say instead: the block's own move to the hole,
        a bottom it reads from the block's words, the depth it leaves not resolved."""
        if isinstance(event, Reach):
            return event.axis in HOLE_AXES
        return isinstance(event, Unknown) and bool(event.axes) and all(axis in HOLE_AXES for axis in event.axes)

    def note_holes(self, step: Step, holes: Sequence[_nc_cycles.Hole]) -> None:
        """Every point the holes of a block reach: each hole's position at its start level,
        the end of every move (the R point or the set-up clearance, each peck, the bottom, a
        lift-off, the return level) and where it ends; in the block's units, as the
        expansion writes them, converted to the report's."""
        units = step.units if step.units in ("mm", "inch") else as_dict(self.interp.state.get("units")).get("value")
        units = units if units in ("mm", "inch") else "mm"
        report = self.report_units if self.report_units in ("mm", "inch") else units
        for hole in holes:
            points: List[Tuple[str, Decimal]] = list(hole.position.items()) + [("Z", hole.start)]
            for move in hole.moves:
                points.extend(move.to.items())
            points.extend(hole.end.items())
            for axis, value in points:
                if axis not in self.axes.known:
                    continue
                if units != report:
                    value = value * _nc_path.INCH if units == "inch" else value / _nc_path.INCH
                self.note(axis, value, hole.line)

    # -- the kinds of block ---------------------------------------------------

    def bare(self, tokens: Sequence[gedit_nc.Token], entries) -> bool:
        """A block that writes no value besides its codes (`TRANS` alone: a reset)."""
        values = sum(1 for t in tokens if t.kind == "word" and (t.value_text or "") != "")
        codes = sum(1 for _, _, kind in entries if kind == "word")
        return values <= codes

    def machine_block(self, step: Step, entries, line: int) -> None:
        """A machine position: rows of its own (the tracker has forgotten the axes it moved)."""
        code = next(c for e, c, _ in step.entries if gedit_nc.axis_words_of(e) == "machine")
        where = "%s (line %d)" % (code, line)
        for axis, token in step.moves:
            if not self.record:
                continue
            address = token.text[: len(token.text) - len(token.value_text or "")] if token.value_text else token.text
            value, _ = self.tracker.value(token, step.units, entries)
            self.machine_rows.append(
                {
                    "where": where,
                    "scope": "machine",
                    "axis": address.strip().rstrip("=") or axis,
                    "axisId": axis,
                    "min": self.fmt(axis, value) if value is not None else "",
                    "minLine": line if value is not None else "",
                    "max": self.fmt(axis, value) if value is not None else "",
                    "maxLine": line if value is not None else "",
                    "unresolved": 0 if value is not None else 1,
                    "line": line,
                }
            )

    # -- output ---------------------------------------------------------------

    def fmt(self, axis: str, value: Decimal) -> str:
        if axis in self.axes.angular:
            return text_of(value, DECIMALS["angle"])
        return text_of(value, DECIMALS.get(self.report_units or "mm", 4))

    def rows_of(self, scope: Scope) -> List[Dict[str, Any]]:
        out = []
        for axis in self.axes.order:
            r = scope.ranges.get(axis)
            if r is None:
                continue
            row: Dict[str, Any] = {"where": scope.where, "scope": scope.kind, "axis": self.axes.label(axis), "axisId": axis}
            if r.low is not None:
                row.update(
                    {
                        "min": self.fmt(axis, r.low),
                        "minLine": r.low_line,
                        "max": self.fmt(axis, r.high),
                        "maxLine": r.high_line,
                    }
                )
            else:
                row.update({"min": "", "minLine": "", "max": "", "maxLine": ""})
            row["unresolved"] = r.unresolved
            row["line"] = r.high_line if r.low is not None else r.first_unresolved
            out.append(row)
        return out

    def rows(self) -> List[Dict[str, Any]]:
        self.settle_held()
        out = self.rows_of(self.program)
        with_offsets = self.offset_codes > 0
        for group in self.groups:
            if group.scope.empty():
                continue
            if with_offsets:
                out.extend(self.rows_of(group.scope))
            for station in group.order:
                scope = group.tools[station]
                if scope.empty():
                    continue
                if with_offsets:
                    scope = Scope(scope.kind, "%s, %s" % (group.label.split(" (line")[0], scope.where))
                    scope.ranges = group.tools[station].ranges
                out.extend(self.rows_of(scope))
        out.extend(self.machine_rows)
        return out

    def message(self) -> str:
        self.settle_held()
        parts: List[str] = []
        if self.machine.get("id") is not None and isinstance(self.machine.get("name"), str):
            parts.append("Machine %r." % self.machine["name"])
        else:
            parts.append(
                "No machine: readings assumed from the profile defaults, and a word whose "
                "reading depends on the machine is not resolved."
            )
        if self.axes.lathe_column:
            parts.append(self.diameter_text())
        if self.units_switched:
            parts.append("The program switches units; every length is given in %s." % (self.report_units or "mm"))
        if self.program.empty() and not self.machine_rows:
            parts.append("No positions found.")
        else:
            missed = sum(r.unresolved for r in self.program.ranges.values())
            if missed:
                parts.append("%s not resolved; the findings say why." % times(missed, "position", "positions"))
        return " ".join(parts)

    def diameter_text(self) -> str:
        start = self.diameter_start or {}
        mode = start.get("mode")
        if not start.get("assumed", True) and isinstance(start.get("line"), int) and start.get("line"):
            source = "line %d" % start["line"]
        else:
            source = {
                "machine": "the machine",
                "detected": "detected in the program",
            }.get(start.get("from"), "assumed from the profile")
        if mode == "on":
            text = "X is a diameter: diameter programming is on (%s)." % source
        elif mode == "off":
            text = (
                "X is shown as a diameter: diameter programming is off at the start (%s), so "
                "a radius value counts double." % source
            )
        elif mode == "absolute-only":
            text = (
                "X is shown as a diameter: X is a diameter while positions are absolute and a "
                "radius while they are incremental (%s); a radius value counts double." % source
            )
        else:
            text = "X is shown as a diameter; the diameter mode is not known at the start."
        if self.diameter_switches:
            shown = ", ".join("%s (line %d)" % pair for pair in self.diameter_switches[:5])
            more = len(self.diameter_switches) - 5
            text += " The program switches it: %s%s; a radius value counts double." % (
                shown,
                " and %d more" % more if more > 0 else "",
            )
        return text


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def readings_text(readings: Sequence[Dict[str, Any]], angle: bool, units: Optional[str]) -> str:
    """`IS-B: 1 mm; calculator: 1000 mm`, the readings of the presets, the default first."""
    unit = "°" if angle else (" " + (units or "mm"))
    parts = []
    for reading in readings:
        label = reading.get("preset") or reading.get("label") or ""
        value = reading.get("value")
        shown = ("%s%s" % (text_of(Decimal(value), 6), unit)) if value is not None else "no value"
        parts.append("%s: %s" % (label, shown))
    return "; ".join(parts)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main() -> int:
    context = gedit_nc.load_context()
    profile = context.get("profile")
    if not isinstance(profile, dict) or not profile:
        print(
            "Extents needs a dialect profile. Run it from gEdit, which puts the profile into "
            "the script context.",
            file=sys.stderr,
        )
        return 1
    try:
        cp = gedit_nc.compile_profile(profile)
    except ValueError as err:
        print("Extents cannot use this profile: %s" % err, file=sys.stderr)
        return 1

    lines = gedit_nc.read_input()
    scope = as_dict(context.get("input"))
    start = scope.get("startLine")
    first = start if isinstance(start, int) and not isinstance(start, bool) and start >= 1 else 1
    above = gedit_nc.preceding_lines(context)

    walk = Extents(context, cp)
    state: Optional[gedit_nc.LineState] = None
    for number, line in enumerate(above, first - len(above)):
        state = walk.line(line, number, state, record=False)
    if scope.get("scope") == "selection" and first > 1 and not above:
        walk.findings.add("selection", first)
    # A trailing newline leaves one empty element that is not a line of the program.
    if len(lines) > 1 and lines[-1] == "":
        lines = lines[:-1]
    for number, line in enumerate(lines, first):
        state = walk.line(line, number, state, record=True)
    walk.settle_held()

    gedit_nc.report(TITLE, COLUMNS, walk.rows(), walk.message(), walk.findings.out())
    return 0


if __name__ == "__main__":
    sys.exit(main())
