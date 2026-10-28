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
# help = "In the program's units (mm or inch). Also moves the cycle positions on the tool axis (the R plane of a drilling cycle, Q203, RTP, RFP, DP). A Klartext cycle called with CYCL CALL POS is moved in Z only when every call of it is one: then the calls' Z moves and Q203 stays (the call's Z adds to the cycle's surface)."
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
* **Two notes of the v1.2.0 review round.** On a profile whose tool centre point control can
  read its coordinates in the table's or in the workpiece's system (Fanuc mill,
  `syntax.tcpTableCoordinates`), the first block the shift moves under it carries an
  information row (`tcp-table`) and the message a sentence: the shift assumes the table
  coordinate system (parameter 19696 bit 5 = 0; owner decision D6-4). On a lathe set to the
  Series 15 format (`syntax.cycleRAbsoluteWith` names the point-less-feeds choices), the `R`
  of a drilling cycle is left as written with an information row (`cycle-r-left`): there R
  can be an absolute position (parameter 5102 bit 6).
* **The machine's extra axes** (P4h fix round, Q-5; plan section 6.10 rule 13). A linear axis
  of more than one letter that the machine lists (`extraAxes`, read into
  `syntax.extraAxisNames`: `AA`) is no X, Y or Z, so its words are left as written; the run
  does not refuse for them. One information row per such axis, at its first word, names it and
  how many of its words were left (`extra-axis`), so a user whose `AA` runs along X sees that it
  did not move. A rotary extra axis is left as silently as `C` is.

What moves and what stays
-------------------------
Moved: absolute points, absolute arc centres (`I=AC(…)`, an absolute `arcCenterMode`), the
Klartext pole `CC`, cycle positions (the `X`/`Y`/`Z` of a block under `G81`, `CYCL CALL POS`,
the positions behind `MCALL`) and the cycle parameters on the tool axis (`R` under `G90`,
`Q203`, `RTP`, `RFP`, `DP`) with a Z shift. Left as written: incremental moves and twins
(`G91`, `U`, `W`, Klartext `IX`), incremental centres, radii, polar radii and angles, and
every word that is no position. A cycle moves with the blocks that run it in one piece,
which the all-or-nothing rule gives for free. An incremental move along the tool axis after
a drilling cycle starts where the cycle left the tool, its start level or its retract plane:
the shift moves both, so the increment, left as written, ends where it should, when the
level the cycle started from was written (v1.2.0, NC-18); from a level nobody knows it is
refused (`axis-unwritten`). The shift is in the units of the first block
that states them; a block in the other units gets it converted (25.4 exactly).

**A cycle called at a position** (Klartext `CYCL CALL POS X… Y… Z…`) moves with a shift in
X and Y. Its tool-axis position adds to the surface coordinate the definition gives (`Q203`),
so a shift along the tool axis refuses the call and the definition it runs
(`cycle-position`): moving both would move the cycle twice, moving one would leave the other
where it was. v1.2.0 (T021): when **every** call of the definition in the run is a
`CYCL CALL POS` that writes the tool axis, the shift moves the calls' coordinate on the tool
axis and leaves the definition's (`Q203`) as written, so the cycle moves once; any other call
of it (`M99`, `CYCL CALL`, a block under `M89`) keeps the refusal.

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
v1.2.0 (NCR-3): the tool stands where the lines above left it, a point the shift does not move,
until a block moves it to a written position on every shifted axis the program has written
above (the join); a block that runs from there otherwise (an arc, a polar move, an increment, a
move without one of them, a single pass, which goes back there) is refused
(`selection-start`, the id rotate and mirror use), and so is a single pass that takes its end
point on a shifted axis from above the selection; a selection that ends while the single passes
are in force and that the run changed is refused (`selection-inside`). The owner's decision of
2026-10-19 (D4): a first move without a shifted axis whose position the lines above wrote as a
number (not lost since to a call, a cycle, a tool change, or a work offset or tool offset picked
since) gets that axis added, shifted, in the form the lines above wrote it, in absolute mode
only, and an information row says so (`word-added`: "Z55. added: the move started at the
unmoved Z of the lines above"). A cycle that runs while the tool axis
still stands at the level of the lines above is refused (`selection-start`): it moves to its
holes at that level and, in `G98`, returns to it (`G98`/`G99` are no data, so both).

v1.2.0 (FZ-5, plan section 7 #503): a selection is judged as the whole run judges its blocks,
so it reads the lines below it too (`input.followingLines`) for the one rule that looks ahead:
a move made before a rotary axis that turns it is first written, when the program turns that
axis later (`rotary-turned`). Without those lines such a move is refused (`selection-below`).

Two refusals concern the whole run rather than a block, with reasons of their own: a run
with no code database (`no-database`: a move cannot be told from a machine position or a
frame) and a selection whose lines above were not sent (`selection-unprimed`: the distance
mode, the units, a frame and a cycle in force there are not known).

Everything outside the values it changes — line endings, spacing, block numbers, comments —
is handed back byte for byte: the only edits are the spans of the words that move.
"""

from __future__ import annotations

import sys
from decimal import Decimal
from typing import Any, Dict, List, Optional, Sequence, Tuple

import gedit_nc
import _nc_geom
import _nc_path
import _nc_run
from _nc_run import INCH, as_dict, count_text, decimal_text, entry_params, trim
from _nc_run import quote as _quote

#: The axes of the form, in its order.
AXES = ("X", "Y", "Z")
#: The form ids of the axes.
PARAM_IDS = {"X": "dx", "Y": "dy", "Z": "dz"}
#: The labels of the form, for its errors.
PARAM_LABELS = {"X": "X shift", "Y": "Y shift", "Z": "Z shift"}

#: At most this many findings; the rest are counted in the message. The app takes 1000.
MAX_FINDINGS = 500

#: v1.2.0 (D4): the code groups that change where the program's coordinates put the tool
#: without a move of their own: a work offset (`G55`, `G15 H2`, Klartext cycle 7) and a tool
#: length compensation (`G43 H2`, `G49`). An axis written in the same block is written under
#: the new setting.
OFFSET_GROUPS = ("offset", "lengthComp")
#: v1.2.0 (D4): the words that pick a tool or its offsets when no code of the block takes them
#: as a parameter (Sinumerik `D2`, a lathe `T0202`, a lone `H2`); `T` also changes the tool,
#: which may move it to the change position.
OFFSET_WORDS = ("D", "H")
TOOL_WORDS = ("T",)

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
    "cycle-level-empty": ("cycle with an empty level on the tool axis", "cycles with an empty level on the tool axis"),
    "cycle-plane": ("cycle outside the XY plane", "cycles outside the XY plane"),
    "fk-contour": ("free contour (FK)", "free contours (FK)"),
    "arc-unsupported": ("arc gEdit cannot compute", "arcs gEdit cannot compute"),
    "pole-unknown": ("move around a pole that is not known", "moves around a pole that is not known"),
    "resolution": ("block with a word that cannot hold the shift", "blocks with a word that cannot hold the shift"),
    "selection-start": ("first move of the selection that would miss the moved path", "first moves of the selection that would miss the moved path"),
    "selection-below": ("move that waits on a rotary axis the lines below may turn", "moves that wait on a rotary axis the lines below may turn"),
}

#: The refusals of the run itself, beside ``_nc_geom.REASONS``: id -> the plain text after
#: "<as written>: " (v1.2.0, NCR-3; the same id as rotate's and mirror's).
RUN_REASONS = {
    # v1.2.0 (FZ-5, plan section 7 #503).
    "selection-below": (
        "this move waits on a rotary axis the program has not written above it, and the lines "
        "below the selection were not available, so whether the program turns that axis later "
        "(which would make this move unsafe to shift) is not known. Run Translate on the whole "
        "program"
    ),
    "selection-start": (
        "the selection starts where the lines above it leave the tool, and that point is not "
        "moved with the selection. An arc, an incremental move, a turning or facing pass (which "
        "goes back to that point), a drilling cycle (which moves to its hole at that level and, "
        "with G98, returns to it), or a move without a shifted axis whose position above is not "
        "known, would miss the moved path, and so would a pass that takes its end point from a "
        "block above the selection. Start the selection at a block that moves to a position on "
        "every shifted axis, and give its first pass every value"
    ),
}
#: The information rows of the run itself, beside ``_nc_geom.INFO``: id -> (the count's words,
#: singular and plural; the row's text after "<the words>: "). v1.2.0, the owner's decision of
#: 2026-10-19: a word added to the selection's first move.
OWN_INFO = {
    "word-added": (
        ("word added to the first move of the selection", "words added to the first move of the selection"),
        "the move started at the unmoved %s of the lines above",
    ),
}
#: The information rows: a machine position is a return or a position in machine coordinates.
INFO_TEXT = {
    "return": ("return to the reference point", "returns to the reference point"),
    "machine-position": ("position in machine coordinates", "positions in machine coordinates"),
    "word-left": ("word gEdit cannot place", "words gEdit cannot place"),
    # Review round (NC-9, D6-4).
    "cycle-r-left": ("drilling R point (Series 15 format)", "drilling R points (Series 15 format)"),
    "tcp-table": ("block under tool centre point control", "blocks under tool centre point control"),
}
#: P4h fix round (Q-5): the information row of a linear extra axis of the machine.
EXTRA_AXIS_TEXT = (
    "%s is an extra axis of the machine, and Translate moves only X, Y and Z, so it left %s as written. "
    "If %s moves along X, Y or Z on this machine, change %s by hand"
)
#: The words of a linear extra axis, an information row of this script's own (`OWN_INFO`).
OWN_INFO["extra-axis"] = (("word of an extra axis of the machine", "words of an extra axis of the machine"), EXTRA_AXIS_TEXT)
INFO_TEXT["extra-axis"] = OWN_INFO["extra-axis"][0]
#: At most this many words of one extra axis are named in its row; the rest are counted.
EXTRA_AXIS_NAMED = 5
#: Review round (D6-4): the run's sentence when a block it moved stands under tool centre point
#: control on a profile whose control can read those coordinates in two ways.
TCP_SENTENCE = (
    "Tool centre point control: the shift assumes the table coordinate system "
    "(parameter 19696 bit 5 = 0). Check your machine."
)

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

    __slots__ = ("index", "number", "text", "block", "edits", "refusals", "notes", "added", "tool_edits", "extra")

    def __init__(self, index: int, number: int, text: str, block: int) -> None:
        self.index = index
        self.number = number
        self.text = text
        self.block = block
        #: (start, end, text) of every word that moves.
        self.edits: List[Tuple[int, int, str]] = []
        self.refusals: List[_nc_geom.Refusal] = []
        self.notes: List[_nc_geom.Refusal] = []
        #: v1.2.0 (owner decision 2026-10-19): the words added to the selection's first move,
        #: as (axis, the word as written).
        self.added: List[Tuple[str, str]] = []
        #: v1.2.0 (T021): the edits of the words of a cycle definition on the tool axis (`Q203`),
        #: which a run whose every call of that definition is a call at a position takes back out
        #: (``settle_called_at``).
        self.tool_edits: List[Tuple[int, int, str]] = []
        #: P4h fix round (Q-5): the words of a linear extra axis of the machine on this line, as
        #: (the axis name as listed, the word as written).
        self.extra: List[Tuple[str, str]] = []


def linear_extra_axes(profile: Dict[str, Any]) -> Dict[str, str]:
    """The linear extra axes of the machine (P4h, plan section 6.10 rule 13): the names of
    ``syntax.extraAxisNames`` that ``addresses.angular`` does not list, by their upper-case
    spelling (as listed). A rotary one is left as any rotary axis is."""
    syntax = as_dict(profile.get("syntax"))
    names = syntax.get("extraAxisNames")
    angular = {str(a).upper() for a in (as_dict(profile.get("addresses")).get("angular") or []) if isinstance(a, str)}
    out: Dict[str, str] = {}
    for name in names if isinstance(names, list) else []:
        if isinstance(name, str) and name != "" and name.upper() not in angular and name.upper() not in out:
            out[name.upper()] = name
    return out


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
        #: v1.2.0 (T021): every call of a definition in the run, by the line of the definition:
        #: (the call's line, whether it is a call at a position that writes the tool axis).
        self.calls_of: Dict[int, List[Tuple[int, bool]]] = {}
        #: v1.2.0 (T019): the labels of the run's lines (upper case -> their line numbers) and of
        #: the lines above it, for a contour written between two labels (`CYCLE95("A:B", …)`).
        self.labels: Dict[str, List[int]] = {}
        self.labels_above: set = set()
        #: v1.2.0 (NCR-3): the shifted axes on which the tool still stands where the lines above
        #: a selection left it (a point the run does not move), until a block moves it to a
        #: written position on all of them; and the axes a single pass of the selection wrote
        #: its end point on (a pass takes the others from the block that last wrote them).
        #: ``None`` until the selection's first line, which says which axes the program has
        #: written above it.
        self.outside: Optional[set] = set()
        self.pass_axes: set = set()
        #: v1.2.0 (owner decision 2026-10-19): the last absolute word the lines above the
        #: selection wrote on each axis (its token): the form a word added to the selection's
        #: first move is written in; ``None`` after a subprogram or macro call.
        self.last_word: Dict[str, Any] = {}
        self._macro_seen = False
        #: P4h fix round (Q-5): the machine's linear extra axes (`linear_extra_axes`).
        self.extra_axes = linear_extra_axes(profile)

    def note_extra_axes(self, line: Line, step: _nc_path.Step) -> None:
        """P4h fix round (Q-5): the words of a linear extra axis of the machine on the line,
        which the run leaves as written (`collect` lists them)."""
        if not self.extra_axes:
            return
        for token in step.tokens:
            if token.kind != "word" or not token.address or token.value_text is None:
                continue
            name = self.extra_axes.get(token.address.upper())
            if name is not None:
                line.extra.append((name, token.text.strip()))

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

    def walk(self, preceding: Sequence[str], lines: Sequence[str], base_line: int, following: Optional[Sequence[str]] = None) -> None:
        tracker = self.tracker
        cp = self.cp
        state = None
        continued = False
        self.base_line = base_line
        first_number = base_line - len(preceding)
        for offset, text in enumerate(preceding):
            state, step = tracker.line(text, first_number + offset, state, False)
            self.labels_above.update((t.address or "").upper() for t in step.tokens if t.kind == "label")
            continued = any(t.kind == "continuation" for t in step.tokens)
            self.note_rotary(step, record=False)
            if self.is_selection:
                self.note_last_words(step)
        if preceding and self.is_selection:
            self.outside = None
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
            self.note_call(line, step)
            for token in step.tokens:
                if token.kind == "label":
                    self.labels.setdefault((token.address or "").upper(), []).append(number)
            self.note_rotary(step, record=True, line=line)
            self.note_extra_axes(line, step)
            self.selection_start(line, step)
            if self.is_selection:
                self.check_outside(line, step)
                if self.outside:
                    # The first move is still to come: a call, a tool change or an offset of
                    # the selection before it makes a position of the lines above unknown too.
                    self.note_last_words(step)
            continues = any(t.kind == "continuation" for t in step.tokens)
            if text.strip() != "":
                # The trailing empty element of a selection that ends with a line break is
                # no line of the block: the last written line says whether it goes on.
                last_line = line
                selection_continued = continues
            last_continued = continues
        # T021: a definition whose calls are all calls at a position keeps its values on the
        # tool axis, which the end of a selection reads (a definition the run left as written
        # may be called below it).
        self.settle_called_at()
        self.settle_contours()
        if self.is_selection:
            # CODE-3: every selection, from line 1 too (a cycle started in it can still be in
            # force below it).
            self.selection_end(last_line, selection_continued)
            # FZ-5 (plan section 7 #503): what the program does below the selection decides,
            # as it does for the whole run, whether a rotary axis the selection's moves wait on
            # is ever turned (`settle_rotary`).
            self.walk_below(state, following, base_line + len(lines))
        self.settle_rotary()

    def walk_below(self, state: Any, following: Optional[Sequence[str]], first: int) -> None:
        """v1.2.0 (FZ-5): the lines below a selection, read for the rotary axes only (where the
        program turns one the selection's moves wait on). Without them, a move that waits on such
        an axis is refused (``selection-below``): the whole run might refuse it."""
        if not self.pending_rotary:
            return
        if following is None:
            for line, axes in self.pending_rotary:
                if not any(r.reason in ("rotary-turned", "selection-below") for r in line.refusals):
                    line.refusals.append(_nc_geom.Refusal(line.number, "selection-below", _quote(line.text), ", ".join(sorted(axes))))
            self.pending_rotary = []
            return
        tracker = self.tracker
        for offset, text in enumerate(following):
            state, step = tracker.line(text, first + offset, state, False)
            self.note_rotary(step, record=False)

    def note_last_words(self, step: _nc_path.Step) -> None:
        """The last absolute word on each axis above the selection, for the form of a word the
        first move gets added (``add_missing``). A subprogram or macro call may leave the tool
        anywhere, whatever the tracker still holds: every axis is not known after it until a
        block writes it again (``None``). So may a tool change (the change position is the
        machine's), and a work offset or a tool offset picked since puts the same point at other
        coordinates (``position_events``)."""
        before, after = self.position_events(step)
        if before:
            for axis in AXES:
                self.last_word[axis] = None
        if step.kind == "move":
            for read in step.reads or []:
                token = read.token
                if read.incremental is False and token is not None and (token.address or "").upper() == read.axis and _nc_path.literal_of(token)[0] is not None:
                    self.last_word[read.axis] = token
        if after or (self.may_call(step) and _nc_geom._line_has_call(_nc_geom._block_of(step, self.tracker)) is not None):
            for axis in AXES:
                self.last_word[axis] = None

    def position_events(self, step: _nc_path.Step) -> Tuple[bool, bool]:
        """v1.2.0 (D4): whether ``step`` changes where the program's coordinates put the tool
        without a move the tracker follows: (before its words, after them). Before: a work
        offset or a tool length compensation (``OFFSET_GROUPS``), or a lone offset word
        (``OFFSET_WORDS``): an axis written in the same block is written under the new setting.
        After: a tool change (a code of the group ``tool``: `M6`, Klartext `TOOL CALL`) or a
        lone `T` word: the change may move the tool to the machine's change position."""
        before = after = False
        taken: set = set()
        for entry, _, _ in step.entries:
            group = entry.get("group")
            if group in OFFSET_GROUPS:
                before = True
            elif group == "tool":
                after = True
            taken.update(str(p.get("address") or "").upper() for p in entry_params(entry))
        words = step.words or {}
        if any(address in words and address not in taken for address in OFFSET_WORDS):
            before = True
        if any(address in words and address not in taken for address in TOOL_WORDS):
            after = True
        return before, after

    def may_call(self, step: _nc_path.Step) -> bool:
        """A quick look whether ``step`` may call a program, before `_nc_geom` is asked (which
        builds the whole block): a call token, a code that calls or names a program, the
        profile's call pattern, or a modal macro call seen above (`G66`)."""
        if step.calls or self._macro_seen:
            return True
        for entry, _, _ in step.entries:
            if entry.get("call") is True or any(p.get("programNumber") for p in entry_params(entry)):
                if entry.get("modal") is True and entry.get("wordsAreData") is True:
                    self._macro_seen = True
                return True
        text = step.masked or ""
        return any(regex.search(text) for regex in _nc_geom._data(self.tracker).calls)

    # -- one line -----------------------------------------------------------------

    def judge(self, line: Line, step: _nc_path.Step) -> None:
        tracker = self.tracker
        context = self.context
        op = self.op_for(step.units)
        roles = _nc_geom.roles_of(step, tracker)
        refusals = at_levels(list(_nc_geom.refusals_of(step, roles, tracker, op, context)), step, op)
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
                if role.role == "tool-axis":
                    line.tool_edits.append(edits[-1])
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

    # -- a cycle called at a position (NC-3, T021) ----------------------------------

    def note_call(self, line: Line, step: _nc_path.Step) -> None:
        """v1.2.0 (T021): a block that runs the cycle defined last (`M99`, `CYCL CALL`, a
        positioning block under `M89`, `CYCL CALL POS`), by the line of the definition."""
        running = step.cycle
        if not running:
            return
        defined = as_dict(self.tracker.interp.state.get("definedCycle"))
        start = defined.get("line")
        if defined.get("code") != running or not isinstance(start, int) or isinstance(start, bool):
            return
        # A call at a position that leaves the tool axis out (the manual asks for all three
        # axes) has no coordinate the shift could move: it counts as any other call.
        token = (step.words or {}).get(self.tool_axis())
        written = token is not None and (token.value_text or "") != ""
        at_position = written and any(r.reason == "cycle-position" and r.detail.startswith(CALL_POSITION + ":") for r in line.refusals)
        self.calls_of.setdefault(start, []).append((line.number, at_position))


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
        the run (one above a selection refuses the call as `selection-inside`).

        v1.2.0 (T021): unless **every** call of that definition in the run is a call at a
        position that writes the tool axis. The tool-axis coordinate of such a call acts like
        a further datum shift on the cycle (TNC 640 cycle manual, cycle call with CYCL CALL
        POS), so the shift moves the calls' coordinate and leaves the definition's own values
        on the tool axis (`Q203`) as written: the cycle moves once. The approach compares the
        tool's position on the tool axis with the surface of the cycle; under that datum shift
        the call's coordinate, the tool and so the comparison move together."""
        by_number = {line.number: line for line in self.lines}
        settled: set = set()
        for start, call_line, code, axis in self.called_at:
            if start in settled:
                continue
            target = by_number.get(start)
            if target is None:
                continue
            if self.calls_at_positions(start):
                settled.add(start)
                for member in self.lines:
                    if member.number >= start and member.block == target.block and member.tool_edits:
                        member.edits = [e for e in member.edits if e not in member.tool_edits]
                for number, _ in self.calls_of.get(start, []):
                    call = by_number.get(number)
                    if call is not None:
                        call.refusals = [r for r in call.refusals if not (r.reason == "cycle-position" and r.detail.startswith(CALL_POSITION + ":"))]
                continue
            if any(r.reason == "cycle-position" and r.detail.startswith(CALLED_AT_POSITION) for r in target.refusals):
                continue
            target.refusals.append(
                _nc_geom.Refusal(start, "cycle-position", _quote(target.text), "%s:%s:%d:%s" % (CALLED_AT_POSITION, code, call_line, axis))
            )

    def settle_contours(self) -> None:
        """v1.2.0 (T019): a cycle whose only positions of its own are a contour written in the
        program between two labels (`CYCLE95("START:END", …)`; SINUMERIK cycles manual, CYCLE95,
        the contour name) moves with that contour when the run moves its blocks: each label
        stands once in the run, on no line above it, the first above the last. Its refusal is
        taken back then; a contour in a subprogram, or one the run does not hold, keeps it."""
        prefix = _nc_geom.CONTOUR_LABELS
        for line in self.lines:
            kept = []
            for refusal in line.refusals:
                if refusal.reason == "cycle-position" and refusal.detail.startswith(prefix) and self.labels_in_run(refusal.detail[len(prefix):]):
                    continue
                kept.append(refusal)
            line.refusals = kept

    def labels_in_run(self, detail: str) -> bool:
        for pair in detail.split(";"):
            first, _, last = pair.partition(":")
            a, b = self.labels.get(first, []), self.labels.get(last, [])
            if len(a) != 1 or len(b) != 1 or first in self.labels_above or last in self.labels_above or a[0] >= b[0]:
                return False
        return True

    def calls_at_positions(self, start: int) -> bool:
        """v1.2.0 (T021): every call of the definition on line ``start`` is a call at a position
        that writes the tool axis."""
        calls = self.calls_of.get(start, [])
        return bool(calls) and all(at for _, at in calls)

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

    def pass_runs(self, step: _nc_path.Step) -> bool:
        """The block runs a single pass (`sets.path: 'cycle'`: the lathe `G90`, `G92`, `G94`,
        `G77`-`G79`, written or in force): while the passes are in force a block runs one again
        even when it moves nothing (lathe manual, the canned cycles)."""
        tracker = self.tracker
        if not tracker.whole_pass(tracker.interp.state, [e for e, _, _ in step.entries]):
            return False
        return any(t.kind not in ("whitespace", "comment") for t in step.tokens)

    def check_outside(self, line: Line, step: _nc_path.Step) -> None:
        """v1.2.0 (NCR-3): the start of a selection. The tool stands where the lines above left
        it, a point the shift does not move. A single pass goes back to that point (refused
        while the tool stands there); a pass that does not write its end point on a shifted
        axis takes it from above the selection (refused until a pass of the selection wrote
        it); and the first block that moves the tool must go to a written position on every
        shifted axis (the join): an arc, a polar move, an increment or a move without one of
        them would run from the unmoved point (`selection-start`).

        The owner's decision of 2026-10-19: a move without a shifted axis whose position the
        lines above wrote gets that axis added, shifted (``add_missing``), in absolute mode only.
        v1.2.0 (D4): a block that runs a cycle while the tool axis still stands at the level the
        lines above left (the cycle positions there and, with `G98`, returns there; `G98` and
        `G99` are no data, so both) is refused; no word is added to it."""
        if self.outside is None:
            # An axis the program has not written above the selection, or not since a move to a
            # machine position, stands where the whole run leaves it too; one it wrote stands
            # at a point the whole run moves (or at one nobody knows: refused alike).
            unwritten = step.unwritten or frozenset()
            tracker = self.tracker
            self.outside = {axis for axis in AXES if self.params.shift[axis] != 0 and axis in tracker.pos and axis not in unwritten}
        if self.pass_runs(step):
            written = {r.axis for r in self._roles if r.role in ("point", "cycle-position") and r.axis in AXES}
            changed = {axis for axis in AXES if self.params.shift[axis] != 0}
            taken = sorted(axis for axis in changed & set(self.pass_lengths_axes(step)) if axis not in written and axis not in self.pass_axes)
            self.pass_axes |= written
            if self.outside:
                self.refuse_start(line, "a single pass, which goes back to where the lines above left the tool")
            elif taken and step.line >= self.base_line and self.base_line > 1:
                self.refuse_start(line, "a single pass that takes its %s from above the selection" % "".join(taken))
            return
        if not self.outside:
            return
        # An axis a move to a machine position inside the selection took away stands where the
        # whole run leaves it too.
        self.outside -= set(step.unwritten or ())
        if not self.outside:
            return
        roles = self._roles
        polar = step.polar is not None or any(r.role.startswith("polar") for r in roles)
        arc = step.arc is not None or any(isinstance(e, _nc_path.Unknown) and e.kind == "arc" for e in step.events)
        linear = [r for r in roles if r.role in ("point", "point-inc", "cycle-position") and r.axis in AXES]
        if step.kind in ("machine", "data", "pole", "frame", "unknown-code") or not (linear or arc or polar or step.cycle):
            return  # it does not move the tool from there (a machine position is left as written)
        absolute = {r.axis for r in linear if r.role != "point-inc"}
        increments = {r.axis for r in linear if r.role == "point-inc"}
        if arc:
            self.refuse_start(line, "an arc")
        elif polar:
            self.refuse_start(line, "a polar move")
        elif step.cycle and self.level_outside():
            self.refuse_start(line, "a cycle that starts at the level the lines above left the tool at")
        elif increments & self.outside:
            self.refuse_start(line, "an incremental move")
        elif self.outside - absolute:
            missing = self.outside - absolute
            if step.cycle or not self.add_missing(line, step, linear, missing):
                self.refuse_start(line, "a move without %s" % "".join(sorted(missing)))
        self.outside = set()

    def level_outside(self) -> bool:
        """v1.2.0 (D4): whether a cycle run now starts at a level the lines above left the tool
        at: the tool axis (Z in the XY plane) still stands there; in another plane, or one not
        known, any shifted axis that still stands there. The cycle moves to its position at that
        level, and a word cycle in `G98` returns to it after every hole: the unmoved level."""
        plane = self.tracker.interp.state.get("plane")
        if plane == "XY":
            return "Z" in (self.outside or set())
        return bool(self.outside)

    def add_missing(self, line: Line, step: _nc_path.Step, linear: Sequence[_nc_geom.WordRole], missing: set) -> bool:
        """The owner's decision of 2026-10-19: the first move of a selection that does not write
        a shifted axis gets that axis added, shifted, where the lines above wrote its position as
        a number: the move then ends on the moved path. Only in absolute mode (an added word in
        incremental mode would be an increment), only where the position is known, not on an
        axis read as a diameter, and in the form the lines above wrote the axis in (the block's
        own word of another axis when they wrote none). Returns whether every missing axis was
        added; when one cannot be, none is (the block is refused as before)."""
        tracker = self.tracker
        state = tracker.interp.state
        if not linear or any(r.role == "point-inc" for r in linear) or state.get("distance") != "absolute":
            return False
        if any(self.position_events(step)):
            return False  # a tool or an offset picked in the block itself
        units = step.units if step.units in ("mm", "inch") else as_dict(state.get("units")).get("value")
        if units not in ("mm", "inch"):
            return False
        op = self.op_for(units)
        before = step.before or {}
        unsure = step.unsure or frozenset()
        report = tracker.report_units
        anchor = sorted(linear, key=lambda r: r.token.start)
        edits: List[Tuple[int, int, str]] = []
        added: List[Tuple[str, str]] = []
        for axis in sorted(missing, key=AXES.index):
            value = before.get(axis)
            if value is None or axis in unsure or axis in self.diameter_words:
                return False
            value = tracker.axes.geo(axis, value)
            if report == "mm" and units == "inch":
                value = value / INCH
            elif report == "inch" and units == "mm":
                value = value * INCH
            if axis in self.last_word and self.last_word[axis] is None:
                return False  # a call above the selection may have left it anywhere
            token = self.last_word.get(axis)
            if token is not None:
                like = _nc_geom.WordRole(token, "point", axis, anchor[0].number_class, None)
            else:
                like = anchor[0]
            written = _nc_geom.write_added(axis, like, value + op.shift[axis], tracker, units, True, self.context)
            if isinstance(written, _nc_geom.Refusal):
                return False
            # Beside the block's words of the other axes, in the order X, Y, Z.
            after = [r for r in anchor if r.axis in AXES and AXES.index(r.axis) < AXES.index(axis)]
            near = after[-1].token if after else anchor[0].token
            text = line.text
            # The block's own spacing, as the mirror adds a word: a packed block stays packed.
            if near.start > 0:
                gap = " " if text[near.start - 1 : near.start].isspace() else ""
            else:
                gap = " " if near.end >= len(text) or text[near.end : near.end + 1].isspace() else ""
            if after:
                edits.append((near.end, near.end, gap + written.text))
            else:
                edits.append((near.start, near.start, written.text + gap))
            added.append((axis, written.text))
        line.edits.extend(edits)
        line.added.extend(added)
        return True

    def pass_lengths_axes(self, step: _nc_path.Step) -> List[str]:
        """The axes a single pass writes its end point on (its parameters named after an axis)."""
        tracker = self.tracker
        motion = tracker.pass_motion(tracker.interp.state, [e for e, _, _ in step.entries])
        return [a for a in (str(p.get("address") or "").upper() for p in entry_params(motion)) if a in AXES]

    def refuse_start(self, line: Line, detail: str) -> None:
        if not any(r.reason == "selection-start" for r in line.refusals):
            line.refusals.append(_nc_geom.Refusal(line.number, "selection-start", _quote(line.text), detail))
        self.outside = set()

    def selection_end(self, last: Optional[Line], continued: bool) -> None:
        """The selection ends inside a block (its last line goes on below it), while a modal
        cycle started in it is in force, or while a cycle defined in it, whose definition
        the shift changed, can still be called below it. v1.2.0 (NCR-3): or while the single
        passes are in force and the run changed the selection: a pass below it would run from
        a moved start point or with a moved end point."""
        if last is None:
            return
        if continued:
            last.refusals.append(_nc_geom.Refusal(last.number, "selection-inside", _quote(last.text), "the block goes on below"))
        tracker = self.tracker
        if tracker.whole_pass(tracker.interp.state, []) and any(line.edits for line in self.lines):
            motion = tracker.pass_motion(tracker.interp.state, [])
            last.refusals.append(
                _nc_geom.Refusal(last.number, "selection-inside", _quote(last.text), "%s is still in force at the end" % as_dict(motion).get("code"))
            )
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


#: The place of each reason of `_nc_geom.REASONS` in its order, then the run's own.
REASON_PLACE = {reason: place for place, reason in enumerate(list(_nc_geom.REASONS) + list(RUN_REASONS))}

#: The first place of the reasons `Run.moved` can add to a block (a word with no value, one that does not fit its form).
MOVED_FROM = min(REASON_PLACE[reason] for reason in ("expression", "machine-dependent", "distance-assumed", "resolution"))


def at_levels(refusals: List[_nc_geom.Refusal], step: _nc_path.Step, op: _nc_geom.Translate) -> List[_nc_geom.Refusal]:
    """v1.2.0 (T011, NC-18): an increment along a shifted axis from a level the program wrote
    (``Step.levels``: where a drilling cycle left the tool axis, its start level or its retract
    plane, when the level it started from was known) is moved with the program, as the level
    is: it is not refused for ``axis-unwritten``. The refusal names the first axis it found,
    so it is dropped only when no other shifted axis could have been the reason: each is known
    or at such a level, and the program has written every one of them."""
    levels = getattr(step, "levels", None)
    if not levels:
        return refusals
    kept = [r for r in refusals if not (r.reason == "axis-unwritten" and r.detail in levels)]
    if len(kept) == len(refusals):
        return refusals
    before = step.before or {}
    unwritten = step.unwritten or frozenset()
    for axis, amount in op.shift.items():
        if Decimal(amount) == 0 or axis not in before:
            continue
        if axis in unwritten or (before.get(axis) is None and axis not in levels):
            return refusals
    return kept


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
    """The text of a refusal translate words itself (NC-3, NCR-3), or ``None``."""
    if refusal.reason in RUN_REASONS:
        return RUN_REASONS[refusal.reason]
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
    extra_words: Dict[str, List[Tuple[int, str]]] = {}
    # One finding per refused block (a block written over several lines is one block): its
    # first reason in the order of `_nc_geom.REASONS`, at the line that has it.
    by_block: Dict[int, List[_nc_geom.Refusal]] = {}
    for line in run.lines:
        by_block.setdefault(line.block, []).extend(line.refusals)
    refused_blocks = {block for block, found in by_block.items() if found}
    for block in sorted(refused_blocks):
        first = first_refusal(by_block[block])
        refused[first.reason] = refused.get(first.reason, 0) + 1
        item = _nc_geom.finding_of(first) if first.reason in _nc_geom.REASONS else {"line": first.line, "severity": "error", "message": "", "reason": first.reason}
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
        for name, word in [] if refused_blocks else line.extra:
            # Counted here, listed once per axis below.
            info["extra-axis"] = info.get("extra-axis", 0) + 1
            extra_words.setdefault(name, []).append((line.number, word))
        if line.added and not refused_blocks:
            # Only in a run that writes: a refused run adds nothing.
            info["word-added"] = info.get("word-added", 0) + len(line.added)
            axes = " and ".join(axis for axis, _ in line.added)
            words = " ".join(text for _, text in line.added)
            message = "%s added: %s." % (words, OWN_INFO["word-added"][1] % axes)
            rows.append((line.number, SEVERITY_ORDER["info"], {"line": line.number, "severity": "info", "message": message, "reason": "word-added"}))
    for name, words in extra_words.items():
        first_line, first_word = words[0]
        named = [word for _, word in words[:EXTRA_AXIS_NAMED]]
        rest = len(words) - len(named)
        if rest:
            left = "%s and %s more %s" % (", ".join(named), "{:,}".format(rest), "word" if rest == 1 else "words")
        else:
            left = named[0] if len(named) == 1 else "%s and %s" % (", ".join(named[:-1]), named[-1])
        message = "%s: %s." % (_quote(first_word), EXTRA_AXIS_TEXT % (name, left, name, "it" if len(words) == 1 else "them"))
        rows.append((first_line, SEVERITY_ORDER["info"], {"line": first_line, "severity": "info", "message": message, "reason": "extra-axis"}))
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
    return _nc_run.machine_note(run.machine, run.x_reading)


def info_sentence(info: Dict[str, int]) -> Optional[str]:
    blocks = info.get("return", 0) + info.get("machine-position", 0)
    words = info.get("word-left", 0) + info.get("cycle-r-left", 0) + info.get("extra-axis", 0)
    if not blocks and not words:
        return None
    what = []
    if blocks:
        what.append(count_text(blocks, "block"))
    if words:
        what.append(count_text(words, "word"))
    parts = [count_text(info[key], *INFO_TEXT[key]) for key in ("return", "machine-position", "word-left", "cycle-r-left", "extra-axis") if info.get(key)]
    return "Left %s as written: %s." % (" and ".join(what), ", ".join(parts))


def summary(run: Run, findings: Findings, refused: Dict[str, int], info: Dict[str, int], blocks_refused: int) -> str:
    sentences: List[str] = []
    if blocks_refused:
        parts = [count_text(refused[reason], *REASON_TEXT.get(reason, (reason, reason))) for reason in REASON_PLACE if refused.get(reason)]
        sentences.append(
            "Nothing was changed: %s cannot be moved by %s: %s."
            % (count_text(blocks_refused, "block"), shift_text(run), ", ".join(parts))
        )
    else:
        words = sum(len(line.edits) for line in run.lines)
        blocks = len({line.block for line in run.lines if line.edits})
        if words:
            added = info.get("word-added", 0)
            extra = ", %s" % count_text(added, *OWN_INFO["word-added"][0]) if added else ""
            sentences.append("Moved by %s: %s on %s%s." % (shift_text(run), count_text(words, "word"), count_text(blocks, "block"), extra))
        else:
            sentences.append("Moved by %s: no word changed." % shift_text(run))
        left = info_sentence(info)
        if left is not None:
            sentences.append(left)
        if info.get("tcp-table"):
            sentences.append(TCP_SENTENCE)
    if findings.dropped:
        sentences.append("%s further findings are not listed." % "{:,}".format(findings.dropped))
    sentences.append(machine_note(run))
    return " ".join(sentences)


def apply_edits(lines: Sequence[str], run: Run) -> List[str]:
    out = list(lines)
    for line in run.lines:
        if not line.edits:
            continue
        out[line.index] = _nc_run.splice(line.text, line.edits)
    return out


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main() -> int:
    setup = _nc_run.prepare("Translate", Params, (ValueError,))
    if isinstance(setup, int):
        return setup
    context, lines, text, profile, cp, params, codes = setup
    # CODE-3: a selection is a selection from line 1 too (its end is judged); only one that
    # starts lower has lines above it to prime the walk with (`_nc_run.Scope.fragment`).
    scope = _nc_run.scope_of(context)
    base_line, selection, fragment, preceding = scope.first, scope.selection, scope.fragment, scope.preceding

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
        _nc_run.unprimed_envelope(text, base_line, "Translate", machine_note(run), "the distance mode, the units, a frame and a cycle", "moved")
        return 0

    run.is_selection = selection
    run.walk(preceding, lines, base_line, _nc_run.following_lines(context))
    findings = Findings()
    refused, info, blocks_refused = collect(run, findings)
    out = lines if blocks_refused else apply_edits(lines, run)
    gedit_nc.envelope("\n".join(out), summary(run, findings, refused, info, blocks_refused), findings.items)
    return 0


if __name__ == "__main__":
    sys.exit(main())
