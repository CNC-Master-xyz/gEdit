#!/usr/bin/env python3
# /// gedit
# name = "Expand Drilling Cycles"
# description = "Replaces the drilling, peck drilling and boring cycles of a milling program with the plain moves they make: rapid to the start, feed to the depth in one go or in pecks, the dwell, the way out. If one cycle cannot be written out safely, nothing is changed and every such cycle is listed."
# input = "selection-or-document"
# output = "replace"
# timeout = 900
# envelope = true
#
# [[params]]
# id = "peckRetract"
# type = "number"
# prefill = "machine.motion.peckRetract"
# label = "High-speed peck retract (G73)"
# help = "How far the drill pulls back between the pecks of a high-speed peck cycle. It is a setting of the control, not of the program: read it off the machine. Needed only when the program has such a cycle."
# min = 0
#
# [[params]]
# id = "peckClearance"
# type = "number"
# prefill = "machine.motion.peckClearance"
# label = "Deep peck clearance (G83)"
# help = "How far above the last depth the drill comes back down at rapid in a deep peck cycle. It is a setting of the control, not of the program: read it off the machine. Needed only when the program has such a cycle."
# min = 0
#
# [[params]]
# id = "motionUnits"
# type = "choice"
# prefill = "machine.motion.units"
# label = "Units of the peck values"
# help = "The unit of the two peck values above: mm or inch, as the machine's settings give them. They are converted to the units of the program. Empty: the values are in the units of the program."
# choices = [
#   { label = "mm", value = "mm" },
#   { label = "inch", value = "inch" }
# ]
# ///
"""Expand Drilling Cycles (Phase 4 plan §5 P4b, P4.7; AD-45; exit criterion X23; plan §6.3).

Replaces the drilling, peck drilling and boring cycles of a milling program with the plain
moves they make and hands the program back through the ``envelope`` output. It walks the
program with the path tracker (``_nc_path``), asks ``_nc_cycles.holes_of`` for the holes of
every block that runs a drilling cycle, and writes their moves in the dialect's own forms. It
keeps no list of codes of its own: the schema in the code database says how each cycle moves
(``CodeEntry.expand``), the database names the rapid, the feed move, the dwell, the spindle
stop and the oriented stop, and a cycle without a schema is refused. The frame (the form
checks, the scope, the lines above a selection, the machine sentence) is ``_nc_run``'s.

Settled defaults (the owner's answers of 2026-10-12 and 2026-10-19, plan §9)
-----------------------------------------------------------------------------

* **Q4-1, all or nothing.** A run that meets one refused cycle writes **nothing** and lists
  every refused block with its line and its reason; the input is handed back unchanged.
* **Q4-8, which cycles expand**, **Q4-9, the peck values** and **Q4-12, block numbers**: the
  header of ``_nc_cycles.py``. The two form fields are prefilled from the machine's motion
  block (``MachineMotion.peckRetract``, ``.peckClearance``) through the ``prefill`` member of
  their header lines (plan §6.4 rule 5); a cycle that needs an empty one refuses the run.
* **The return level** (2026-10-19): a ``G98``/``G99`` cycle whose return mode neither the
  program nor the machine's power-on modes set is refused (``return-assumed``).
* **Klartext ``CYCL CALL POS``** (2026-10-19) is expanded: the tool goes to the call's point in
  the plane first (at ``FMAX`` or the call's feed) while it stands above the surface, and the
  call's tool-axis value shifts the surface of the cycle (TNC 640 cycle manual, the cycle call
  at a position). Below the surface the control goes to a safe height first, which the cycle
  does not give: refused (``call-form``). ``CYCL CALL PAT`` is refused (``call-form``).
* **A Klartext selection that does not reach ``END PGM``** is refused when it writes anything:
  Klartext numbers every block, and the blocks below would have to be renumbered
  (``renumber-outside``).
* **Fix batch 1 (the P4b review).** A subprogram call, a jump, a loop or a pattern cycle while a
  modal cycle is in force refuses, and so does a block under ``MCALL`` that writes only a feed, a
  speed or ``G0``/``G1`` (``call-form``); a block skip on a cycle block, on a line that holds
  cycle data, or on a block that gets a mode back refuses (``block-skip``); Fanuc ``K0`` with a
  position, ``G86`` under ``M4`` and a repeat count above 9999 refuse (the owner's questions Q1,
  Q2; ``_nc_cycles``). The peck values are read in the form's ``motionUnits`` (prefilled from the
  machine) and converted to the units of the block.
* **Fix batch 7 (the owner's answer G, 2026-10-22).** A Fanuc cycle block with ``K0`` and no
  position stays as written, block number and all: the control stores the cycle's values and
  drills nothing (FANUC 30i machining centre manual), and the block may be a jump target. An
  information row says so (``data-kept``). Its cycle stays in force on the control, so the first
  move written for a later block that runs it carries its motion code, which ends the cycle there
  as ``G80`` does, and its feed.

What is written
---------------
A Fanuc cycle block, and every block that runs the cycle again, becomes its own words that are
not the cycle's (codes of other groups, ``M``, ``S``, ``T``, comments, the block number) on the
first written block with the move to the hole at rapid, then the steps of the schema; ``G80``
and ``G98``/``G99`` stay as written. A Klartext definition stays; a call loses its call word and
the steps follow its block; a Sinumerik ``CYCLE81(…)`` line becomes the steps, a block under
``MCALL`` stays and the steps follow it, and the ``MCALL CYCLE…`` line leaves (a bare ``MCALL``
stays). A motion code is written only where the mode in force differs from the one a move needs;
moves follow the distance mode in force; a number takes the form of the word it comes from, a
computed one the decimals of the longest word of the cycle and at least those of
``_nc_geom.MIN_DECIMALS`` when the words carry a point; nothing is rounded (a value that does not
fit refuses, ``resolution``). What a cycle leaves in force (``leaves``) is written back on the
next block that needs it, never on a block whose own code moves it (FANUC ``G53``, Sinumerik
``G74``; fix batch 5). The first written block keeps the block number; Klartext is renumbered
from there to ``END PGM``.

The golden format is ``tests/fixtures/scripts/README.md``, "The drilling and time goldens",
under ``tests/fixtures/scripts/expand_cycles/<case>/``.
"""

from __future__ import annotations

import sys
from decimal import Decimal
from typing import Any, Dict, List, Optional, Sequence, Tuple

import gedit_nc
import _nc_cycles
import _nc_geom
import _nc_path
import _nc_run
from _nc_run import as_dict, count_text, decimal_text

#: The script's name in an error on stderr and in the messages.
SCRIPT = "Expand Drilling Cycles"

#: The form's labels, for its errors.
PARAM_LABELS = {"peckRetract": "High-speed peck retract (G73)", "peckClearance": "Deep peck clearance (G83)", "motionUnits": "Units of the peck values"}

#: The reasons of the run itself (the frame's), beside ``_nc_cycles.REASONS``.
RUN_REASONS = ("no-database", "selection-unprimed")

#: At most this many findings; the rest are counted in the message.
MAX_FINDINGS = 1000

#: How the message counts the refused blocks by their first reason (singular, plural).
REASON_TEXT = {
    "no-schema": ("cycle gEdit has no description of", "cycles gEdit has no description of"),
    "tapping": ("tapping or thread cycle", "tapping or thread cycles"),
    "lathe": ("turning program", "turning programs"),
    "param-unknown": ("cycle with a value gEdit does not know", "cycles with a value gEdit does not know"),
    "param-not-default": ("cycle with a value other than its default", "cycles with a value other than its default"),
    "variant-unknown": ("cycle run in a way gEdit does not write out", "cycles run in a way gEdit does not write out"),
    "value-missing": ("cycle missing a value", "cycles missing a value"),
    "expression": ("cycle with a variable or a calculation", "cycles with a variable or a calculation"),
    "machine-dependent": ("cycle with a value whose reading depends on the machine", "cycles with a value whose reading depends on the machine"),
    "radius-comp": ("cycle under radius compensation", "cycles under radius compensation"),
    "plane": ("cycle outside the XY plane", "cycles outside the XY plane"),
    "frame": ("cycle in a tilted or turned frame", "cycles in a tilted or turned frame"),
    "start-unknown": ("cycle whose start position is not known", "cycles whose start position is not known"),
    "distance-assumed": ("cycle whose distance mode is not stated", "cycles whose distance mode is not stated"),
    "return-assumed": ("cycle whose return level is not stated", "cycles whose return level is not stated"),
    "depth-direction": ("cycle whose bottom is not below its start", "cycles whose bottom is not below their start"),
    "peck-retract-missing": ("cycle without the high-speed peck retract", "cycles without the high-speed peck retract"),
    "peck-clearance-missing": ("cycle without the deep peck clearance", "cycles without the deep peck clearance"),
    "call-form": ("cycle call that is not written out", "cycle calls that are not written out"),
    "block-skip": ("block with a block skip (/)", "blocks with a block skip (/)"),
    "selection-inside": ("cycle cut by the selection", "cycles cut by the selection"),
    "restore-outside": ("cycle whose mode would have to be restored below the selection", "cycles whose mode would have to be restored below the selection"),
    "renumber-outside": ("block the renumbering would reach below the selection", "blocks the renumbering would reach below the selection"),
    "no-code": ("cycle with a move the database has no single code for", "cycles with a move the database has no single code for"),
    "resolution": ("cycle with a value that does not fit its word", "cycles with a value that does not fit its word"),
}

#: The reasons whose finding says what it concerns (the detail in brackets).
DETAILED = frozenset(
    ("param-unknown", "param-not-default", "variant-unknown", "value-missing", "expression", "machine-dependent", "plane", "frame", "start-unknown", "call-form", "block-skip", "no-code", "resolution", "selection-inside")
)

#: The place of each reason in the order of ``_nc_cycles.REASONS``, then the run's own.
REASON_PLACE = {reason: place for place, reason in enumerate(list(_nc_cycles.REASONS) + list(RUN_REASONS))}


# ---------------------------------------------------------------------------
# The form
# ---------------------------------------------------------------------------


class Params:
    """The run's form, checked: the two peck values of the machine (Q4-9), each empty or a number
    of 0 or more, and their units (``motionUnits``: ``'mm'``, ``'inch'``, or ``None`` for the units
    of the program; fix batch 1, NC-11: the machine's motion block gives them in its own units)."""

    def __init__(self, values: Dict[str, Any], profile: Dict[str, Any]) -> None:
        found: Dict[str, Optional[Decimal]] = {}
        for key in ("peckRetract", "peckClearance"):
            raw = values.get(key)
            if raw is None or raw == "":
                found[key] = None
                continue
            number = decimal_text(raw)
            if number is None:
                raise ValueError("%s: %r is not a number." % (PARAM_LABELS[key], raw))
            if number < 0:
                raise ValueError("%s: a value of 0 or more is needed, not %s." % (PARAM_LABELS[key], _nc_run.trim(number)))
            found[key] = number
        self.pecks = _nc_cycles.PeckValues(retract=found["peckRetract"], clearance=found["peckClearance"])
        units = values.get("motionUnits")
        if units is None or units == "":
            self.units: Optional[str] = None
        elif units in ("mm", "inch"):
            self.units = units
        else:
            raise ValueError("%s: %r is not mm or inch." % (PARAM_LABELS["motionUnits"], units))


# ---------------------------------------------------------------------------
# One line of the run
# ---------------------------------------------------------------------------


class Line:
    """One line of the selection or the document and what the run makes of it."""

    __slots__ = ("index", "number", "text", "step", "out", "refusals", "expanded", "end_pgm", "numbered")

    def __init__(self, index: int, number: int, text: str, step: Any) -> None:
        self.index = index
        self.number = number
        self.text = text
        self.step = step
        #: What the line becomes: ``None`` as written, else the lines written in its place, each
        #: ``(text, numbered)``; ``numbered`` says the line carries a block number of its own
        #: (the first written block, a kept line) as opposed to a new one.
        self.out: Optional[List[Tuple[str, bool]]] = None
        self.refusals: List[_nc_cycles.CycleRefusal] = []
        self.expanded = False
        self.end_pgm = False
        self.numbered = False


def _stores_only(read: _nc_cycles.CycleRead, holes: Sequence[_nc_cycles.Hole]) -> bool:
    """A cycle block written as words with a repeat count of 0 and no position: it drills no hole
    (a position with it refuses in ``_nc_cycles``, the owner's question Q1)."""
    return read.form == "word" and not holes and "repeat" in read.words


def _significant(token: Any) -> bool:
    return token.kind not in ("whitespace", "blockNumber", "continuation", "comment")


class Writer:
    """Walks the program once and writes every expanded block (plan §6.3 rules 4 to 8)."""

    def __init__(self, context: Dict[str, Any], cp: Any, params: Params) -> None:
        self.context = context
        self.cp = cp
        self.pecks = params.pecks
        self.pecks_units = params.units
        self.tracker = _nc_path.PathTracker(context, cp, reach=False)
        self.profile = self.tracker.profile
        addresses = as_dict(self.profile.get("addresses"))
        self.feed_address = str(addresses.get("feed") or "F").upper()
        self.rapid_word = addresses.get("rapid") if isinstance(addresses.get("rapid"), str) else None
        self.lines: List[Line] = []
        self.base_line = 1
        self.is_selection = False
        #: The motion code (canonical) and the feed (a number) in force in the written program.
        self.out_motion: Optional[str] = None
        self.out_feed: Optional[Decimal] = None
        self.out_feed_known = True
        #: How the program writes its motion and spindle codes (the last one written, as written).
        self.style_motion: Optional[str] = None
        self.style_spindle: Optional[str] = None
        #: A mode a cycle left that the next block has to get back (plan §6.3 rule 7): the line of
        #: the cycle that left it.
        self.pending_motion: Optional[Line] = None
        self.pending_feed: Optional[Line] = None
        #: `MCALL CYCLE…` lines: the line and the tokens that leave when a block expands it.
        self.mcall_lines: Dict[int, Tuple[Line, List[Any]]] = {}
        self.mcall_used: set = set()
        self.cycles = 0
        self.holes = 0
        self.blocks = 0
        self.definitions: List[int] = []
        #: Fix batch 7 (the owner's answer G, 2026-10-22): the cycle blocks with a repeat count of 0
        #: and no position, left as written (they store the cycle's values and drill nothing), and
        #: the last of them while its cycle is still in force on the control.
        self.kept_data: List[Tuple[Line, str]] = []
        self.cycle_kept: Optional[Line] = None
        self.numbering = as_dict(self.profile.get("numbering"))
        self.renumbers = self.numbering.get("mode") == "consecutive"
        self.current: Any = None
        #: The motion code, the feed and the cycle in force in the input when the line walked
        #: starts (fix batch 1, NC-2b).
        self.before_motion: Optional[str] = None
        self.before_feed: Optional[str] = None
        self.before_cycle: Optional[str] = None
        self._state: Optional[Tuple[Any, Dict[str, Any]]] = None
        self._words: Dict[Any, Any] = {}
        codes = [e for e in self.tracker.codes if isinstance(e, dict)]
        #: The database's dwell codes, oriented stops and spindle stops (by group), read once.
        self.dwells = [e for e in codes if _nc_cycles.dwell_form_of(e) is not None]
        self.orients = [e for e in codes if e.get("orient") is True]
        self.stops: Dict[str, List[Dict[str, Any]]] = {}
        for entry in codes:
            if as_dict(entry.get("sets")).get("spindle") == "off":
                self.stops.setdefault(str(entry.get("group")), []).append(entry)

    # -- the walk ---------------------------------------------------------------------

    def walk(self, preceding: Sequence[str], lines: Sequence[str], base_line: int) -> None:
        tracker = self.tracker
        state = None
        self.base_line = base_line
        first = base_line - len(preceding)
        for offset, text in enumerate(preceding):
            state, step = tracker.line(text, first + offset, state, False)
            self.current = step
            _nc_cycles.holes_of(step, tracker, self.pecks_for(step), self.context)
            self.follow(step, None)
        for index, text in enumerate(lines):
            number = base_line + index
            # What the input has in force when the line starts (a block skipped by `/` leaves it).
            self.before_motion = self.in_motion()
            self.before_feed = self.in_feed()
            self.before_cycle = tracker.interp.active_cycle
            state, step = tracker.line(text, number, state, True)
            self.current = step
            line = Line(index, number, text, step)
            self.lines.append(line)
            holes, refusals = _nc_cycles.holes_of(step, tracker, self.pecks_for(step), self.context)
            line.end_pgm = any(regex.search(step.masked or "") for regex in self.cp.patterns.get("program_end") or [])
            if refusals:
                line.refusals.extend(refusals)
                self.follow(step, line)
            elif getattr(step, "cycle", None):
                read = _nc_cycles.last_read(tracker)
                if read is None:
                    line.refusals.append(_nc_cycles.CycleRefusal(number, "no-schema", _nc_run.quote(text), ""))
                elif _skips(step):
                    # Fix batch 1 (NC-2): the moves written for the cycle would not carry the `/`.
                    line.refusals.append(_nc_cycles.CycleRefusal(number, "block-skip", _nc_run.quote(text), ""))
                    self.follow(step, line)
                elif _stores_only(read, holes):
                    self.keep_data(line, step, read)
                else:
                    self.selection_start(line, read)
                    self.expand(line, step, read, holes)
            else:
                if _skips(step) and self.skipped_cycle_data(step):
                    # Fix batch 1 (NC-2): a skipped definition, `MCALL`, cycle data, return mode or
                    # cancel changes the cycle the written moves were worked out from.
                    line.refusals.append(_nc_cycles.CycleRefusal(number, "block-skip", _nc_run.quote(text), ""))
                self.keep(line, step)
            if tracker.interp.active_cycle is None:
                # The input ends the cycle here (`G80`, a motion code), and the control with it.
                self.cycle_kept = None
            if line.end_pgm:
                # Nothing after the end of a program needs what a cycle left.
                self.pending_motion = None
                self.pending_feed = None
        if self.is_selection:
            self.selection_end()

    def pecks_for(self, step: Any) -> _nc_cycles.PeckValues:
        """The form's peck values in the units of the block (fix batch 1, NC-11): converted where
        the form names other units than the block's (25.4 exactly; a value that does not convert
        to a number the word can hold refuses, ``resolution``)."""
        pecks = self.pecks
        units = self.pecks_units
        if units is None or (pecks.retract is None and pecks.clearance is None):
            return pecks
        block = getattr(step, "units", None)
        if block not in ("mm", "inch"):
            block = as_dict(self.tracker.interp.state.get("units")).get("value")
        if block not in ("mm", "inch") or block == units:
            return pecks
        return _nc_cycles.PeckValues(
            retract=_nc_run_convert(pecks.retract, units, block),
            clearance=_nc_run_convert(pecks.clearance, units, block),
        )

    def skipped_cycle_data(self, step: Any) -> bool:
        """A line that, skipped, changes a cycle the run writes out: a cycle definition, a cycle a
        ``MCALL`` makes modal, Fanuc drilling data, or a cancel or a return mode while a cycle is
        in force (before or after the line)."""
        in_force = self.before_cycle is not None or self.tracker.interp.active_cycle is not None
        for entry, _, _ in step.entries:
            sets = as_dict(entry.get("sets"))
            cycle = sets.get("cycle")
            if cycle in ("define", "start", "call", "call-modal"):
                return True
            if cycle == "call-modal-next" and (any(t.kind == "call" for t in step.tokens) or in_force):
                return True
            if (cycle == "cancel" or sets.get("cycleReturn")) and in_force:
                return True
        return False

    # -- what the input says at each line ---------------------------------------------

    def state(self) -> Dict[str, Any]:
        """The interpreter's state after the line just walked (built once per line)."""
        step = self.current
        if self._state is None or self._state[0] is not step:
            self._state = (step, self.tracker.interp.state)
        return self._state[1]

    def in_motion(self) -> Optional[str]:
        code = as_dict(as_dict(self.state().get("groups")).get("motion")).get("code")
        entry = self.tracker.interp.entry(code) if isinstance(code, str) else None
        return str(entry.get("code")) if entry is not None else None

    def in_feed(self) -> Optional[str]:
        feed = as_dict(self.state().get("feed"))
        text = feed.get("valueText")
        return text if isinstance(text, str) and text != "" and feed.get("variable") is not True else None

    def follow(self, step: Any, line: Optional[Line]) -> None:
        """The styles and the modes in force after a line written as it stands."""
        interp = self.tracker.interp
        wrote_motion = False
        for token in step.tokens:
            if token.kind != "word" or not token.address:
                continue
            entry = interp.entry((token.address or "") + (token.value_text or ""))
            if entry is None:
                continue
            if entry.get("group") == "motion" and entry.get("modal") is True:
                self.style_motion = token.text.strip()
                wrote_motion = True
            elif entry.get("group") == "spindle":
                self.style_spindle = token.text.strip()
        if wrote_motion or self.out_motion is None:
            self.out_motion = self.in_motion()
        feed = as_dict(self.state().get("feed"))
        if feed.get("line") == step.line:
            value = self.in_feed()
            self.out_feed = gedit_nc.decimal_of(value) if value is not None else None
            self.out_feed_known = value is not None
        elif self.out_feed is None and self.out_feed_known:
            value = self.in_feed()
            self.out_feed = gedit_nc.decimal_of(value) if value is not None else None

    def is_rapid(self, step: Any) -> bool:
        """The block moves at rapid: the rapid code in force, or the dialect's rapid word."""
        if self.rapid_word is not None:
            for token in step.tokens:
                if token.kind == "keyword" and "".join((token.text or "").split()).upper() == self.rapid_word.upper():
                    return True
        code = self.in_motion()
        entry = self.tracker.interp.entry(code) if code else None
        return as_dict(as_dict(entry).get("sets")).get("motion") == "rapid"

    def writes_motion(self, step: Any) -> bool:
        return any(e.get("group") == "motion" and as_dict(e.get("sets")).get("motion") for e, _, _ in step.entries)

    def own_motion(self, step: Any) -> bool:
        """A code of the block outside the motion group moves it (``sets.motion`` on a one-shot
        code: FANUC ``G28``, ``G53``, Sinumerik ``G74``, ``G75``): such a block moves that way
        whatever the motion code in force, and leaves that code as it was (fix batch 5)."""
        return any(e.get("group") != "motion" and as_dict(e.get("sets")).get("motion") in ("rapid", "feed") for e, _, _ in step.entries)

    def writes_feed(self, step: Any) -> bool:
        token = (step.words or {}).get(self.feed_address)
        return token is not None and (token.value_text or "") != "" and not self.tracker.interp.block_f_not_feed

    # -- a line that stays --------------------------------------------------------------

    def keep(self, line: Line, step: Any) -> None:
        """A line written as it stands, with what a cycle above it left to write back."""
        if any(as_dict(e.get("sets")).get("cycle") == "call-modal-next" for e, _, _ in step.entries):
            gone = [t for t in step.tokens if t.kind == "call" or (t.kind == "keyword" and as_dict(as_dict(self.tracker.interp.entry(t.address or t.text)).get("sets")).get("cycle") == "call-modal-next")]
            if any(t.kind == "call" for t in gone):
                self.mcall_lines[line.number] = (line, gone)
        if any(as_dict(e.get("sets")).get("cycle") == "define" for e, _, _ in step.entries):
            self.definitions.append(line.number)
        inserts = self.restore(line, step)
        if inserts:
            line.out = [(_insert(line.text, inserts), True)]
        self.follow(step, line)

    def restore(self, line: Line, step: Any, removed: Any = frozenset()) -> List[Tuple[int, str]]:
        """What a cycle left in force that this block has to get back (plan §6.3 rule 7): the
        motion code in force before the cycle on the next block that moves without one, the feed
        on the next feed move without an ``F``. Returns ``(offset, text)`` insertions.

        Fix batch 1 (NC-13): the block that gets the motion code back is the first that moves (a
        move, a move in a frame, a move to a machine position); one whose code gEdit does not know
        refuses (``param-unknown``), and so does one that can be skipped while what it gets back
        differs from what the input has in force before it (``block-skip``, NC-2b). A motion code
        in force before the cycle that is not known refuses (``value-missing``, NC-8).

        Fix batch 5: a block whose own code moves it (``sets.motion`` outside the motion group:
        FANUC ``G28``-``G30.1`` and ``G53``, Sinumerik ``G74`` and ``G75``) gets nothing back;
        the next block that moves does (below a selection: ``restore-outside``)."""
        out: List[Tuple[int, str]] = []
        if self.pending_motion is None and self.pending_feed is None:
            return out
        if step.kind not in ("move", "frame", "machine", "unknown-code"):
            return out
        pending = [p for p in (self.pending_motion, self.pending_feed) if p is not None]
        if step.kind == "unknown-code":
            code = (getattr(step, "unknown_codes", None) or ["a code"])[0]
            for cycle in {id(p): p for p in pending}.values():
                cycle.refusals.append(
                    _nc_cycles.CycleRefusal(cycle.number, "param-unknown", _nc_run.quote(cycle.text), "%s on line %d, where the mode in force before the cycle is written back" % (code, line.number))
                )
            self.pending_motion = None
            self.pending_feed = None
            return out
        if self.own_motion(step) and not self.writes_motion(step):
            # Fix batch 5: a block with a motion of its own (`G53 Z0.` moves at rapid, Sinumerik
            # `G74` stands in a block of its own) is no place for the motion code or the feed in
            # force before the cycle: they go on to the next block that moves.
            return out
        if _skips(step):
            before_feed = gedit_nc.decimal_of(self.before_feed) if self.before_feed is not None else None
            motion = self.pending_motion is not None and self.out_motion != self.before_motion
            feed = self.pending_feed is not None and not self.is_rapid(step) and before_feed != self.out_feed
            if motion or feed:
                first = min(pending, key=lambda p: p.number)
                line.refusals.append(
                    _nc_cycles.CycleRefusal(line.number, "block-skip", _nc_run.quote(line.text), "the %s in force before the cycle on line %d is written back here" % ("motion code" if motion else "feed", first.number))
                )
                self.pending_motion = None
                self.pending_feed = None
                return out
        sep = _separator(line.text, step)
        if self.pending_motion is not None:
            wanted = self.in_motion()
            if not self.writes_motion(step):
                if wanted is None:
                    self.pending_motion.refusals.append(
                        _nc_cycles.CycleRefusal(self.pending_motion.number, "value-missing", _nc_run.quote(self.pending_motion.text), "the motion code in force before the cycle")
                    )
                elif wanted != self.out_motion:
                    out.append((_head_offset(step), _styled(self.style_motion, wanted) + sep))
                    self.out_motion = wanted
            self.pending_motion = None
        if self.pending_feed is not None and not self.is_rapid(step):
            wanted = self.in_feed()
            if not self.writes_feed(step):
                value = gedit_nc.decimal_of(wanted) if wanted is not None else None
                if value is None:
                    line.refusals.append(_nc_cycles.CycleRefusal(self.pending_feed.number, "value-missing", _nc_run.quote(self.pending_feed.text), "the feed in force before the cycle"))
                elif value != self.out_feed:
                    offset = _feed_offset(step, removed)
                    out.append((offset, (sep if offset > 0 else "") + self.feed_address + wanted + ("" if offset > 0 else sep)))
                    self.out_feed = value
            self.pending_feed = None
        return out

    # -- a block that runs a cycle ---------------------------------------------------------

    def keep_data(self, line: Line, step: Any, read: _nc_cycles.CycleRead) -> None:
        """A cycle block with a repeat count of 0 and no position (Fanuc ``G81 Z… R… F… K0``): the
        control stores the cycle's values and drills nothing (FANUC 30i machining centre manual,
        the repeat count of the drilling cycles). The block stays as written, block number and
        all (it may be a jump target; fix batch 7, the owner's answer G of 2026-10-22), and gets
        nothing written back. Its cycle stays in force on the control, so the first move written
        for a later block that runs it carries its motion code and its feed (``expand``)."""
        self.kept_data.append((line, (getattr(read.words.get("repeat"), "text", None) or "").strip()))
        self.cycle_kept = line
        self.follow(step, line)

    def selection_start(self, line: Line, read: _nc_cycles.CycleRead) -> None:
        """A cycle whose values or start are above the selection (``selection-inside``)."""
        if not self.is_selection or self.base_line <= 1:
            return
        state = self.state()
        starts = [read.first_line]
        for key in ("activeCycle", "definedCycle"):
            found = as_dict(state.get(key))
            if found.get("code") == read.code and isinstance(found.get("line"), int):
                starts.append(found["line"])
        if min(starts) < self.base_line:
            line.refusals.append(_nc_cycles.CycleRefusal(line.number, "selection-inside", _nc_run.quote(line.text), "%s (line %d)" % (read.code, min(starts))))

    def expand(self, line: Line, step: Any, read: _nc_cycles.CycleRead, holes: List[_nc_cycles.Hole]) -> None:
        """The lines written in place of a block that runs a cycle."""
        tracker = self.tracker
        sep = _separator(line.text, step)
        refuse = lambda reason, detail="": line.refusals.append(_nc_cycles.CycleRefusal(line.number, reason, _nc_run.quote(line.text), detail))
        rapid = _nc_cycles.straight_code(tracker, "rapid")
        feed = _nc_cycles.straight_code(tracker, "feed")
        if feed is None:
            refuse("no-code", "a straight feed move")
            return
        if rapid is None and (self.rapid_word is None or feed.get("modal") is True):
            refuse("no-code", "a rapid move")
            return
        modal = feed.get("modal") is True
        if read.call == "MCALL":
            mcall = as_dict(self.state().get("activeCycle")).get("line")
            if isinstance(mcall, int):
                self.mcall_used.add(mcall)
        written: List[Tuple[str, bool]] = []
        bn = next((t for t in step.tokens if t.kind == "blockNumber"), None)
        comments = [t for t in step.tokens if t.kind == "comment"]
        own = [t for t in read.own if t.kind != "comment"]
        own_text = [t.text.strip() for t in own]
        if read.keep_block:
            inserts = self.restore(line, step, read.removed)
            edits = _removal_edits(step.tokens, read.removed) + [(offset, offset, new) for offset, new in inserts]
            written.append((_nc_run.splice(line.text, edits).rstrip() if edits else line.text, True))
            self.follow(step, line)
        state: Dict[str, Any] = {"motion": self.out_motion, "feed": self.out_feed}
        if self.cycle_kept is not None:
            # Fix batch 7: a block left as written above (`K0`) keeps the cycle in force on the
            # control. The first move written here carries its motion code, which ends the cycle
            # there as `G80` does (FANUC 30i: a code of the motion group ends a drilling cycle and
            # clears its values), and its feed, so it never runs the cycle or a cleared value.
            state = {"motion": None, "feed": None}
        lines_of_holes: List[List[str]] = []
        cur: Dict[str, Optional[Decimal]] = {}
        before = step.before or {}
        for axis in ("X", "Y"):
            cur[axis] = _nc_run_convert(before.get(axis), tracker.report_units, read.units)
        for hole in holes:
            cur["Z"] = hole.start
            if read.keep_block or read.approach is None and read.form != "word":
                cur["X"], cur["Y"] = hole.position.get("X"), hole.position.get("Y")
            for move in hole.moves:
                texts = self.move_lines(move, read, step, cur, state, rapid, feed, modal, sep, refuse)
                if texts is None:
                    return
                lines_of_holes.extend(texts)
            cur.update({a: v for a, v in hole.end.items()})
        if line.refusals:
            return
        self.out_motion = state["motion"]
        self.out_feed = state["feed"]
        # The first written block: the block number, the block's own words and the first move.
        if not read.keep_block:
            head = [bn.text.strip()] if bn is not None else []
            if lines_of_holes:
                first = lines_of_holes[0]
                if modal or not first:
                    words = head + own_text + first
                else:
                    words = head + first + own_text
                lines_of_holes[0] = words
            elif own_text or comments:
                lines_of_holes = [head + own_text]
            if lines_of_holes and comments:
                lines_of_holes[0] = lines_of_holes[0] + [c.text.strip() for c in comments]
            for index, words in enumerate(lines_of_holes):
                written.append((sep.join(w for w in words if w != ""), index == 0 and bn is not None))
        else:
            for words in lines_of_holes:
                written.append((sep.join(w for w in words if w != ""), False))
        line.out = written
        line.expanded = True
        if lines_of_holes:
            self.cycle_kept = None
        self.cycles += 1
        self.holes += len(holes)
        self.blocks += len(lines_of_holes)
        schema = read.schema
        leaves = as_dict(schema.get("leaves"))
        if leaves.get("motion") == "before" and modal:
            self.pending_motion = line
        if leaves.get("feed") == "before":
            self.pending_feed = line

    # -- one move --------------------------------------------------------------------

    def move_lines(self, move: _nc_cycles.HoleMove, read: _nc_cycles.CycleRead, step: Any, cur: Dict[str, Optional[Decimal]], state: Dict[str, Any], rapid: Optional[Dict[str, Any]], feed: Dict[str, Any], modal: bool, sep: str, refuse: Any) -> Optional[List[List[str]]]:
        """The words of the lines one move is written as, or ``None`` after a refusal."""
        if move.kind in ("rapid", "feed"):
            words: List[str] = []
            is_rapid = move.kind == "rapid"
            entry = rapid if (is_rapid and rapid is not None) else feed
            code = str(entry.get("code"))
            if not modal or state["motion"] != code:
                words.append(_styled(self.style_motion, code))
                if modal:
                    state["motion"] = code
            plane = [a for a in ("X", "Y") if a in move.to]
            copied = self.plane_copy(move, read, plane, step)
            if copied is not None:
                words.extend(copied)
            else:
                for axis in plane:
                    text = self.number(axis, move.to[axis], cur.get(axis), read, refuse)
                    if text is None:
                        return None
                    words.append(text)
            if "Z" in move.to:
                text = self.number("Z", move.to["Z"], cur.get("Z"), read, refuse)
                if text is None:
                    return None
                words.append(text)
            if is_rapid and rapid is None and self.rapid_word is not None:
                words.append(self.rapid_word)
            if not is_rapid:
                wanted = move.feed
                if wanted is not None:
                    value = gedit_nc.decimal_of(wanted[len(self.feed_address):] if wanted.upper().startswith(self.feed_address) else wanted)
                    if value is not None and value != state["feed"]:
                        words.append(wanted)
                        state["feed"] = value
                elif read.feed is not None:
                    value = gedit_nc.decimal_of(read.feed)
                    if value is not None and value != state["feed"]:
                        words.append(self.feed_address + read.feed)
                        state["feed"] = value
                elif state["feed"] is not None and state["feed"] != self.out_feed_before(read):
                    refuse("value-missing", "the feed in force")
                    return None
            for axis, value in move.to.items():
                cur[axis] = value
            return [words]
        if move.kind == "dwell":
            return self.dwell_lines(move, read, sep, refuse)
        if move.kind == "spindle-stop":
            group = as_dict(self.tracker.interp.entry(read.spindle or "")).get("group") if read.spindle else "spindle"
            found = self.stops.get(str(group), [])
            if len(found) != 1:
                refuse("no-code", "a spindle stop")
                return None
            return [[_styled(self.style_spindle, str(found[0].get("code")))]]
        if move.kind == "spindle-restore":
            if read.spindle is None:
                refuse("value-missing", "the spindle direction in force")
                return None
            return [[_styled(self.style_spindle, read.spindle)]]
        if move.kind == "orient":
            found = self.orients
            angle = read.words.get("orient-angle")
            if len(found) != 1 or angle is None:
                refuse("no-code", "an oriented spindle stop")
                return None
            code = str(found[0].get("code"))
            value = (angle.value_text or "").strip()
            return [[("%s=%s" % (code, value)) if len(code) > 1 and code.isalpha() else code + value]]
        refuse("no-code", move.kind)
        return None

    def out_feed_before(self, read: _nc_cycles.CycleRead) -> Optional[Decimal]:
        return gedit_nc.decimal_of(read.feed) if read.feed is not None else None

    def plane_copy(self, move: _nc_cycles.HoleMove, read: _nc_cycles.CycleRead, plane: List[str], step: Any) -> Optional[List[str]]:
        """The move to the hole copies the block's own position words (Fanuc) or the call's point
        (Klartext ``CYCL CALL POS``), as written; ``None`` for any other move in the plane."""
        if not plane or "Z" in move.to or move.step != -1:
            return None
        if read.approach is not None:
            found = [t for t in step.tokens if id(t) in read.removed and t.kind == "word" and (t.address or "").upper() in plane]
        else:
            found = [t for t in read.plane_words if (t.address or "").upper() in plane]
        return [t.text.strip() for t in found] if len(found) == len(plane) else None

    def number(self, axis: str, target: Decimal, here: Optional[Decimal], read: _nc_cycles.CycleRead, refuse: Any) -> Optional[str]:
        """``axis`` and ``target`` (absolute, block units) as a word in the distance mode in force,
        in the form of the word it comes from (plan §6.3 rule 5)."""
        incremental = read.distance == "incremental"
        if incremental:
            if here is None:
                refuse("start-unknown", axis)
                return None
            value = target - here
        else:
            value = target
        form, _ = self.form_of(axis, value, incremental, read)
        if form is None:
            refuse("no-code", "a word for %s" % axis)
            return None
        key = (form.text, value, read.units)
        written = self._words.get(key)
        if written is None:
            role = _nc_geom.WordRole(form, "point", axis, "length", None)
            written = _nc_geom.write_word(role, value, self.tracker, read.units, True, self.context)
            if len(self._words) > 20000:
                self._words = {}
            self._words[key] = written
        if isinstance(written, _nc_geom.Refusal):
            refuse(written.reason if written.reason in _nc_cycles.REASONS else "machine-dependent", "%s%s" % (axis, _nc_run.trim(value)))
            return None
        return written.text

    def form_of(self, axis: str, value: Decimal, incremental: bool, read: _nc_cycles.CycleRead) -> Tuple[Any, bool]:
        """The word whose form a written value takes: the word it is copied from when it is that
        word's value, else the cycle's main word with the decimals of its longest length word (at
        least ``_nc_geom.MIN_DECIMALS`` when the words carry a point)."""
        tracker = self.tracker
        units = read.units
        candidates: List[Any] = []
        if axis == "Z":
            if incremental:
                candidates = [read.words.get(r) for r in ("r-plane", "depth")]
            else:
                candidates = [read.words.get(r) for r in _nc_cycles.LEVEL_WORD_ROLES] + [read.level_token]
        else:
            role = "lift-off-first" if axis == "X" else "lift-off-second"
            if incremental:
                candidates = [read.words.get(role)]
        for token in candidates:
            if token is None or getattr(token, "value", None) is None:
                continue
            text, _ = tracker.readings.get(token.value, "length", units)
            if text is not None and Decimal(text) == value:
                return _form(token, axis, None), True
        lengths = [t for r, t in read.words.items() if r in _nc_cycles.LENGTH_ROLES and getattr(t, "value", None) is not None]
        if not lengths:
            return None, False
        main = None
        order = ("depth", "r-plane", "surface", "return", "first-peck", "depth-relative", "clearance") if axis == "Z" else ("lift-off-first" if axis == "X" else "lift-off-second", "depth", "surface")
        for role in order:
            if read.words.get(role) is not None and getattr(read.words[role], "value", None) is not None:
                main = read.words[role]
                break
        if main is None:
            main = lengths[0]
        decimals = max(len(t.value.frac_part or "") for t in lengths)
        if any(t.value.has_point for t in lengths):
            decimals = max(decimals, _nc_geom.MIN_DECIMALS.get(units, 3))
        return _form(main, axis, decimals), False

    def dwell_lines(self, move: _nc_cycles.HoleMove, read: _nc_cycles.CycleRead, sep: str, refuse: Any) -> Optional[List[List[str]]]:
        """A dwell with the database's dwell code (plan §6.3 rule 6): the cycle's word copied where
        the code takes the same address and number class, else the time in seconds, revolutions
        or lines."""
        found = self.dwells
        if len(found) != 1:
            refuse("no-code", "a dwell")
            return None
        entry = found[0]
        form = _nc_cycles.dwell_form_of(entry) or {}
        token = None
        for role in ("dwell", "dwell-top"):
            candidate = read.words.get(role)
            if candidate is not None and " ".join(candidate.text.split()) == move.dwell:
                token = candidate
                break
        if token is None:
            refuse("no-code", "a dwell")
            return None
        address = (token.address or "").upper()
        unit = next((p.get("unit") for p in _params(read.entry) if str(p.get("address")).upper() == address), None)
        code = _styled(self.style_motion, str(entry.get("code"))) if not form.get("lines") else str(entry.get("code"))
        for key in ("increments", "seconds", "revolutions"):
            if str(form.get(key) or "").upper() == address:
                taken = next((p.get("unit") for p in _params(entry) if str(p.get("address")).upper() == address), None)
                if taken == unit:
                    return [[code, token.text.strip()]]
        value = (token.value_text or "").strip()
        number = gedit_nc.decimal_of(value)
        if number is None:
            refuse("expression", token.text.strip())
            return None
        if number > 0:
            if form.get("seconds"):
                return [[code, str(form["seconds"]) + value]]
            if form.get("lines"):
                return [[str(text).replace("{s}", value)] for text in form["lines"]]
        elif number < 0 and form.get("revolutions"):
            return [[code, str(form["revolutions"]) + value.lstrip("-")]]
        refuse("no-code", "a dwell of %s" % token.text.strip())
        return None

    # -- the selection ------------------------------------------------------------------

    def selection_end(self) -> None:
        """A modal cycle still in force at the selection's end (its blocks below would not be
        written out), a mode to restore below it, a renumbering past it."""
        if not self.lines:
            return
        last = self.lines[-1]
        for item in reversed(self.lines):
            if item.text.strip() != "":
                last = item
                break
        interp = self.tracker.interp
        active = as_dict(interp.state.get("activeCycle"))
        start = active.get("line")
        by_number = {line.number: line for line in self.lines}
        if active.get("code") and (any(line.expanded for line in self.lines) or (isinstance(start, int) and start in by_number)):
            target = by_number.get(start) if isinstance(start, int) else None
            target = target or last
            target.refusals.append(_nc_cycles.CycleRefusal(target.number, "selection-inside", _nc_run.quote(target.text), "%s is still in force at the end" % active.get("code")))
        wanted_feed = self.in_feed()
        needed = []
        if self.pending_motion is not None and self.in_motion() != self.out_motion:
            needed.append(self.pending_motion)
        if self.pending_feed is not None and (wanted_feed is None or gedit_nc.decimal_of(wanted_feed) != self.out_feed):
            needed.append(self.pending_feed)
        for pending in needed:
            if not any(r.reason == "restore-outside" for r in pending.refusals):
                pending.refusals.append(_nc_cycles.CycleRefusal(pending.number, "restore-outside", _nc_run.quote(pending.text), ""))
        if self.renumbers:
            first = next((line for line in self.lines if line.expanded), None)
            if first is not None and not any(line.end_pgm for line in self.lines if line.number >= first.number):
                first.refusals.append(_nc_cycles.CycleRefusal(first.number, "renumber-outside", _nc_run.quote(first.text), ""))

    # -- the result -------------------------------------------------------------------

    def text_out(self) -> List[str]:
        """The program written: the expanded lines, the `MCALL CYCLE…` lines that left, and Klartext
        renumbered from the first written block to ``END PGM``."""
        records: List[Tuple[str, str, Optional[Line]]] = []  # (text, kind, line): 'orig', 'first', 'new'
        for line in self.lines:
            if line.number in self.mcall_lines and line.number in self.mcall_used:
                _, gone = self.mcall_lines[line.number]
                ids = frozenset(id(t) for t in gone)
                rest = [t for t in line.step.tokens if id(t) not in ids and _significant(t)]
                if not rest:
                    continue
                records.append((_remove(line.text, line.step.tokens, ids), "orig", line))
                continue
            if line.out is None:
                records.append((line.text, "orig", line))
                continue
            for index, (text, _) in enumerate(line.out):
                if line.expanded:
                    records.append((text, "first" if index == 0 else "new", line))
                else:
                    records.append((text, "orig", line))
        if not self.renumbers:
            return [text for text, _, _ in records]
        return self.renumbered(records)

    def renumbered(self, records: List[Tuple[str, str, Optional[Line]]]) -> List[str]:
        step = self.numbering.get("step")
        step = step if isinstance(step, int) and not isinstance(step, bool) and step > 0 else 1
        out: List[str] = []
        counter: Optional[int] = None
        for text, kind, line in records:
            found = gedit_nc.block_number_of(text, self.cp) if text.strip() else None
            if counter is None and kind == "first" and line is not None:
                own = gedit_nc.block_number_of(line.text, self.cp)
                counter = own["value"] if own is not None else (found["value"] if found is not None else None)
            if counter is None:
                out.append(text)
                continue
            if found is not None:
                out.append(text[: found["start"]] + str(counter) + text[found["end"] :])
                counter += step
            elif kind == "new" or kind == "first":
                out.append("%d %s" % (counter, text))
                counter += step
            else:
                out.append(text)
            if line is not None and line.end_pgm and kind == "orig":
                counter = None
        return out


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------


def _params(entry: Any) -> List[Dict[str, Any]]:
    return _nc_run.entry_params(entry)


def _nc_run_convert(value: Optional[Decimal], source: Optional[str], target: str) -> Optional[Decimal]:
    if value is None or source not in ("mm", "inch") or source == target:
        return value
    return value * _nc_run.INCH if source == "inch" else value / _nc_run.INCH


_STYLED: Dict[Tuple[str, str], str] = {}


def _styled(style: Optional[str], code: str) -> str:
    """``code`` in the written style of the program's codes (``G01`` or ``G1``)."""
    if not style:
        return code
    key = (style, code)
    found = _STYLED.get(key)
    if found is None:
        found = _STYLED[key] = _nc_geom.partner_text(style, code)
    return found


def _form(token: Any, address: str, decimals: Optional[int]) -> Any:
    """A word ``address`` written in the form of ``token``'s number; with ``decimals``, a number of
    at least that many decimals (a point-less word stays point-less)."""
    literal = token.value
    raw = (token.value_text or "").strip()
    if decimals is not None and literal.has_point and len(literal.frac_part or "") < decimals:
        sign = literal.sign or ""
        raw = "%s%s.%s" % (sign, literal.int_part or "0", (literal.frac_part or "").ljust(decimals, "0"))
        literal = gedit_nc.parse_number(raw)
    return gedit_nc.Token(kind="word", start=0, end=0, text=address + raw, address=address, value_text=raw, value=literal)


def _skips(step: Any) -> bool:
    """The block carries a block skip (``/``)."""
    return any(t.kind == "skip" for t in step.tokens)


def _separator(text: str, step: Any) -> str:
    """How the block separates its words: a blank, or nothing in a packed program. The block skip
    and the block number say nothing about it (``/N60 X20.`` is no packed block; fix batch 1,
    NC-2)."""
    tokens = [t for t in step.tokens if t.kind != "continuation"]
    for a, b in zip(tokens, tokens[1:]):
        if a.kind not in ("whitespace",) and b.kind not in ("whitespace",):
            if a.kind in ("blockNumber", "skip") or a.kind == "comment" or b.kind == "comment":
                continue
            return ""
        if a.kind == "whitespace" or b.kind == "whitespace":
            return " "
    return " "


def _head_offset(step: Any) -> int:
    """Where a code written at the head of a block goes: after the block number."""
    for token in step.tokens:
        if token.kind in ("whitespace", "blockNumber", "skip", "label"):
            continue
        return token.start
    return len("".join(t.text for t in step.tokens))


def _feed_offset(step: Any, removed: Any = frozenset()) -> int:
    """Where a feed word written into a block goes: before its first ``M`` word, else after its
    last word (the tokens in ``removed`` leave the block and count for neither)."""
    last = 0
    for token in step.tokens:
        if id(token) in removed:
            continue
        if token.kind == "word" and (token.address or "").upper() == "M":
            return token.start
        if _significant(token):
            last = token.end
    return last


def _insert(text: str, inserts: Sequence[Tuple[int, str]]) -> str:
    return _nc_run.splice(text, [(offset, offset, new) for offset, new in inserts])


def _removal_edits(tokens: Sequence[Any], removed: Any) -> List[Tuple[int, int, str]]:
    """The edits that take the tokens in ``removed`` (by ``id``) out of a line, each with the blank
    before it (one blank between two removed tokens is taken once)."""
    edits: List[Tuple[int, int, str]] = []
    listed = list(tokens)
    for i, token in enumerate(listed):
        if id(token) not in removed:
            continue
        start = token.start
        if i > 0 and listed[i - 1].kind == "whitespace":
            start = listed[i - 1].start
        if edits and start < edits[-1][1]:
            edits[-1] = (edits[-1][0], token.end, "")
        else:
            edits.append((start, token.end, ""))
    return edits


def _remove(text: str, tokens: Sequence[Any], removed: Any) -> str:
    """``text`` without the tokens in ``removed`` (by ``id``), each with the blank before it."""
    edits = _removal_edits(tokens, removed)
    return _nc_run.splice(text, edits).rstrip() if edits else text


# ---------------------------------------------------------------------------
# Findings and the message
# ---------------------------------------------------------------------------


def finding_of(refusal: _nc_cycles.CycleRefusal) -> Dict[str, Any]:
    text = _nc_cycles.REASONS[refusal.reason]
    detail = " (%s)" % refusal.detail if refusal.detail and refusal.reason in DETAILED else ""
    return {"line": refusal.line, "severity": "error", "message": "%s: %s%s." % (refusal.written, text, detail), "reason": refusal.reason}


def collect(writer: Writer) -> Tuple[List[Dict[str, Any]], Dict[str, int], int, int]:
    """One error per refused block, its first reason in the order of ``_nc_cycles.REASONS``."""
    by_line: Dict[int, List[_nc_cycles.CycleRefusal]] = {}
    for line in writer.lines:
        for refusal in line.refusals:
            by_line.setdefault(refusal.line, []).append(refusal)
    counts: Dict[str, int] = {}
    findings: List[Dict[str, Any]] = []
    for number in sorted(by_line):
        first = sorted(by_line[number], key=lambda r: REASON_PLACE.get(r.reason, 999))[0]
        counts[first.reason] = counts.get(first.reason, 0) + 1
        findings.append(finding_of(first))
    dropped = max(0, len(findings) - MAX_FINDINGS)
    return findings[:MAX_FINDINGS], counts, len(by_line), dropped


def message(writer: Writer, counts: Dict[str, int], refused: int, dropped: int, note: str) -> str:
    sentences: List[str] = []
    if refused:
        parts = [count_text(counts[r], *REASON_TEXT[r]) for r in REASON_PLACE if counts.get(r) and r in REASON_TEXT]
        sentences.append("Nothing was changed: %s cannot be written out as plain moves: %s." % (count_text(refused, "block"), ", ".join(parts)))
    elif writer.cycles:
        sentences.append(
            "Expanded %s (%s) into %s." % (count_text(writer.cycles, "cycle"), count_text(writer.holes, "hole"), count_text(writer.blocks, "block"))
        )
        if writer.definitions:
            sentences.append("The cycle definitions are left as written; without a call they do nothing.")
    else:
        sentences.append("No drilling cycle to expand: nothing was changed.")
    if dropped:
        sentences.append("%s further findings are not listed." % "{:,}".format(dropped))
    sentences.append(note)
    return " ".join(sentences)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def refused_run(text: str, first: int, reason: str, message_text: str, finding: str) -> None:
    gedit_nc.envelope(text, message_text, [{"line": first, "severity": "error", "message": finding, "reason": reason}])


def main() -> int:
    setup = _nc_run.prepare(SCRIPT, Params, (ValueError,))
    if isinstance(setup, int):
        return setup
    context, lines, text, profile, cp, params, codes = setup
    scope = _nc_run.scope_of(context)
    note = _nc_run.machine_note(gedit_nc.machine_params(context))
    if not codes:
        refused_run(
            text,
            scope.first,
            "no-database",
            "Nothing was changed: this run had no code database, so it cannot tell how a cycle moves. " + note,
            "This run had no code database for this control; nothing was written out.",
        )
        return 0
    if gedit_nc.machine_type_of(profile) == "lathe":
        refused_run(
            text,
            scope.first,
            "lathe",
            "Nothing was changed: drilling cycles are written out on milling programs only. " + note,
            "This is a turning program: %s." % _nc_cycles.REASONS["lathe"],
        )
        return 0
    if scope.fragment and not scope.preceding:
        _nc_run.unprimed_envelope(text, scope.first, SCRIPT, note, "the distance mode, the units, the cycle return mode and a cycle", "written out")
        return 0
    writer = Writer(context, cp, params)
    writer.is_selection = scope.selection
    writer.walk(scope.preceding, lines, scope.first)
    findings, counts, refused, dropped = collect(writer)
    if refused:
        gedit_nc.envelope(text, message(writer, counts, refused, dropped, note), findings)
        return 0
    out = writer.text_out()
    if writer.cycles and writer.definitions:
        findings.append(
            {
                "line": writer.definitions[0],
                "severity": "info",
                "message": "%s%s." % (_nc_cycles.INFO["definition-kept"][0].upper(), _nc_cycles.INFO["definition-kept"][1:]),
                "reason": "definition-kept",
            }
        )
    for line, repeat in writer.kept_data:
        findings.append(
            {
                "line": line.number,
                "severity": "info",
                "message": "%s: %s%s." % (_nc_run.quote(line.text), _nc_cycles.INFO["data-kept"], " (%s)" % repeat if repeat else ""),
                "reason": "data-kept",
            }
        )
    gedit_nc.envelope("\n".join(out), message(writer, counts, refused, dropped, note), findings)
    return 0



if __name__ == "__main__":
    sys.exit(main())
