#!/usr/bin/env python3
# /// gedit
# name = "Statistics and Time"
# description = "Adds up the feed and rapid lengths of a program per tool and works out a time estimate from the machine's rapid rates, top feed and tool-change time: feed time, rapid time, dwell time, tool-change time and the total. Opens the table, or a CSV, in a new document. The estimate is a lower bound, and every block it cannot time is listed. Changes nothing."
# input = "selection-or-document"
# output = "new-document"
# timeout = 900
# envelope = true
#
# [[params]]
# id = "peckRetract"
# type = "number"
# prefill = "machine.motion.peckRetract"
# label = "High-speed peck retract (G73)"
# help = "How far the drill pulls back between the pecks of a high-speed peck cycle. A setting of the control, not of the program: read it off the machine. Without it such a cycle is not estimated."
# min = 0
#
# [[params]]
# id = "peckClearance"
# type = "number"
# prefill = "machine.motion.peckClearance"
# label = "Deep peck clearance (G83)"
# help = "How far above the last depth the drill comes back down at rapid in a deep peck cycle. A setting of the control, not of the program: read it off the machine. Without it such a cycle is not estimated."
# min = 0
#
# [[params]]
# id = "motionUnits"
# type = "choice"
# prefill = "machine.motion.units"
# label = "Units of the rates"
# help = "The unit of the rapid rates, the top feed and the peck values below: mm or inch (per minute for a rate). A rotary axis's rate is in degrees per minute."
# choices = [
#   { label = "mm", value = "mm" },
#   { label = "inch", value = "inch" }
# ]
#
# [[params]]
# id = "rapidX"
# type = "number"
# prefill = "machine.motion.rapid.X"
# label = "Rapid rate X (per minute)"
# help = "The rapid traverse rate of the X axis, from the machine's documentation. Empty: the rapid time is not set."
# min = 0
#
# [[params]]
# id = "rapidY"
# type = "number"
# prefill = "machine.motion.rapid.Y"
# label = "Rapid rate Y (per minute)"
# help = "The rapid traverse rate of the Y axis, from the machine's documentation."
# min = 0
#
# [[params]]
# id = "rapidZ"
# type = "number"
# prefill = "machine.motion.rapid.Z"
# label = "Rapid rate Z (per minute)"
# help = "The rapid traverse rate of the Z axis, from the machine's documentation."
# min = 0
#
# [[params]]
# id = "rapidA"
# type = "number"
# prefill = "machine.motion.rapid.A"
# label = "Rapid rate A (degrees per minute)"
# help = "The rapid rate of the A axis, in degrees per minute. Only needed where the program turns it at rapid."
# min = 0
#
# [[params]]
# id = "rapidB"
# type = "number"
# prefill = "machine.motion.rapid.B"
# label = "Rapid rate B (degrees per minute)"
# help = "The rapid rate of the B axis, in degrees per minute. Only needed where the program turns it at rapid."
# min = 0
#
# [[params]]
# id = "rapidC"
# type = "number"
# prefill = "machine.motion.rapid.C"
# label = "Rapid rate C (degrees per minute)"
# help = "The rapid rate of the C axis, in degrees per minute. Only needed where the program turns it at rapid."
# min = 0
#
# [[params]]
# id = "rapidKind"
# type = "choice"
# prefill = "machine.motion.rapidKind"
# label = "Rapid moves"
# help = "Straight: all axes move on one line, at the rate of the slowest axis that moves (the longer, safer estimate). Each axis at its own rate: every axis runs at its own rate and the move takes as long as the slowest one. Empty is read as straight."
# choices = [
#   { label = "Straight", value = "straight" },
#   { label = "Each axis at its own rate", value = "per-axis" }
# ]
#
# [[params]]
# id = "maxFeed"
# type = "number"
# prefill = "machine.motion.maxFeed"
# label = "Top cutting feed (per minute)"
# help = "The highest feed the machine cuts at. A programmed feed above it is timed at it. Empty: no feed is limited."
# min = 0
#
# [[params]]
# id = "toolChange"
# type = "number"
# prefill = "machine.motion.toolChange"
# label = "Tool-change time (seconds)"
# help = "How long one tool change takes on this machine. Empty: the tool-change time is not set."
# min = 0
#
# [[params]]
# id = "format"
# type = "choice"
# label = "Output"
# help = "A table to read, or comma-separated values for a spreadsheet."
# default = "table"
# choices = [
#   { label = "Table", value = "table" },
#   { label = "CSV", value = "csv" }
# ]
# ///
"""Statistics and Time (Phase 4 plan §5 P4b, P4.9; AD-47; exit criterion X24; plan §6.4 rule 6).

The file is ``time_estimate.py``, not the plan's first ``statistics.py``: the bundled folder is on
``PYTHONPATH`` for every script, and a ``statistics.py`` there hides the standard library's module of
that name (``tests/python/test_script_names.py``).

Walks the program once with the path tracker (``_nc_path``) and adds up, per tool (per channel
where the program has channels, as the tool list does) and in total: the feed length, the rapid
length, the tool changes, and the feed, rapid, dwell, tool-change and total times. It keeps no
list of codes of its own: whether a move is a rapid or a feed move, what a dwell is, which feed
unit is in force, where a program calls a subprogram, comes from the code database and the modal
interpreter; a drilling cycle with a schema is timed through ``_nc_cycles.holes_of``, the very
moves the expansion would write (plan §6.3 rule 13). The frame (the form check, the scope, the
lines above a selection, the machine sentence) is ``_nc_run``'s. The output is a new document: the
table, or the CSV, with the message and the findings in the envelope.

Never a number of gEdit's
-------------------------
Lengths are always given. A time needs its machine value: a rapid time the rapid rates of the
axes that move, a tool-change time the tool-change time; without it the cell says ``not set``, a
finding names the value, and the total is ``not set`` too. Nothing is assumed: a value the form
leaves empty is never replaced by a typical one. The form is prefilled from the machine's motion
block (``prefill``, plan §6.4 rule 5), and the user may change it for the run.

How a move is timed (plan §6.4 rule 6)
--------------------------------------
* A **feed move** takes its length divided by the feed at 100 %; a feed above the top feed is
  timed at the top feed (and counted "clamped by the top feed"). A feed per revolution is
  multiplied by the spindle speed in force; under **constant surface speed** the speed follows the
  diameter along the move, held by the clamp in force (``G50 S``, ``LIMS=``) or else by the
  machine's top spindle speed (``limits.spindle.main``), and the move is split where the clamp
  starts to hold. An **inverse-time** block takes 1 / F minutes. A **travel-time** block (Sinumerik
  ``G931``, ``sets.feedUnit: 'travel-time'``, triage T085) takes F seconds, the number as written;
  where its length divided by that time is above the top feed it takes the length divided by the
  top feed and is counted "clamped by the top feed".
* A **rapid**: ``straight`` moves all axes on one line at the rate of the slowest axis that moves
  (the path length divided by the lowest rate, the longer and safer estimate, Q4-11); ``per-axis``
  moves every axis at its own rate and takes the longest of each axis's distance divided by its
  rate. ``rapidKind`` left empty is read as ``straight`` and the message says so. A rotary axis
  turns at its rate in degrees per minute.
* A **dwell** counts as written, from the dwell code's ``dwell`` form (``CodeEntry.dwell``):
  seconds, the machine's least time increments (``G4 P500``), revolutions at the speed in force,
  or the lines of a Klartext dwell cycle.
* A **drilling cycle** with a schema is timed move by move from its holes; the peck values come
  from the form (Q4-9).
* A **tool change** (the profile's ``toolCall.trigger``) counts once for the tool it loads.

What is not estimated
---------------------
Each block below is counted with its line, in the table and as a finding, and never guessed; the
estimate is then a lower bound of what the listed blocks add (the message says so in one line in
any case: 100 % override, no acceleration, no block time, no look-ahead). The kinds, in the order
the message counts them (:data:`KINDS`): ``multi-pass`` (a cycle the control works out passes for
from its data: the Fanuc lathe ``G71``–``G73``, a multi-pass thread cycle), ``thread`` (a thread
move or pass), ``contour`` (a Klartext free contour, FK), ``pattern`` (a cycle called on a pattern,
``CYCL CALL PAT``), ``lap`` (Okuma LAP), ``per-tooth`` (a feed per tooth: the tooth count is not
known), ``call`` (a subprogram call, a jump or a loop: gEdit counts each block once), ``rotary-rate``
(a move of a rotary axis without its rate), ``cycle`` (a cycle without a schema, or one whose holes
refuse, with its reason), ``peck-retract-missing``, ``peck-clearance-missing``, ``position-unknown``
(a move whose start or end is not known: the first moves of a program, after a move to a machine
position), and two kinds the plan does not list, proposed with this script: ``feed-unknown`` (a feed
move whose feed cannot be read: no feed, a variable, a feed unit or speed not set, a reading that
depends on the machine) and ``dwell-unknown`` (a dwell whose time cannot be read; in a drilling
cycle that dwell only: the moves of its holes are counted, fix batch 2, NC-K). A cycle block the
expansion refuses is ``cycle`` with the expansion's reason; a block that runs no cycle of its own
(a feed alone under ``MCALL``) is named by the cycle in force. Whether a block calls a subprogram,
jumps or loops is ``_nc_cycles.call_of``, the expansion's own detector (a cycle entry is no call).

A program with channels is reported per channel; the channels run at the same time, so the
message names the longest channel's time and never adds the channels up.

The golden format is ``tests/fixtures/scripts/README.md``, "The drilling and time goldens", under
``tests/fixtures/scripts/statistics/<case>/``.
"""

from __future__ import annotations

import csv
import io
import math
import re
import sys
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, List, NamedTuple, Optional, Sequence, Tuple

import gedit_nc
import _nc_cycles
import _nc_geom
import _nc_path
import _nc_run
from _nc_run import as_dict, count_text, decimal_text

#: The script's name in an error on stderr.
SCRIPT = "Statistics and Time"

_ZERO = Decimal(0)
_SIXTY = Decimal(60)
INCH = Decimal("25.4")

#: The form's labels, for its errors.
PARAM_LABELS = {
    "peckRetract": "High-speed peck retract (G73)",
    "peckClearance": "Deep peck clearance (G83)",
    "motionUnits": "Units of the rates",
    "rapidKind": "Rapid moves",
    "maxFeed": "Top cutting feed",
    "toolChange": "Tool-change time",
    "format": "Output",
}
#: The rapid rate fields, by the axis they are for (plan §6.4 rule 6).
RAPID_FIELDS = {"X": "rapidX", "Y": "rapidY", "Z": "rapidZ", "A": "rapidA", "B": "rapidB", "C": "rapidC"}

#: What is not estimated: id -> (one, several, why), in the order the message counts them. The
#: first twelve are plan §6.4 rule 6's; ``feed-unknown`` and ``dwell-unknown`` are proposed with
#: this script.
KINDS = {
    "multi-pass": ("multi-pass cycle", "multi-pass cycles", "the control works out the passes of this cycle from its data"),
    "thread": ("thread", "threads", "a thread move or pass is not timed"),
    "contour": ("free contour block", "free contour blocks", "a free contour (FK): its points depend on the elements around it"),
    "pattern": ("cycle called on a pattern", "cycles called on a pattern", "the cycle runs at points kept in a pattern or a point table"),
    "lap": ("LAP block", "LAP blocks", "the control works out the passes of a LAP cycle from its contour"),
    "per-tooth": ("feed per tooth", "feeds per tooth", "a feed per tooth needs the tooth count of the tool, which the program does not give"),
    "call": ("subprogram call, jump or loop", "subprogram calls, jumps or loops", "a subprogram call, a jump or a loop: gEdit counts each block once and does not follow it"),
    "rotary-rate": ("move of a rotary axis", "moves of a rotary axis", "the rate of the rotary axis is not known"),
    "cycle": ("cycle", "cycles", "the cycle is not timed"),
    "peck-retract-missing": ("cycle without the high-speed peck retract", "cycles without the high-speed peck retract", _nc_cycles.REASONS["peck-retract-missing"]),
    "peck-clearance-missing": ("cycle without the deep peck clearance", "cycles without the deep peck clearance", _nc_cycles.REASONS["peck-clearance-missing"]),
    "position-unknown": ("move whose start or end is not known", "moves whose start or end is not known", "where the move starts or ends is not known"),
    "feed-unknown": ("move whose feed cannot be read", "moves whose feed cannot be read", "the feed of this move cannot be read"),
    "dwell-unknown": ("dwell whose time cannot be read", "dwells whose time cannot be read", "the time of this dwell cannot be read"),
}
KIND_ORDER = {kind: place for place, kind in enumerate(KINDS)}

#: The order of the refusal reasons of ``_nc_cycles`` (the first one of a block names it).
REASON_PLACE = {reason: place for place, reason in enumerate(_nc_cycles.REASONS)}

#: The plain line of plan §6.4 rule 6.
LOWER_BOUND = (
    "The estimate is a lower bound: it counts 100 % feed and rapid override, no acceleration, "
    "no time to read a block and no look-ahead."
)

#: At most this many findings; the rest are counted in the message.
MAX_FINDINGS = 1000
#: At most this many line numbers per kind in a table cell.
MAX_LINES_SHOWN = 20

#: A row before the program's first tool.
NO_TOOL = "No tool"
OUTSIDE_NAME = "Outside the channels"
TOTAL = "Total"


# ---------------------------------------------------------------------------
# The form
# ---------------------------------------------------------------------------


class Params:
    """The run's form, checked (plan §6.4 rule 6): every value empty or a number in its range; a
    value that is not a number refuses the run with the plain text of what is wrong."""

    def __init__(self, values: Dict[str, Any], profile: Dict[str, Any]) -> None:
        def number(key: str, label: str, positive: bool) -> Optional[Decimal]:
            raw = values.get(key)
            if raw is None or raw == "":
                return None
            found = decimal_text(raw)
            if found is None:
                raise ValueError("%s: %r is not a number." % (label, raw))
            if positive and found <= _ZERO:
                raise ValueError("%s: a value above 0 is needed, not %s." % (label, _nc_run.trim(found)))
            if found < _ZERO:
                raise ValueError("%s: a value of 0 or more is needed, not %s." % (label, _nc_run.trim(found)))
            return found

        def choice(key: str, allowed: Sequence[str], default: Optional[str]) -> Optional[str]:
            raw = values.get(key)
            if raw is None or raw == "":
                return default
            if not isinstance(raw, str) or raw not in allowed:
                raise ValueError("%s: %r is not one of %s." % (PARAM_LABELS[key], raw, ", ".join(allowed)))
            return raw

        self.pecks = _nc_cycles.PeckValues(
            retract=number("peckRetract", PARAM_LABELS["peckRetract"], False),
            clearance=number("peckClearance", PARAM_LABELS["peckClearance"], False),
        )
        self.units = choice("motionUnits", ("mm", "inch"), None)
        self.rapid: Dict[str, Decimal] = {}
        for axis, key in RAPID_FIELDS.items():
            found = number(key, "Rapid rate %s" % axis, True)
            if found is not None:
                self.rapid[axis] = found
        self.rapid_kind = choice("rapidKind", ("straight", "per-axis"), None)
        self.max_feed = number("maxFeed", PARAM_LABELS["maxFeed"], True)
        self.tool_change = number("toolChange", PARAM_LABELS["toolChange"], False)
        self.format = choice("format", ("table", "csv"), "table")


# ---------------------------------------------------------------------------
# What a row adds up
# ---------------------------------------------------------------------------


class Totals:
    """The sums of one row (a tool, a channel's total), or of one block before it is added."""

    __slots__ = ("feed_len", "rapid_len", "feed_s", "rapid_s", "dwell_s", "changes", "rapid_unset", "change_unset", "skipped", "clamped")

    def __init__(self) -> None:
        self.feed_len = _ZERO
        self.rapid_len = _ZERO
        self.feed_s = _ZERO
        self.rapid_s = _ZERO
        self.dwell_s = _ZERO
        self.changes = 0
        #: A rapid whose rate is not in the form: the rapid time is "not set".
        self.rapid_unset = False
        #: A tool change without the tool-change time.
        self.change_unset = False
        #: Not estimated: kind -> the lines, in order.
        self.skipped: Dict[str, List[int]] = {}
        self.clamped = 0

    def add(self, other: "Totals") -> None:
        self.feed_len += other.feed_len
        self.rapid_len += other.rapid_len
        self.feed_s += other.feed_s
        self.rapid_s += other.rapid_s
        self.dwell_s += other.dwell_s
        self.changes += other.changes
        self.rapid_unset = self.rapid_unset or other.rapid_unset
        self.change_unset = self.change_unset or other.change_unset
        for kind, lines in other.skipped.items():
            self.skipped.setdefault(kind, []).extend(lines)
        self.clamped += other.clamped

    def skipped_count(self) -> int:
        return sum(len(lines) for lines in self.skipped.values())


class Skip(Exception):
    """A block that is not estimated: its kind (:data:`KINDS`) and what it concerns."""

    def __init__(self, kind: str, detail: str = "") -> None:
        Exception.__init__(self, kind)
        self.kind = kind
        self.detail = detail


class Feed(NamedTuple):
    """How a feed move is timed: ``mode`` ``'rate'`` (``value`` per minute, in the report units),
    ``'css'`` (``value`` the feed per revolution, under constant surface speed), ``'inverse'``
    (``value`` is F of 1 / F minutes) or ``'seconds'`` (a travel time of ``value`` seconds)."""

    mode: str
    value: Decimal


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _dec(value: float) -> Decimal:
    return Decimal(repr(value))


def _sets(entry: Any) -> Dict[str, Any]:
    return as_dict(as_dict(entry).get("sets"))


def _params(entry: Any) -> List[Dict[str, Any]]:
    return _nc_run.entry_params(entry if isinstance(entry, dict) else None)


def _number(text: Optional[str]) -> Optional[Decimal]:
    """A written number (a word's value text) as its exact value, or ``None``."""
    if text is None:
        return None
    literal = gedit_nc.parse_number(text.strip())
    return gedit_nc.decimal_of(literal) if literal is not None else None


def lines_text(lines: Sequence[int]) -> str:
    """``12, 14-16, 20``: the lines, runs of consecutive ones joined, at most
    :data:`MAX_LINES_SHOWN` numbers."""
    unique = sorted(set(lines))
    runs: List[Tuple[int, int]] = []
    for number in unique:
        if runs and number == runs[-1][1] + 1:
            runs[-1] = (runs[-1][0], number)
        else:
            runs.append((number, number))
    parts: List[str] = []
    shown = 0
    for first, last in runs:
        if shown >= MAX_LINES_SHOWN:
            parts.append("…")
            break
        parts.append(str(first) if first == last else "%d-%d" % (first, last))
        shown += 1 if first == last else 2
    return ", ".join(parts)


def seconds_text(value: Decimal) -> str:
    """Seconds to 0.1 s, as the CSV writes them (``75.3``)."""
    return str(value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def clock_text(value: Decimal) -> str:
    """Seconds as the table shows them: ``1:15.3`` (minutes, seconds), ``1:02:03.4`` past an hour."""
    tenths = int((value * 10).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    whole, tenth = divmod(tenths, 10)
    minutes, seconds = divmod(whole, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return "%d:%02d:%02d.%d" % (hours, minutes, seconds, tenth)
    return "%d:%02d.%d" % (minutes, seconds, tenth)


def length_text(value: Decimal, inch: bool) -> str:
    """A length to 0.01 mm (0.001 in)."""
    return str(value.quantize(Decimal("0.001") if inch else Decimal("0.01"), rounding=ROUND_HALF_UP))


def _quote(text: str) -> str:
    return _nc_run.quote(text)


# ---------------------------------------------------------------------------
# The walk
# ---------------------------------------------------------------------------


class Walk:
    """One walk over the lines of one channel (or of the whole input) with the path tracker."""

    def __init__(self, context: Dict[str, Any], cp: Any, params: Params, channel: Optional[str]) -> None:
        self.context = context
        self.cp = cp
        self.params = params
        self.channel = channel
        self.tracker = _nc_path.PathTracker(context, cp, reach=False, flow=False)
        self.interp = self.tracker.interp
        self.profile = self.tracker.profile
        self.axes = self.tracker.axes
        self.codes = [e for e in self.tracker.codes if isinstance(e, dict)]
        addresses = as_dict(self.profile.get("addresses"))
        self.feed_address = str(addresses.get("feed") or "F").upper()
        rapid = addresses.get("rapid")
        self.rapid_word = gedit_nc.normalize_code(rapid) if isinstance(rapid, str) and rapid else None
        self.lathe = gedit_nc.machine_type_of(self.profile) == "lathe"
        #: The axis whose distance from the turning centre sets the speed under constant surface speed.
        self.radial = "X" if self.lathe and "X" in self.axes.known else None
        tool_list = as_dict(self.profile.get("toolList"))
        self.drop_zeros = tool_list.get("dropLeadingZeros") is True
        self.collapse = tool_list.get("collapseOffsetDigits") is True
        #: The groups of the Okuma LAP: a code of a group that holds a ``contour`` code.
        self.contour_groups = frozenset(e.get("group") for e in self.codes if e.get("contour") is not None and isinstance(e.get("group"), str))
        self.in_contour = False
        self.limits = _nc_cycles.machine_limits(context)
        self.machine = gedit_nc.machine_params(context)
        #: The rows by tool label, in order of first use.
        self.rows: Dict[str, Totals] = {}
        self.current = NO_TOOL
        #: Where the tool stands where the tracker no longer follows it: after a drilling cycle.
        self.held: Dict[str, Decimal] = {}
        self.called: Optional[str] = None
        #: The contour of a roughing cycle (the Fanuc lathe `G71 P(ns) Q(nf)`): the block numbers
        #: ns and nf while ns is still ahead, then nf while the walk is inside the contour. The
        #: control runs the contour inside the cycle (and with `G70`) and goes on after block nf
        #: (FANUC 30i lathe manual, multiple repetitive cycles, G71); the blocks are not counted
        #: where they stand.
        self.contour_ahead: Optional[Tuple[int, int]] = None
        self.contour_end: Optional[int] = None
        #: The axes whose position is not known after such a contour, until a block writes them.
        self.lost: set = set()
        #: The findings of the walk (not estimated, clamped), and the first line each missing
        #: form value was needed on.
        self.findings: List[Dict[str, Any]] = []
        self.missing: Dict[str, int] = {}
        self.rapid_read_straight: Optional[int] = None
        self.dwell_increment: Optional[Tuple[Optional[Decimal], str]] = None
        self.report_units = "mm"

    # -- lines --------------------------------------------------------------------

    def walk(self, preceding: Sequence[str], lines: Sequence[str], numbers: Sequence[int]) -> None:
        tracker = self.tracker
        state = None
        first = (numbers[0] if numbers else 1) - len(preceding)
        for offset, text in enumerate(preceding):
            state, step = tracker.line(text, first + offset, state, False)
            holes, refusals = _nc_cycles.holes_of(step, tracker, self.pecks_for(step), self.context)
            self.observe(step, step.line, count=False)
            self.update_held(step, holes, bool(getattr(step, "cycle", None) or refusals), bool(refusals))
        for text, number in zip(lines, numbers):
            state, step = tracker.line(text, number, state, True)
            holes, refusals = _nc_cycles.holes_of(step, tracker, self.pecks_for(step), self.context)
            self.report_units = tracker.report_units or self.report_units
            if self.in_roughing_contour(text):
                continue
            self.observe(step, number, count=True)
            block = Totals()
            try:
                self.block(step, text, holes, refusals, block)
            except Skip as skip:
                self.skip(step, text, skip, number)
            else:
                self.row().add(block)
            # Where the holes leave the tool is known even where their time is not.
            self.update_held(step, holes, bool(getattr(step, "cycle", None) or refusals), bool(refusals))
            if self.lost:
                self.lost -= {r.axis for r in getattr(step, "reads", None) or [] if r.incremental is False and r.value is not None}

    def in_roughing_contour(self, text: str) -> bool:
        """Whether the line is a block of the contour of a roughing cycle (:attr:`contour_ahead`):
        not counted where it stands. After block nf the tool stands where the cycle left it, which
        the walk does not follow: every axis is not known until a block writes it."""
        if self.contour_ahead is None and self.contour_end is None:
            return False
        found = gedit_nc.block_number_of(text, self.cp)
        number = found.get("value") if found else None
        if self.contour_end is None:
            assert self.contour_ahead is not None
            if number != self.contour_ahead[0]:
                return False
            self.contour_end = self.contour_ahead[1]
            self.contour_ahead = None
        if number == self.contour_end:
            self.contour_end = None
            self.lost = set(self.axes.order)
            self.held = {}
        return True
    def row(self) -> Totals:
        found = self.rows.get(self.current)
        if found is None:
            found = self.rows[self.current] = Totals()
        return found

    def observe(self, step: Any, number: int, count: bool) -> None:
        """The tool change of the line, and the Okuma LAP contour it opens or closes."""
        tool = self.interp.tool
        if tool is not None and tool.get("line") == number and self.interp.state["block"].get("toolChange"):
            label = gedit_nc.tool_label(str(tool.get("station")), self.drop_zeros, self.collapse)
            self.current = label
            if count:
                row = self.row()
                row.changes += 1
                if self.params.tool_change is None:
                    row.change_unset = True
                    self.missing.setdefault("toolChange", number)
        for entry, _, _ in getattr(step, "entries", None) or []:
            flag = entry.get("contour")
            if flag == "open":
                self.in_contour = True
            elif flag == "close":
                self.in_contour = False

    def skip(self, step: Any, text: str, skip: Skip, number: int, out: Optional[Totals] = None) -> None:
        """Lists the block as not estimated: in its row, or in ``out``, the block's own sums, where
        only a part of the block is left out (a cycle's dwell, NC-K)."""
        row = out if out is not None else self.row()
        row.skipped.setdefault(skip.kind, []).append(number)
        why = KINDS[skip.kind][2]
        detail = " (%s)" % skip.detail if skip.detail else ""
        self.findings.append(
            {"line": number, "severity": "warning", "message": "%s: not estimated: %s%s." % (_quote(text), why, detail), "reason": skip.kind}
        )

    # -- where the tool stands ------------------------------------------------------

    def start_of(self, step: Any) -> Dict[str, Optional[Decimal]]:
        pos = dict(getattr(step, "before", None) or {})
        for axis, value in self.held.items():
            if pos.get(axis) is None:
                pos[axis] = value
        for axis in self.lost:
            pos[axis] = None
        return pos

    def update_held(self, step: Any, holes: List[Any], ran: bool, refused: bool = False) -> None:
        """Where the tool stands after the line on the axes the tracker leaves "not known" because a
        drilling cycle moved it (the tool axis at its return level, ``Step.levels``; the plane axes
        after a cycle called at a point): the end of the last hole, carried while no block writes
        the axis (an increment from it included) and nothing makes it unknown for another reason (a
        move to a machine position, a block that may set any coordinate, a program after the first).
        A cycle block that drills no hole and is not refused (Fanuc ``K0`` without a position: the
        control stores the values and drills nothing) leaves the tool where it stood (fix batch 7)."""
        after = getattr(step, "after", None) or {}
        held: Dict[str, Decimal] = {}
        called = getattr(self.tracker, "called", None)
        if called != self.called:
            self.called = called
            self.held = {}
            return
        if holes:
            units = self.block_units(step)
            for axis, value in holes[-1].end.items():
                if after.get(axis) is None:
                    held[axis] = self.to_report(value, units)
            self.held = held
            return
        if ran and not refused:
            # Fix batch 7: no hole, no move; the tracker forgets the tool axis after a cycle block.
            before = getattr(step, "before", None) or {}
            for axis in set(before) | set(self.held):
                if after.get(axis) is None:
                    value = before.get(axis)
                    value = value if value is not None else self.held.get(axis)
                    if value is not None:
                        held[axis] = value
            self.held = held
            return
        if ran:
            # A cycle whose holes are not known (refused): where it leaves the tool is not known.
            self.held = {}
            return
        if not self.held:
            return
        entries = [e for e, _, _ in getattr(step, "entries", None) or []]
        if getattr(step, "kind", None) == "machine" or any(e.get("wordsAreData") is True for e in entries):
            self.held = {}
            return
        for axis, value in self.held.items():
            if after.get(axis) is not None:
                continue
            total: Optional[Decimal] = value
            for read in getattr(step, "reads", None) or []:
                if read.axis == axis:
                    increment = self.increment_of(read, step)
                    total = total + increment if total is not None and increment is not None else None
            if total is not None:
                held[axis] = total
        self.held = held

    def increment_of(self, read: Any, step: Any) -> Optional[Decimal]:
        if read.incremental is not True or self.axes.lathe_column and read.axis == "X":
            return None
        value, _ = self.tracker.value(read.token, getattr(step, "units", None), [e for e, _, _ in getattr(step, "entries", None) or []])
        return value

    def end_of(self, step: Any, start: Dict[str, Optional[Decimal]]) -> Dict[str, Optional[Decimal]]:
        """Where the block leaves the tool, the held axes (:meth:`update_held`) included."""
        end = dict(getattr(step, "after", None) or {})
        for axis, value in list(end.items()):
            if value is not None or axis not in self.held:
                continue
            total: Optional[Decimal] = start.get(axis)
            for read in getattr(step, "reads", None) or []:
                if read.axis == axis:
                    increment = self.increment_of(read, step)
                    total = total + increment if total is not None and increment is not None else None
            end[axis] = total
        return end

    # -- units --------------------------------------------------------------------

    def block_units(self, step: Any) -> str:
        units = getattr(step, "units", None)
        if units not in ("mm", "inch"):
            units = as_dict(self.interp.state.get("units")).get("value")
        return units if units in ("mm", "inch") else self.report_units

    def to_report(self, value: Decimal, units: str) -> Decimal:
        if units == self.report_units:
            return value
        return value * INCH if units == "inch" else value / INCH

    def pecks_for(self, step: Any) -> _nc_cycles.PeckValues:
        """The form's peck values in the units of the block (``_nc_cycles.PeckValues`` are in the
        program's units): converted where the form names other units than the block's."""
        pecks = self.params.pecks
        units = self.params.units
        if units is None or (pecks.retract is None and pecks.clearance is None):
            return pecks
        block = getattr(step, "units", None)
        if block not in ("mm", "inch"):
            block = as_dict(self.interp.state.get("units")).get("value")
        if block not in ("mm", "inch") or block == units:
            return pecks
        factor = INCH if units == "inch" else 1 / INCH

        def convert(value: Optional[Decimal]) -> Optional[Decimal]:
            return value * factor if value is not None else None

        return _nc_cycles.PeckValues(retract=convert(pecks.retract), clearance=convert(pecks.clearance))

    def form_rate(self, value: Decimal) -> Decimal:
        """A length or rate of the form, in the report units (25.4 exactly)."""
        units = self.params.units
        if units is None or units == self.report_units:
            return value
        return value * INCH if units == "inch" else value / INCH

    # -- one block ----------------------------------------------------------------

    def block(self, step: Any, text: str, holes: List[Any], refusals: List[Any], out: Totals) -> List[Any]:
        """Adds what the block of ``step`` does to ``out``; raises :class:`Skip` for a block that is
        not estimated. Answers the holes it timed."""
        entries = [e for e, _, _ in getattr(step, "entries", None) or []]
        kind = getattr(step, "kind", "none")
        # The Okuma LAP: the shape between its open and close codes does not move; its cycles are not estimated.
        if self.in_contour and not any(e.get("contour") == "open" for e in entries):
            return []
        if any(e.get("group") in self.contour_groups and e.get("contour") is None for e in entries):
            raise Skip("lap", next(str(e.get("code")) for e in entries if e.get("group") in self.contour_groups))
        if kind == "multi-pass":
            code = str(getattr(step, "cycle", None) or next((str(e.get("code")) for e in entries if _sets(e).get("cycle") == "start"), ""))
            contour = self.roughing_contour(step, entries)
            if contour is not None:
                self.contour_ahead = contour
                raise Skip("multi-pass", "%s; its contour, blocks %d to %d, runs inside the cycle and with G70, and is not counted where it stands" % (code, contour[0], contour[1]))
            raise Skip("multi-pass", code)
        # The detector the expansion uses too: a cycle entry is no call (fix batch 2).
        call = _nc_cycles.call_of(step, self.interp)
        if call is not None:
            raise Skip("call", call)
        fk = [t.text.strip() for t in getattr(step, "tokens", None) or [] if t.kind == "word" and (t.address or "").upper() in _nc_geom.FK_WORDS and not (t.value_text or "")]
        if fk:
            raise Skip("contour", fk[0])
        running = getattr(step, "cycle", None)
        if running or holes or refusals:
            return self.cycle(step, text, holes, refusals, out, entries)
        dwell = next((e for e in entries if _is_dwell(e)), None)
        if dwell is not None:
            out.dwell_s += self.dwell_block(step, dwell)
            return []
        if kind == "machine":
            code = next((str(e.get("code")) for e in entries if gedit_nc.axis_words_of(e) == "machine"), "")
            raise Skip("position-unknown", "a move to a machine position%s" % (" (%s)" % code if code else ""))
        if kind in ("frame", "unknown-code"):
            raise Skip("position-unknown", "a move in a frame or under a code gEdit does not know")
        if kind != "move":
            return []
        self.move(step, entries, out)
        return []

    def roughing_contour(self, step: Any, entries: List[Dict[str, Any]]) -> Optional[Tuple[int, int]]:
        """``(ns, nf)`` of a multi-pass cycle block that names its contour by block numbers: the
        first two whole-number parameters (``unit: 'count'``) of the block they belong to
        (``CodeParam.block``; the Fanuc lathe ``G71``-``G73`` ``P``, ``Q``), both written."""
        words = getattr(step, "words", None) or {}
        for entry in entries:
            if _sets(entry).get("cycle") != "start" or gedit_nc.axis_words_of(entry) != "data":
                continue
            counts = [p for p in _params(entry) if p.get("unit") == "count" and isinstance(p.get("block"), int)]
            for block in sorted({p["block"] for p in counts}):
                pair = [str(p.get("address")).upper() for p in counts if p["block"] == block][:2]
                if len(pair) == 2 and all(a in words for a in pair):
                    values = [gedit_nc.decimal_of(words[a].value) if words[a].value is not None else None for a in pair]
                    if all(v is not None and v == v.to_integral_value() and v > 0 for v in values):
                        return int(values[0]), int(values[1])  # type: ignore[arg-type]
        return None

    # -- cycles -------------------------------------------------------------------

    def cycle(self, step: Any, text: str, holes: List[Any], refusals: List[Any], out: Totals, entries: List[Dict[str, Any]]) -> List[Any]:
        running = str(getattr(step, "cycle", None) or "")
        entry = self.interp.entry(running) if running else None
        if entry is not None and entry.get("group") == "motion" and (entry.get("pitchFeed") is True or entry.get("tapping") is True):
            # A thread move or pass (`G32`, `G33`, `G92`): the interpreter runs it as a cycle (§7.4 rule 3).
            raise Skip("thread", running)
        if entry is not None and entry.get("modal") is not True and entry.get("pitchFeed") is True and not entry.get("tapping"):
            raise Skip("multi-pass", running)
        if self.lathe:
            # As the expansion: the drilling schemas are read on milling programs only (whatever a
            # turning database inherits); a turning cycle has none.
            why = "drilling cycles are timed on milling programs only" if _nc_cycles.expand_of(entry) is not None else _nc_cycles.REASONS["no-schema"]
            raise Skip("cycle", "%s: %s" % (running or "cycle", why))
        if refusals:
            first = sorted(refusals, key=lambda r: REASON_PLACE.get(r.reason, 999))[0]
            if first.reason in ("peck-retract-missing", "peck-clearance-missing"):
                raise Skip(first.reason, running)
            if first.reason == "call-form" and self.pattern_call(step):
                raise Skip("pattern", first.detail or running)
            detail = _nc_cycles.REASONS.get(first.reason, first.reason)
            if first.detail:
                detail += " (%s)" % first.detail
            # A block that runs no cycle of its own is refused for the cycle in force (a feed
            # alone under `MCALL`): named by that cycle, not by the block again (fix batch 2).
            raise Skip("cycle", "%s: %s" % (running or self.interp.active_cycle or self.interp.defined_cycle or first.written, detail))
        if not holes:
            return []
        read = _nc_cycles.last_read(self.tracker)
        units = self.block_units(step)
        start = self.start_of(step)
        state = self.interp.state
        if read is not None and read.keep_block:
            # The block's own move runs first (a positioning block under `M99`, `M89`, `MCALL`).
            if getattr(step, "kind", None) == "move":
                self.move(step, entries, out)
            here = self.end_of(step, start)
        else:
            here = start
        cur: Dict[str, Optional[Decimal]] = dict(here)
        untimed: Optional[Skip] = None
        for hole in holes:
            cur[_nc_path.PLANE_NORMAL["XY"]] = self.to_report(hole.start, units) if hole.start is not None else None
            for move in hole.moves:
                if move.kind == "dwell":
                    # A dwell whose time cannot be read leaves out that dwell only: the moves of
                    # the cycle are counted (fix batch 2, NC-K).
                    try:
                        out.dwell_s += self.hole_dwell(step, move, state)
                    except Skip as skip:
                        untimed = untimed or skip
                    continue
                cur = self.hole_move(step, move, cur, units, state, out)
        if untimed is not None:
            detail = "%s; the moves of the cycle are counted" % untimed.detail if untimed.detail else "the moves of the cycle are counted"
            self.skip(step, text, Skip(untimed.kind, detail), step.line, out)
        return holes

    def pattern_call(self, step: Any) -> bool:
        """A call that runs the cycle at points kept elsewhere (``CYCL CALL PAT``): its positions
        named after the axes (``position: 'other'``), none of them written in the block."""
        written = {(t.address or "").upper() for t in getattr(step, "tokens", None) or [] if t.kind == "word" and t.address and (t.value_text or "")}
        for entry, _, _ in getattr(step, "entries", None) or []:
            if _sets(entry).get("cycle") not in ("call", "call-modal"):
                continue
            named = [str(p.get("address")).upper() for p in _params(entry) if gedit_nc.position_of(p) == "other" and self.axes.axis_of(str(p.get("address")).upper()) is not None]
            if named and not any(address in written for address in named):
                return True
        return False

    def hole_move(self, step: Any, move: Any, cur: Dict[str, Optional[Decimal]], units: str, state: Dict[str, Any], out: Totals) -> Dict[str, Optional[Decimal]]:
        if move.kind not in ("rapid", "feed"):
            return cur  # a dwell (:meth:`cycle` times it), a spindle stop, its restart, an oriented stop: no time of their own here
        end = dict(cur)
        for axis, value in move.to.items():
            end[axis] = self.to_report(value, units)
        moved = [axis for axis in move.to if cur.get(axis) != end.get(axis)]
        if any(cur.get(axis) is None for axis in move.to):
            raise Skip("position-unknown", "where the cycle starts")
        linear = {a: self.axes.geo(a, end[a]) - self.axes.geo(a, cur[a]) for a in moved if a not in self.axes.angular}  # type: ignore[operator]
        rotary = {a: end[a] - cur[a] for a in moved if a in self.axes.angular}  # type: ignore[operator]
        length = _nc_path.sqrt(sum((d * d for d in linear.values()), _ZERO)) if linear else _ZERO
        if move.kind == "rapid":
            self.rapid(step, linear, rotary, length, out)
        else:
            if rotary:
                raise Skip("rotary-rate", "the feed of a turning axis")
            feed = self.feed_of(step, state, move.feed)
            out.feed_len += length
            out.feed_s += self.feed_seconds(step, feed, length, cur, end, None, out, state)
        return end

    def hole_dwell(self, step: Any, move: Any, state: Dict[str, Any]) -> Decimal:
        if move.seconds is not None:
            return Decimal(move.seconds)
        written = move.dwell or ""
        address, _, value = written.partition("=")
        if not value:
            match = re.match(r"^\s*([A-Za-z_]+)\s*(.*)$", written)
            address, value = (match.group(1), match.group(2)) if match else ("", written)
        number = _number(value)
        if number is None:
            raise Skip("dwell-unknown", written)
        unit = None
        read = _nc_cycles.last_read(self.tracker)
        for param in _params(read.entry if read is not None else None):
            if str(param.get("address")).upper() == address.strip().upper():
                unit = param.get("unit")
        if unit == "count":
            return self.increments_seconds(number, written)
        if number < _ZERO:
            return self.revolutions_seconds(step, -number, written, state)
        raise Skip("dwell-unknown", written)

    # -- dwells -------------------------------------------------------------------

    def dwell_block(self, step: Any, entry: Dict[str, Any]) -> Decimal:
        """The time of a dwell block, from the dwell code's ``dwell`` form (plan §6.3 rule 6)."""
        form = _nc_cycles.dwell_form_of(entry) or {}
        words = getattr(step, "words", None) or {}
        units = self.block_units(step)
        code = str(entry.get("code"))
        lines = form.get("lines")
        if isinstance(lines, list) and lines:
            for template in lines:
                if not isinstance(template, str) or "{s}" not in template:
                    continue
                pattern = r"\s+".join(re.escape(part).replace(r"\{s\}", r"([-+]?\d+(?:[.,]\d*)?|[.,]\d+)") for part in template.split())
                found = re.search(pattern, getattr(step, "masked", "") or "", re.IGNORECASE)
                if found is not None:
                    value = _number(found.group(1))
                    if value is None or value < _ZERO:
                        raise Skip("dwell-unknown", code)
                    return value
            return _ZERO  # the first line of the dwell cycle (`CYCL DEF 9.0 DWELL TIME`)
        seconds = form.get("seconds")
        if isinstance(seconds, str) and seconds.upper() in words:
            return self.dwell_seconds(words[seconds.upper()], units, code)
        increments = form.get("increments")
        if isinstance(increments, str) and increments.upper() in words:
            token = words[increments.upper()]
            value = gedit_nc.decimal_of(token.value) if token.value is not None else None
            if value is None:
                raise Skip("dwell-unknown", _quote(token.text))
            return self.increments_seconds(value, token.text.strip())
        revolutions = form.get("revolutions")
        if isinstance(revolutions, str) and revolutions.upper() in words:
            token = words[revolutions.upper()]
            value = gedit_nc.decimal_of(token.value) if token.value is not None else None
            if value is None:
                raise Skip("dwell-unknown", token.text.strip())
            return self.revolutions_seconds(step, value, token.text.strip(), self.interp.state)
        if not form:
            # A dwell code with no form (Okuma `G4 F`, the Fanuc lathe `G4 X`): its parameter in
            # seconds (`unit: 'dwell'`); any other word of it (`G4 P` there) is not read.
            for param in _params(entry):
                address = str(param.get("address")).upper()
                if param.get("unit") == "dwell" and address in words:
                    return self.dwell_seconds(words[address], units, code)
        raise Skip("dwell-unknown", "%s without a time gEdit can read" % code)

    def dwell_seconds(self, token: Any, units: str, code: str) -> Decimal:
        literal, _ = _nc_path.literal_of(token)
        if literal is None:
            raise Skip("dwell-unknown", "%s, a variable" % token.text.strip())
        text, readings = self.tracker.readings.get(literal, "dwell", units)
        value = _nc_path.dec(text)
        if value is None:
            raise Skip("dwell-unknown", "%s: the reading depends on the machine and no machine is chosen" % token.text.strip() if readings else token.text.strip())
        return value

    def increments_seconds(self, count: Decimal, written: str) -> Decimal:
        """A count of the machine's least time increments (Fanuc ``P``) in seconds."""
        if self.dwell_increment is None:
            self.dwell_increment = self.least_time_increment()
        unit, why = self.dwell_increment
        if unit is None:
            raise Skip("dwell-unknown", "%s: %s" % (written, why))
        return count * unit

    def least_time_increment(self) -> Tuple[Optional[Decimal], str]:
        """The machine's least time increment (plan §7.15: ``incrementSec``, else the digits of
        ``incrementMm``): the machine's own number input, or every preset of the profile when no
        machine says; ``None`` with why where they differ or none is declared."""
        machine = self.machine
        params = as_dict(machine.get("params"))
        candidates: List[Any] = []
        if as_dict(machine.get("source")).get("numberInput") == "machine":
            candidates = [params.get("numberInput")]
        else:
            declared = as_dict(as_dict(self.profile.get("machineParams")).get("numberInput"))
            presets = declared.get("presets") if isinstance(declared.get("presets"), list) else []
            candidates = [as_dict(p).get("value") for p in presets] or [params.get("numberInput")]
        found: List[Optional[Decimal]] = []
        for number_input in candidates:
            ni = as_dict(number_input)
            dwell = as_dict(as_dict(ni.get("classes")).get("dwell"))
            text = dwell.get("increment") or ni.get("incrementSec") or ni.get("incrementMm")
            found.append(_number(text) if isinstance(text, str) else None)
        if not found or any(v is None for v in found):
            return None, "the machine's least time increment is not set"
        if any(v != found[0] for v in found):
            return None, "the least time increment depends on the machine, and no machine is chosen"
        return found[0], ""

    def revolutions_seconds(self, step: Any, revolutions: Decimal, written: str, state: Dict[str, Any]) -> Decimal:
        speed = self.rpm_here(step, state, None)
        if speed is None or speed <= _ZERO:
            raise Skip("dwell-unknown", "%s: the spindle speed is not known" % written)
        return revolutions / speed * _SIXTY

    # -- feeds and speeds -----------------------------------------------------------

    def speed_value(self, state: Dict[str, Any]) -> Optional[Decimal]:
        speed = as_dict(state.get("speed"))
        if speed.get("variable") is True:
            return None
        return _number(speed.get("valueText")) if isinstance(speed.get("valueText"), str) else None

    def speed_clamp(self, state: Dict[str, Any]) -> Optional[Decimal]:
        """The top spindle speed under constant surface speed: the clamp in force, else the
        machine's limit (``limits.spindle.main``, plan §6.4 rule 8)."""
        clamp = as_dict(state.get("speedLimit"))
        if clamp and clamp.get("variable") is not True:
            value = _number(clamp.get("valueText")) if isinstance(clamp.get("valueText"), str) else None
            if value is not None and value > _ZERO:
                return value
        spindle = as_dict(as_dict(self.limits).get("spindle"))
        main = spindle.get("main")
        if isinstance(main, (int, float)) and not isinstance(main, bool) and main > 0:
            return decimal_text(main)
        return None

    def css_constant(self, step: Any, state: Dict[str, Any]) -> Tuple[float, Optional[float]]:
        """``(K, top speed)``: under constant surface speed the speed is ``K / r`` rpm at the
        distance ``r`` from the turning centre (report units), held at the top speed."""
        surface = self.speed_value(state)
        if surface is None or surface <= _ZERO:
            raise Skip("feed-unknown", "no surface speed")
        units = self.block_units(step)
        # Vc m/min with mm, ft/min with inch: n = 1000 Vc / (pi D) or 12 Vc / (pi D), D = 2 r.
        per = 1000.0 if units == "mm" else 12.0
        k = float(surface) * per / (2.0 * math.pi)
        if units != self.report_units:
            k = k * (25.4 if self.report_units == "mm" else 1 / 25.4)
        clamp = self.speed_clamp(state)
        return k, float(clamp) if clamp is not None else None

    def rpm_here(self, step: Any, state: Dict[str, Any], radius: Optional[Decimal]) -> Optional[Decimal]:
        unit = state.get("speedUnit")
        if unit == "rpm":
            return self.speed_value(state)
        if unit == "surface" and self.radial is not None:
            r = radius
            if r is None:
                pos = self.start_of(step)
                value = pos.get(self.radial)
                r = abs(self.axes.geo(self.radial, value)) if value is not None else None
            if r is None:
                return None
            try:
                k, top = self.css_constant(step, state)
            except Skip:
                return None
            if r == _ZERO:
                return _dec(top) if top is not None else None
            n = k / float(r)
            return _dec(min(n, top) if top is not None else n)
        return None

    def feed_of(self, step: Any, state: Dict[str, Any], written: Optional[str] = None) -> Feed:
        """How a feed move of the block is timed (:class:`Feed`), or :class:`Skip`."""
        unit = state.get("feedUnit")
        units = self.block_units(step)
        if written is not None:
            text = written.strip()
            if text.upper().startswith(self.feed_address):
                text = text[len(self.feed_address):]
            literal = gedit_nc.parse_number(text.strip())
            shown = written.strip()
        else:
            feed = as_dict(state.get("feed"))
            if not feed:
                raise Skip("feed-unknown", "no feed is in force")
            if feed.get("variable") is True:
                raise Skip("feed-unknown", "the feed is a variable")
            literal = gedit_nc.parse_number(str(feed.get("valueText") or "").strip())
            shown = "%s%s" % (self.feed_address, feed.get("valueText"))
        if literal is None:
            raise Skip("feed-unknown", "%s is not a number" % shown)
        if unit == "per-tooth":
            raise Skip("per-tooth", shown)
        if unit == "travel-time":
            # T085: Sinumerik `G931` takes F seconds, the number as written.
            value = gedit_nc.decimal_of(literal)
            if value is None or value <= _ZERO:
                raise Skip("feed-unknown", "%s, a travel time of 0 or less" % shown)
            return Feed("seconds", value)
        if unit == "inverse-time":
            value = gedit_nc.decimal_of(literal)
            if value is None or value <= _ZERO:
                raise Skip("feed-unknown", "%s, an inverse time of 0 or less" % shown)
            return Feed("inverse", value)
        if unit not in ("per-minute", "per-rev"):
            raise Skip("feed-unknown", "%s: the feed unit (per minute or per revolution) is not set by the program or the machine" % shown)
        cls = "feedPerMin" if unit == "per-minute" else "feedPerRev"
        text, readings = self.tracker.readings.get(literal, cls, units)
        value = _nc_path.dec(text)
        if value is None:
            raise Skip("feed-unknown", "%s: the reading depends on the machine and no machine is chosen" % shown if readings else shown)
        if value <= _ZERO:
            raise Skip("feed-unknown", "%s, a feed of 0" % shown)
        value = self.to_report(value, units)
        if unit == "per-minute":
            return Feed("rate", value)
        speed_unit = state.get("speedUnit")
        if speed_unit == "rpm":
            speed = self.speed_value(state)
            if speed is None or speed <= _ZERO:
                raise Skip("feed-unknown", "%s per revolution with no spindle speed in force" % shown)
            return Feed("rate", value * speed)
        if speed_unit == "surface":
            if self.radial is None:
                raise Skip("feed-unknown", "%s per revolution under constant surface speed on a milling program" % shown)
            return Feed("css", value)
        raise Skip("feed-unknown", "%s per revolution: the spindle speed unit (rpm or surface speed) is not set" % shown)

    def feed_seconds(self, step: Any, feed: Feed, length: Decimal, start: Dict[str, Optional[Decimal]], end: Dict[str, Optional[Decimal]], arc: Any, out: Totals, state: Dict[str, Any]) -> Decimal:
        top = self.form_rate(self.params.max_feed) if self.params.max_feed is not None and self.params.units is not None else None
        if self.params.max_feed is not None and self.params.units is None:
            self.missing.setdefault("units", step.line)
        if length == _ZERO and feed.mode in ("rate", "css"):
            return _ZERO
        if feed.mode == "rate":
            rate = feed.value
            if top is not None and rate > top:
                rate = top
                self.clamp(step, out)
            return length / rate * _SIXTY
        if feed.mode in ("seconds", "inverse"):
            seconds = feed.value if feed.mode == "seconds" else _SIXTY / feed.value
            if top is not None and seconds > _ZERO and length / seconds * _SIXTY > top:
                seconds = length / top * _SIXTY
                self.clamp(step, out)
            return seconds
        # Constant surface speed: the speed follows the distance from the turning centre.
        k, clamp = self.css_constant(step, state)
        radial = self.radial
        assert radial is not None
        f = float(feed.value)
        caps = [c for c in ((f * clamp) if clamp is not None else None, float(top) if top is not None else None) if c is not None]
        cap = min(caps) if caps else None
        pieces = self.radial_pieces(start, end, arc, length)
        minutes = 0.0
        clamped = False
        for piece_length, r0, r1 in pieces:
            t, held = _css_minutes(piece_length, r0, r1, f, k, cap)
            minutes += t
            clamped = clamped or (held and top is not None and cap == float(top) and (clamp is None or f * clamp > float(top)))
        if clamped:
            self.clamp(step, out)
        return _dec(minutes * 60.0)

    def radial_pieces(self, start: Dict[str, Optional[Decimal]], end: Dict[str, Optional[Decimal]], arc: Any, length: Decimal) -> List[Tuple[float, float, float]]:
        """The move as pieces along which the distance from the turning centre changes linearly:
        ``(length, r at its start, r at its end)``, signed ``r`` (a piece never crosses 0)."""
        radial = self.radial
        assert radial is not None
        out: List[Tuple[float, float, float]] = []
        if arc is not None and radial in arc.plane:
            index = arc.plane.index(radial)
            ca, cb = (float(v) for v in arc.centre)
            sa, sb = (float(v) for v in arc.start)
            radius = math.hypot(sa - ca, sb - cb)
            sweep = _sweep(arc)
            t0 = math.atan2(sb - cb, sa - ca)
            steps = max(8, int(math.ceil(abs(math.degrees(sweep)) / 2.0)))
            total = float(length)
            for i in range(steps):
                a0 = t0 + sweep * i / steps
                a1 = t0 + sweep * (i + 1) / steps
                p0 = (ca + radius * math.cos(a0), cb + radius * math.sin(a0))
                p1 = (ca + radius * math.cos(a1), cb + radius * math.sin(a1))
                out.extend(_split_zero(total / steps, p0[index], p1[index]))
            return out
        r0 = start.get(radial)
        r1 = end.get(radial)
        if r0 is None or r1 is None:
            raise Skip("position-unknown", "the diameter along the move")
        return _split_zero(float(length), float(self.axes.geo(radial, r0)), float(self.axes.geo(radial, r1)))

    def clamp(self, step: Any, out: Totals) -> None:
        out.clamped += 1
        self.findings.append(
            {
                "line": step.line,
                "severity": "info",
                "message": "%s: timed at the top feed of the form; the programmed feed is faster." % _quote("".join(t.text for t in step.tokens)),
                "reason": "clamped",
            }
        )

    # -- rapids -------------------------------------------------------------------

    def rapid(self, step: Any, linear: Dict[str, Decimal], rotary: Dict[str, Decimal], length: Decimal, out: Totals) -> None:
        moving_linear = [a for a, d in linear.items() if d != _ZERO]
        moving_rotary = [a for a, d in rotary.items() if d != _ZERO]
        rates = self.params.rapid
        unitless = self.params.units is None and bool(rates)
        no_rate = [a for a in moving_rotary if a not in rates]
        if no_rate:
            raise Skip("rotary-rate", "the rapid rate of %s is not in the form" % ", ".join(no_rate))
        out.rapid_len += length
        if unitless and (moving_linear or moving_rotary):
            # A rate without its unit is not used: mm and inch per minute differ by 25.4.
            out.rapid_unset = True
            self.missing.setdefault("units", step.line)
            return
        missing = [a for a in moving_linear if a not in rates]
        if missing:
            out.rapid_unset = True
            for axis in missing:
                self.missing.setdefault("rapid " + axis, step.line)
            return
        if not moving_linear and not moving_rotary:
            return
        if self.params.rapid_kind is None and self.rapid_read_straight is None:
            self.rapid_read_straight = step.line
        times: List[Decimal] = []
        if self.params.rapid_kind == "per-axis":
            for axis in moving_linear:
                times.append(abs(linear[axis]) / self.form_rate(rates[axis]) * _SIXTY)
        elif moving_linear:
            slowest = min(self.form_rate(rates[axis]) for axis in moving_linear)
            times.append(length / slowest * _SIXTY)
        for axis in moving_rotary:
            times.append(abs(rotary[axis]) / rates[axis] * _SIXTY)
        out.rapid_s += max(times)

    # -- a move -------------------------------------------------------------------

    def move(self, step: Any, entries: List[Dict[str, Any]], out: Totals) -> None:
        state = self.interp.state
        motion = next((e for e in entries if e.get("group") == "motion"), None)
        if motion is None:
            code = as_dict(as_dict(state.get("groups")).get("motion")).get("code")
            motion = self.interp.entry(code) if isinstance(code, str) else None
        if motion is not None and (motion.get("pitchFeed") is True or motion.get("tapping") is True):
            raise Skip("thread", str(motion.get("code")))
        if motion is not None and _sets(motion).get("path") == "cycle":
            raise Skip("cycle", "%s: %s" % (motion.get("code"), _nc_cycles.REASONS["no-schema"]))
        rapid = self.rapid_word is not None and any(gedit_nc.normalize_code(str(e.get("code"))) == self.rapid_word for e in entries)
        sets = _sets(motion)
        if not rapid:
            if sets.get("motion") == "rapid":
                rapid = True
            elif sets.get("motion") != "feed":
                raise Skip("feed-unknown", "the motion mode (a rapid or a feed move) is not known")
        unknowns = [u for u in getattr(step, "events", None) or [] if isinstance(u, _nc_path.Unknown)]
        start = self.start_of(step)
        end = self.end_of(step, start)
        arc = getattr(step, "arc", None)
        moved = sorted({r.axis for r in getattr(step, "reads", None) or []} | ({a for a in arc.plane} if arc is not None else set()))
        moved = [a for a in moved if a in self.axes.known]
        for axis in moved:
            if end.get(axis) is None:
                raise Skip("position-unknown", _unknown_text(unknowns, axis, "where %s ends" % axis))
        for axis in moved:
            if start.get(axis) is None:
                raise Skip("position-unknown", "the start of %s: the program's first move of the axis, or the first after a move to a machine position, a roughing cycle's contour or a block gEdit cannot place" % axis)
        if any(u.kind == "arc" for u in unknowns):
            raise Skip("position-unknown", "an arc gEdit cannot compute")
        linear: Dict[str, Decimal] = {}
        rotary: Dict[str, Decimal] = {}
        for axis in moved:
            delta = self.axes.geo(axis, end[axis]) - self.axes.geo(axis, start[axis])  # type: ignore[arg-type]
            (rotary if axis in self.axes.angular else linear)[axis] = delta
        if arc is not None:
            length = _arc_length(arc, getattr(step, "words", None) or {}, self.axes)
            plane = set(arc.plane) | set(arc.helix)
            others = [a for a in linear if a not in plane and linear[a] != _ZERO]
            if others:
                extra = sum((linear[a] * linear[a] for a in others), _ZERO)
                length = _nc_path.sqrt(length * length + extra)
        else:
            length = _nc_path.sqrt(sum((d * d for d in linear.values()), _ZERO)) if linear else _ZERO
        if rapid:
            self.rapid(step, linear, rotary, length, out)
            return
        if any(d != _ZERO for d in rotary.values()):
            raise Skip("rotary-rate", "the feed of a turning axis")
        feed = self.feed_of(step, state)
        out.feed_len += length
        out.feed_s += self.feed_seconds(step, feed, length, start, end, arc, out, state)


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


def _sweep(arc: Any) -> float:
    """The arc's signed sweep in radians (counter-clockwise positive)."""
    if arc.sweep is not None:
        return math.radians(arc.sweep)
    ca, cb = (float(v) for v in arc.centre)
    sa, sb = (float(v) for v in arc.start)
    ea, eb = (float(v) for v in arc.end)
    t0 = math.atan2(sb - cb, sa - ca)
    t1 = math.atan2(eb - cb, ea - ca)
    if arc.direction == "ccw":
        sweep = (t1 - t0) % (2 * math.pi)
        if arc.full or sweep == 0.0:
            sweep = 2 * math.pi if arc.full else sweep
        return sweep
    sweep = (t0 - t1) % (2 * math.pi)
    if arc.full:
        sweep = 2 * math.pi
    return -sweep


def _arc_length(arc: Any, words: Dict[str, Any], axes: Any) -> Decimal:
    """The length of an arc (a helix included), in the report units."""
    ca, cb = (float(v) for v in arc.centre)
    sa, sb = (float(v) for v in arc.start)
    ea, eb = (float(v) for v in arc.end)
    r0 = math.hypot(sa - ca, sb - cb)
    r1 = math.hypot(ea - ca, eb - cb)
    sweep = abs(_sweep(arc))
    turns = words.get(_nc_path.TURNS_WORD)
    if turns is not None and turns.value is not None:
        extra = gedit_nc.decimal_of(turns.value)
        if extra is not None and extra > 0 and not arc.full:
            sweep += 2 * math.pi * float(extra)
        elif extra is not None and extra > 0 and arc.full:
            sweep = 2 * math.pi * float(extra) + (sweep if sweep < 2 * math.pi else 0.0)
    plane = (r0 + r1) / 2.0 * sweep
    rise = 0.0
    for axis, (begin, finish) in (arc.helix or {}).items():
        if begin is None or finish is None:
            raise Skip("position-unknown", "the position of %s" % axis)
        d = float(axes.geo(axis, finish) - axes.geo(axis, begin))
        rise += d * d
    return _dec(math.sqrt(plane * plane + rise))


def _split_zero(length: float, r0: float, r1: float) -> List[Tuple[float, float, float]]:
    """A piece whose distance from the centre runs from ``r0`` to ``r1``, split where it crosses
    the centre: ``(length, |r| at the start, |r| at the end)``."""
    if (r0 < 0 < r1) or (r1 < 0 < r0):
        share = abs(r0) / (abs(r0) + abs(r1))
        return [(length * share, abs(r0), 0.0), (length * (1 - share), 0.0, abs(r1))]
    return [(length, abs(r0), abs(r1))]


def _css_minutes(length: float, r0: float, r1: float, feed: float, k: float, cap: Optional[float]) -> Tuple[float, bool]:
    """The minutes of a piece under constant surface speed: the feed per minute is ``feed · k / r``,
    held at ``cap`` (the clamp or the top feed) below ``r = feed · k / cap``; answers whether the
    cap holds on the piece. ``r`` changes linearly along the piece and never crosses 0."""
    if length <= 0.0:
        return 0.0, False
    threshold = feed * k / cap if cap is not None else 0.0
    lo, hi = min(r0, r1), max(r0, r1)
    if hi <= threshold:
        return length / cap, True  # type: ignore[operator]
    if lo >= threshold:
        return length * (r0 + r1) / 2.0 / (feed * k), False
    # Split where the cap starts to hold.
    share = (hi - threshold) / (hi - lo)
    upper = length * share
    lower = length - upper
    return upper * (hi + threshold) / 2.0 / (feed * k) + lower / cap, True  # type: ignore[operator]


# ---------------------------------------------------------------------------
# Channels (as the tool list groups them)
# ---------------------------------------------------------------------------


class Group(NamedTuple):
    channel: Optional[str]
    name: str
    lines: List[str]
    numbers: List[int]
    preceding: List[str]


def groups_of(context: Dict[str, Any], lines: Sequence[str], first: int, preceding: Sequence[str]) -> Optional[List[Group]]:
    """One group per channel of a ``single-file`` document, plus the lines outside every channel;
    ``None`` without channels (the whole input is one walk)."""
    member = gedit_nc.channels(context)
    if member["layout"] != "single-file":
        return None
    above = {"channels": context.get("channels"), "input": {"scope": "document", "startLine": 1, "endLine": 0}}
    out: List[Group] = []
    for entry in member["list"]:
        channel_id = entry.get("id")
        if not isinstance(channel_id, str):
            continue
        numbers = gedit_nc.channel_line_numbers(context, lines, channel_id)
        if not numbers:
            continue
        name = entry.get("name") if isinstance(entry.get("name"), str) and entry.get("name") else channel_id
        primed: List[str] = []
        if preceding:
            kept = gedit_nc.channel_line_numbers(above, preceding, channel_id)
            primed = [preceding[n - 1] for n in kept]
        out.append(Group(channel_id, name, [lines[n - first] for n in numbers], numbers, primed))
    if not out:
        return None
    numbers = gedit_nc.outside_line_numbers(context, lines)
    if numbers:
        out.append(Group(None, OUTSIDE_NAME, [lines[n - first] for n in numbers], numbers, []))
    return out


# ---------------------------------------------------------------------------
# The output
# ---------------------------------------------------------------------------


class Row(NamedTuple):
    channel: Optional[str]
    label: str
    totals: Totals
    total: bool


def time_cells(t: Totals, params: Params) -> Tuple[Optional[Decimal], Optional[Decimal], Decimal, Optional[Decimal], Optional[Decimal]]:
    """(feed, rapid, dwell, tool change, total) seconds; ``None`` is "not set"."""
    rapid = None if t.rapid_unset else t.rapid_s
    change: Optional[Decimal]
    if t.changes and params.tool_change is None:
        change = None
    else:
        change = (params.tool_change or _ZERO) * t.changes
    total = None if rapid is None or change is None else t.feed_s + rapid + t.dwell_s + change
    return t.feed_s, rapid, t.dwell_s, change, total


def skipped_text(t: Totals) -> str:
    parts = []
    for kind in sorted(t.skipped, key=lambda k: KIND_ORDER.get(k, 999)):
        parts.append("%s %s" % (kind, lines_text(t.skipped[kind])))
    return "; ".join(parts)


def render(rows: List[Row], params: Params, channels: bool, inch: bool) -> str:
    unit = "in" if inch else "mm"
    header = []
    if channels:
        header.append("Channel")
    header += [
        "Tool",
        "Feed length (%s)" % unit,
        "Rapid length (%s)" % unit,
        "Tool changes",
        "Feed time",
        "Rapid time",
        "Dwell time",
        "Tool-change time",
        "Total time",
        "Not estimated",
        "Not estimated, by kind and line",
    ]
    csv_mode = params.format == "csv"
    if csv_mode:
        header = [h if not h.endswith("time") else h + " (s)" for h in header]
    body: List[List[str]] = []
    for row in rows:
        feed, rapid, dwell, change, total = time_cells(row.totals, params)
        show = seconds_text if csv_mode else clock_text
        cells = []
        if channels:
            cells.append(row.channel or "")
        cells += [
            row.label,
            length_text(row.totals.feed_len, inch),
            length_text(row.totals.rapid_len, inch),
            str(row.totals.changes),
            show(feed),  # type: ignore[arg-type]
            show(rapid) if rapid is not None else "not set",
            show(dwell),
            show(change) if change is not None else "not set",
            show(total) if total is not None else "not set",
            str(row.totals.skipped_count()),
            skipped_text(row.totals),
        ]
        body.append(cells)
    if csv_mode:
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(header)
        for cells in body:
            writer.writerow(cells)
        return buffer.getvalue()
    # The table: text left, numbers right, two blanks between the columns.
    numeric = [False] * len(header)
    first_number = 2 if channels else 1
    for i in range(first_number, len(header) - 1):
        numeric[i] = True
    widths = [max([len(header[i])] + [len(cells[i]) for cells in body]) for i in range(len(header))]

    def line_of(cells: List[str]) -> str:
        parts = [cells[i].rjust(widths[i]) if numeric[i] else cells[i].ljust(widths[i]) for i in range(len(cells))]
        return "  ".join(parts).rstrip()

    out = [line_of(header), "  ".join("-" * w for w in widths)]
    for cells in body:
        out.append(line_of(cells))
    out.append("")
    out.append(LOWER_BOUND)
    return "\n".join(out) + "\n"


def missing_text(missing: Dict[str, int]) -> List[str]:
    axes = [key.split(" ", 1)[1] for key in missing if key.startswith("rapid ")]
    parts = []
    if axes:
        parts.append("the rapid rate of %s" % _and_list(sorted(axes, key=lambda a: "XYZABCUVW".find(a) if a in "XYZABCUVW" else 99)))
    if "toolChange" in missing:
        parts.append("the tool-change time")
    if "units" in missing:
        parts.append("the units of the rates (mm or inch), without which no rate is used")
    return parts


def _and_list(items: Sequence[str]) -> str:
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return "%s and %s" % (", ".join(items[:-1]), items[-1])


def message_of(rows: List[Row], walks: List[Walk], params: Params, channels: bool, note: str, dropped: int) -> str:
    sentences: List[str] = []
    totals = [r for r in rows if r.total]
    tools = len([r for r in rows if not r.total and r.label != NO_TOOL])
    if channels:
        parts = []
        longest: Optional[Tuple[Decimal, str]] = None
        unset = False
        for row in totals:
            total = time_cells(row.totals, params)[4]
            parts.append("%s %s" % (row.channel, clock_text(total) if total is not None else "not set"))
            if total is None:
                unset = True
            elif longest is None or total > longest[0]:
                longest = (total, row.channel or "")
        sentences.append("Estimated time per channel: %s." % "; ".join(parts))
        if longest is not None and not unset:
            sentences.append("The channels run at the same time, so the program takes at least %s (%s)." % (clock_text(longest[0]), longest[1]))
    elif totals:
        feed, rapid, dwell, change, total = time_cells(totals[0].totals, params)
        pieces = ["feed %s" % clock_text(feed)]  # type: ignore[arg-type]
        pieces.append("rapid %s" % (clock_text(rapid) if rapid is not None else "not set"))
        pieces.append("dwell %s" % clock_text(dwell))
        pieces.append("tool changes %s" % (clock_text(change) if change is not None else "not set"))
        what = " for %s" % count_text(tools, "tool") if tools else ""
        if total is not None:
            sentences.append("Estimated time %s%s: %s." % (clock_text(total), what, ", ".join(pieces)))
        else:
            sentences.append("No total time%s (%s): a machine value is not set in the form." % (what, ", ".join(pieces)))
    whole = Totals()
    for row in totals:
        whole.add(row.totals)
    skipped = whole.skipped_count()
    if skipped:
        counts = []
        for kind in KINDS:
            n = len(whole.skipped.get(kind, []))
            if n:
                one, several, _ = KINDS[kind]
                counts.append(count_text(n, one, several))
        sentences.append("%s not estimated: %s." % (count_text(skipped, "block is", "blocks are"), ", ".join(counts)))
    missing: Dict[str, int] = {}
    for walk in walks:
        for key, line in walk.missing.items():
            missing.setdefault(key, line)
    if missing:
        sentences.append("Not set in the form: %s." % _and_list(missing_text(missing)))
    if any(w.rapid_read_straight is not None for w in walks):
        sentences.append("The kind of rapid move is not set: rapids are timed as straight moves at the rate of the slowest axis.")
    if whole.clamped:
        sentences.append("%s timed at the top feed." % count_text(whole.clamped, "move is", "moves are"))
    if dropped:
        sentences.append("%s further findings are not listed." % "{:,}".format(dropped))
    sentences.append(LOWER_BOUND)
    sentences.append(note)
    return " ".join(sentences)


def missing_findings(walks: List[Walk]) -> List[Dict[str, Any]]:
    out = []
    seen: Dict[str, int] = {}
    for walk in walks:
        for key, line in walk.missing.items():
            if key not in seen or line < seen[key]:
                seen[key] = line
    for key, line in seen.items():
        if key == "toolChange":
            text = "The tool-change time is not set in the form, so the tool-change time and the total are not set."
        elif key == "units":
            text = "The units of the rates (mm or inch) are not set in the form, so neither the rapid rates nor the top feed are used."
        else:
            axis = key.split(" ", 1)[1]
            text = "The rapid rate of %s is not set in the form, so the rapid time and the total are not set." % axis
        out.append({"line": line, "severity": "warning", "message": text, "reason": "value-not-set"})
    return out


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main() -> int:
    setup = _nc_run.prepare(SCRIPT, Params, (ValueError,))
    if isinstance(setup, int):
        return setup
    context, lines, text, profile, cp, params, codes = setup
    if not codes:
        print("%s needs the code database of this control, which tells a rapid from a feed move. Run it from gEdit, which puts the database into the script context." % SCRIPT, file=sys.stderr)
        return 1
    scope = _nc_run.scope_of(context)
    note = machine_note(gedit_nc.machine_params(context))
    if lines and lines[-1] == "" and len(lines) > 1:
        lines = lines[:-1]
    numbers = [scope.first + i for i in range(len(lines))]
    findings: List[Dict[str, Any]] = []
    if scope.fragment and not scope.preceding:
        findings.append(
            {
                "line": scope.first,
                "severity": "warning",
                "message": "The lines above the selection were not available, so the position, the feed and the speed in force there are not known; the moves that need them are not estimated.",
                "reason": "selection-unprimed",
            }
        )
    groups = groups_of(context, lines, scope.first, scope.preceding)
    walks: List[Walk] = []
    rows: List[Row] = []
    if groups is None:
        walk = Walk(context, cp, params, None)
        walk.walk(scope.preceding, lines, numbers)
        walks.append(walk)
        total = Totals()
        for label, totals in walk.rows.items():
            if label == NO_TOOL and not _counts(totals):
                continue
            rows.append(Row(None, label, totals, False))
            total.add(totals)
        rows.append(Row(None, TOTAL, total, True))
    else:
        for group in groups:
            walk = Walk(context, cp, params, group.channel)
            walk.walk(group.preceding, group.lines, group.numbers)
            walks.append(walk)
            total = Totals()
            kept = []
            for label, totals in walk.rows.items():
                if label == NO_TOOL and not _counts(totals):
                    continue
                kept.append(Row(group.name, label, totals, False))
                total.add(totals)
            if group.channel is None and not kept:
                continue
            rows.extend(kept)
            rows.append(Row(group.name, TOTAL, total, True))
    for walk in walks:
        prefix = "%s: " % _channel_name(walk, groups) if groups is not None else ""
        findings.extend(dict(f, message=prefix + f["message"]) if prefix else f for f in walk.findings)
    findings.extend(missing_findings(walks))
    findings.sort(key=lambda f: (f["line"], 0 if f["severity"] == "warning" else 1))
    dropped = max(0, len(findings) - MAX_FINDINGS)
    inch = any(w.report_units == "inch" for w in walks) and all(w.report_units == "inch" for w in walks)
    body = render(rows, params, groups is not None, inch)
    gedit_nc.envelope(body, message_of(rows, walks, params, groups is not None, note, dropped), findings[:MAX_FINDINGS])
    return 0


#: Why the tracker left a position not known (``_nc_path.UNKNOWN_KINDS``), in plain words.
UNKNOWN_TEXT = {
    "machine-dependent": "the reading of %s depends on the machine, and no machine is chosen",
    "expression": "%s is a variable or a calculation",
    "distance-unknown": "whether %s is absolute or incremental is not known",
    "diameter-unknown": "whether %s is a diameter or a radius is not known",
    "incremental-start": "%s moves by an increment from a position that is not known",
    "called-program": "%s in a program after the first, before it writes the axis",
    "frame": "a frame is in force for %s",
    "unknown-code": "a code gEdit does not know moves %s",
    "multi-pass": "a cycle left %s where the control puts it",
    "cycle": "a cycle left %s where the control puts it",
    "cycle-position": "%s is a position of the cycle it calls",
    "arc": "an arc gEdit cannot compute (%s)",
    "polar": "a polar move whose pole, radius or angle is not known (%s)",
}


def _unknown_text(unknowns: Sequence[Any], axis: str, fallback: str) -> str:
    for unknown in unknowns:
        if axis in unknown.axes and unknown.kind in UNKNOWN_TEXT:
            return UNKNOWN_TEXT[unknown.kind] % axis
    return fallback


def _is_dwell(entry: Dict[str, Any]) -> bool:
    """A dwell code: one with a ``dwell`` form (plan §6.3), one whose feed word is a time
    (``fNotFeed``), or one that is no cycle and takes a time in seconds (``unit: 'dwell'``: the Fanuc
    lathe ``G4``, whose database gives no form yet)."""
    if _nc_cycles.dwell_form_of(entry) is not None or entry.get("fNotFeed") is True:
        return True
    return not _sets(entry).get("cycle") and any(p.get("unit") == "dwell" for p in _params(entry))


def machine_note(machine: Dict[str, Any]) -> str:
    """The machine, always the last sentence (the frame's ``_nc_run.machine_note`` in the words of a
    report: a value whose reading depends on the machine is not estimated, nothing is refused)."""
    if machine.get("id") is None:
        return "No machine chosen: a value whose reading depends on the machine is not estimated."
    name = machine.get("name") or machine.get("id")
    params = as_dict(machine.get("params"))
    if as_dict(machine.get("source")).get("numberInput") == "machine":
        how = _nc_run.number_reading(params, params.get("units") == "inch") or "numbers are read as written"
        return "Machine '%s': %s." % (name, how)
    return "Machine '%s': it does not say how it reads numbers, so a value whose reading depends on that is not estimated." % name


def _counts(t: Totals) -> bool:
    return bool(t.feed_len or t.rapid_len or t.dwell_s or t.changes or t.skipped or t.rapid_unset)


def _channel_name(walk: Walk, groups: Optional[List[Group]]) -> str:
    for group in groups or []:
        if group.channel == walk.channel:
            return group.name
    return OUTSIDE_NAME


if __name__ == "__main__":
    sys.exit(main())
