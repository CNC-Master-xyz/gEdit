"""The path tracker: where the tool is before and after every block (Phase 4 plan §6.1, AD-48).

**Written by the P4a prelude as a stub, implemented by P4.1.** The data types and the number
helpers are the ones ``extents.py`` carried (it imports them from here now); the tracker is
``Extents.line``/``Extents.block`` of before P4.1, moved. ``tests/python/test_nc_path.py``
holds its cases, ``tests/python/test_extents.py`` the guard.

What it is: the position tracker and the arc and polar geometry that ``extents.py`` has
carried since M10, taken out so the geometry scripts (translate, rotate, mirror; P4a), the
cycle expansion and the statistics (P4b) read the **same** path. ``extents.py`` keeps what is
its own (ranges, scopes, work-offset groups, the held rotary positions, findings and their
texts, machine rows) and asks the tracker for everything else. **The guard:** every extents
golden and every owner-public extents run stays byte for byte the same (AD-48).

**The contract (binding, plan §6.1):**

* A tracker walks lines in order, one :meth:`PathTracker.line` call per line, priming lines
  (``input.precedingLines``) first with ``record=False``. Each call returns a :class:`Step`.
* Positions are kept in **column values**, exactly as ``extents.py`` keeps them: on a turning
  profile whose ``X`` is a diameter word (``PathAxes.lathe_column``) ``X`` is a diameter,
  everywhere else a coordinate. :meth:`PathAxes.geo` turns a column value into a coordinate
  (half a diameter), :meth:`PathAxes.col` back. Arc and polar geometry is in coordinates.
* Lengths are in the tracker's ``report_units``: the units of the first **recorded** block
  that states them (``mm`` or ``inch``); a block in the other units is converted
  (25.4 exactly) and ``units_switched`` is set. Angles in degrees.
* A value is **never guessed** (AD-31, D57): a word whose reading depends on the machine with
  no machine chosen, a variable, an incremental word with no known start, a distance mode
  that is not known, a diameter reading that is not known — each leaves the axis **not
  known** (``None``) and adds an :class:`Unknown` event with one id of
  :data:`UNKNOWN_KINDS`. The axis stays unknown until a block writes it absolutely.
* ``Step.events`` lists, in order, every :class:`Unknown` and every :class:`Reach` (a point
  the path reaches: the end points of the block and an arc's extremes) **in the order
  ``Extents.block`` raised and noted them before P4.1** — resolve misses, then the polar
  move, then the arc (its extremes or its miss), then the block's end points, then what the
  cycle in force leaves unknown. ``extents.py`` replays them into its ranges and findings;
  that order is what keeps its findings byte for byte.
* The arc direction comes from **data** (§6.2): ``CodeSets.arcDirection`` of the motion code
  in force (``gedit_nc.arc_direction_of``), or the profile's ``addresses.arcDirectionWords``
  (Klartext ``DR+``/``DR-``, ``gedit_nc.arc_direction_words_of``) written in the block. The
  vocabulary constants ``ARC_CODES`` and ``DIRECTION_WORD`` of ``extents.py`` retire; on the
  six built-in databases the flags say exactly what the table said (``G2`` clockwise, ``G3``
  counter-clockwise, ``DR-``/``DR+``), so no extents result changes.
* An arc is described whatever the convention: :class:`Arc` has its centre, start and end
  as **absolute coordinates** of the plane, from an incremental centre (``I``/``J``/``K``
  under ``arcCenterMode: 'incremental'``), an absolute one (``arcCenterMode: 'absolute'``,
  ``I=AC(…)``), a radius (``R``, ``CR=``; negative: over 180°, chord slack
  :data:`CHORD_SLACK`), or the pole (Klartext ``C``/``CP`` around ``CC``).
* What stays **not resolved** (an :class:`Unknown` of kind ``'arc'``, the end point known when
  written): tangential arcs and arcs through a point (:data:`UNRESOLVED_ARCS`: Klartext
  ``CT``, ``CTP``, Sinumerik ``CT``, ``CIP``), Okuma arcs by an ``L`` radius and the C-axis
  contour arcs ``G102``/``G103`` (no ``arcDirection`` flag), and a Sinumerik arc by its end
  point and its opening angle ``AR=`` (:data:`ANGLE_WORD`) with no centre. **One case the
  extents read wrongly changed:** ``G2``/``G3 I… J… AR=…`` with no end point was taken for a
  full circle and left the tool at the start point; the tracker reports the arc as not
  resolved and its end as not known (``'arc'``) instead, for any ``AR=`` arc that writes no
  end point in its plane (plan §7 #294, with a regression test in ``test_nc_path.py``; no
  golden pins the old reading).
* A machine position (``axisWords: 'machine'``: ``G28``, ``G53``, ``M91``, ``SUPA``) leaves the
  axes it names not known; a data block (``axisWords: 'data'``, ``wordsAreData``) moves
  nothing and forgets what the code changes; a frame in force leaves the moved axes not
  known; a multi-pass cycle (a ``'start'`` cycle whose words are data: the Fanuc lathe
  ``G71``–``G73``) leaves the plane not resolved; a program start after the first forgets
  every axis (``called``). These are today's rules of ``Extents.block``, moved, not changed.

* **P4a fix B1 (plan §7 #312, #313, #315, #322).** Beside the positions, which stay those of
  the straight walk (so the extents stay byte for byte), each :class:`Step` carries what that
  walk does not see (:class:`_Flow`): ``unsure``, the axes whose position is not known because
  a jump, a loop or a skippable block reaches the line from elsewhere, or a frame code turned
  the rotary axes; ``unwritten``, the axes the program has not written yet; ``flow``, the
  :class:`FlowEvent` of the line; and ``pole_line``, the line that set the pole. The flow
  codes come from data (``CodeEntry.flow``, ``positionsRotary``), the labels from the tokens.

* **P4a fix B6 (CODE-1, no output changes).** A long program asks the tracker the same few
  questions on every line, so what depends only on the kind of word is worked out once:
  :class:`Readings` reads a number's value from one multiplication when every preset of the
  profile agrees on the factor, and ``PathTracker(context, cp, reach=False, flow=False)`` leaves
  out the :class:`Reach` events and the :class:`_Flow` bookkeeping for a walk that does not read
  them (the transforms; the walk over a written program that only checks its arcs).

* **v1.2.0, the NC fix round (batch NCF-B).** A block of a single-pass cycle
  (``sets.path: 'cycle'``: the lathe ``G90``, ``G94``, system B ``G77``, ``G79``) reaches the
  point it writes and leaves the tool where it started (T111; the one change to the
  positions, golden ``extents/lathe-box-cycle``). A ``PLANE`` whose angles are all 0, or
  ``PLANE RESET``, with ``TURN`` or ``MOVE`` turns no rotary axis (T010). ``Step.levels``
  names the axes not known that stand at a level the program wrote, where a drilling cycle
  leaves the tool axis (T011, NC-18); translate reads it. A block that runs a cycle written
  as a word (``G81``, written there or in force) is no arc, whatever arc code the motion group
  still holds: its ``R`` is the retract plane (FZ-4, the fuzz review).

* **v1.2.0, batch NCF-C.** The threading passes (system A ``G92``, B ``G78``) are whole passes
  too (``path: 'cycle'``). A pass with a taper (``CodeParam.lengthAlong`` on its ``R``) reaches
  its end coordinate plus the taper along that axis, the start of the cut (golden
  ``extents/lathe-taper-pass``); the passes share ``R`` and their end point until a block
  writes them again, a one-shot code other than a dwell or a plane code clears them.

* **v1.2.0, batch D2.** After :meth:`PathTracker.forget_all` (a program after the first, a
  macro or data block) and after a subprogram call, the values the passes share are **not
  known** (:attr:`PathTracker.pass_unknown`, :meth:`PathTracker.pass_taper`), not "no taper":
  the lathe Z mirror refuses a facing pass then, and the extents leave the taper start of a pass
  that does not write ``R`` not resolved (NCR-2). A block that writes a tool offset
  (:func:`writes_tool_offset`: ``G10 L11 P1 R0.1``) forgets no position (NCR-10). A cycle with
  parameters leaves a level on the tool axis (``Step.levels``) only where its levels were written
  as numbers where it was defined or called with them (:attr:`PathTracker.cycle_levels`,
  :func:`empty_levels`: the ``MCALL`` line, a Klartext definition's ``Q203``; NCR-9).

Standard library only, Python 3.9 and newer. A bundled script imports this module by name
(``import _nc_path``); it imports ``gedit_nc`` and is never imported by it (plan §7 #292).
"""

from __future__ import annotations

import math
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation, localcontext
from array import array
from typing import Any, Dict, FrozenSet, List, NamedTuple, Optional, Sequence, Set, Tuple, Union

import gedit_nc


# ---------------------------------------------------------------------------
# The geometry vocabulary (moved from extents.py by P4.1; the one place a script names
# geometry words). The arc direction is no longer here: it is data (plan §6.2).
# ---------------------------------------------------------------------------

#: The arc centre words by the axis they offset (ISO; the profile's ``addresses.arcCenter``
#: says which of them a dialect writes, ``arcCenterMode`` how).
CENTRE_AXIS = {"I": "X", "J": "Y", "K": "Z"}
#: The words that give an arc by its radius (ISO ``R``, Sinumerik ``CR=``, Klartext ``CR … R``).
RADIUS_WORDS = ("R", "CR")
#: Klartext's polar words: the radius and the angle about the pole.
POLAR_RADIUS = "PR"
POLAR_ANGLE = "PA"
#: Arcs the tracker cannot compute: tangential ones (Klartext ``CT``, ``CTP``, Sinumerik
#: ``CT``) and one through an intermediate point (Sinumerik ``CIP``). Their end points are
#: known when written; their bulge is not resolved.
UNRESOLVED_ARCS = ("CT", "CTP", "CIP")
#: Sinumerik's number of extra full turns of a helix (``TURN=2``).
TURNS_WORD = "TURN"
#: Sinumerik's opening angle of an arc (``AR=140.134``, 0 to 360, unsigned: the direction is
#: the motion code's). New in P4a: an arc written with it is not resolved.
ANGLE_WORD = "AR"
#: Sinumerik's value functions: ``X=AC(10)`` is absolute and ``X=IC(2)`` incremental whatever
#: the distance mode says. Only a plain number inside is read.
VALUE_FUNCTIONS = {"AC": "absolute", "IC": "incremental"}

#: A plane -> its first and second axis. Positive angles turn from the first to the second,
#: which is counter-clockwise seen from the positive third axis.
PLANE_AXES = {"XY": ("X", "Y"), "ZX": ("Z", "X"), "YZ": ("Y", "Z")}
#: A plane -> the axis normal to it, the tool axis of a drilling plane.
PLANE_NORMAL = {"XY": "Z", "ZX": "Y", "YZ": "X"}

#: How far an arc's radius may fall short of half its chord before the arc counts as one the
#: control would refuse (a post rounds both end points), in the program's units. The same
#: 0.002 is the arc tolerance of Q4-4 in millimetres (``_nc_geom.ARC_TOLERANCE``).
CHORD_SLACK = Decimal("0.002")
#: One inch in millimetres, exactly.
INCH = Decimal("25.4")
#: Decimals a computed coordinate (a radius, a polar point) is carried with.
COMPUTED = 6

_ZERO = Decimal(0)
_ONE = Decimal(1)
_TWO = Decimal(2)

#: Why a position is not known — the ``kind`` of an :class:`Unknown`. The ids are the extents'
#: finding kinds of today (``extents.KINDS`` without ``rotary`` and ``selection``, which stay
#: the extents' own), so the replay needs no table.
UNKNOWN_KINDS = (
    "machine-dependent",  # the reading depends on the machine and none is chosen (D57)
    "expression",  # a variable or an expression
    "distance-unknown",  # absolute or incremental is not known yet
    "diameter-unknown",  # diameter or radius is not known (Sinumerik DIAM90 and friends)
    "incremental-start",  # an incremental word with no known start
    "called-program",  # a program after the first, before it states the axis
    "frame",  # a coordinate frame is in force
    "unknown-code",  # a code the database lacks under its motion letter
    "multi-pass",  # a cycle the control computes from data words (G71-G73)
    "cycle",  # what a cycle in force leaves unknown (its depth, its return level)
    "cycle-position",  # an axis word that is a called cycle's own position (CYCL CALL POS)
    "arc",  # an arc the tracker cannot compute
    "polar",  # a polar move whose pole, radius or angle is not known
    "data",  # a data block's axis words (the extents' information row; no axis)
)

_NO_AXES: FrozenSet[str] = frozenset()

#: P4a fix B1 (NC-5, plan §7 #312): what :attr:`Step.flow` reports (:class:`FlowEvent`).
#: ``'modal'``: two ways into a block (a jump and the straight run, a loop's start and its
#: end, a block that may be skipped) leave a different modal state of what the transforms
#: read (``ModalInterpreter.fingerprint``); ``'reentry'``: the blocks from :attr:`FlowEvent.line`
#: run again from where this block leaves the tool, and :attr:`FlowEvent.axes` stand elsewhere
#: then than on the first run; ``'target'``: a jump whose target gEdit cannot follow (a
#: computed one, a loop end without its start).
FLOW_EVENTS = ("modal", "reentry", "target")
#: The values of ``CodeEntry.flow`` (plan §7 #312).
FLOWS = ("jump", "label", "branch", "else", "branch-end", "loop", "loop-end", "repeat")

#: What :attr:`Step.kind` may be.
STEP_KINDS = ("none", "move", "machine", "multi-pass", "data", "pole", "frame", "unknown-code")


# ---------------------------------------------------------------------------
# Data types (final; P4.2 builds them by hand in its tests)
# ---------------------------------------------------------------------------


class Unknown(NamedTuple):
    """One thing that left the position of each of ``axes`` not known (one finding)."""

    kind: str  #: one of :data:`UNKNOWN_KINDS`
    axes: Tuple[str, ...]  #: may be empty (``'data'``)
    line: int
    detail: str = ""  #: what the extents' finding names (``G2 (line 12)``)
    key: str = ""  #: what the extents' findings are counted by
    extra: Optional[Dict[str, Any]] = None  #: further members of the finding (``readings``, ``names``)


class Reach(NamedTuple):
    """A point the path reaches on one axis: an end point or an arc's extreme (column value)."""

    axis: str
    value: Decimal
    line: int


Event = Union[Unknown, Reach]


class WordRead(NamedTuple):
    """How the tracker read one axis word of a block (what ``Extents.resolve_moves`` decided)."""

    axis: str  #: the axis it moves (a twin's axis: ``U`` → ``X``)
    token: Any  #: the ``gedit_nc.Token``
    address: str  #: upper case, as written (``U``, ``X``, ``Z``)
    incremental: Optional[bool]  #: ``None`` when the distance mode is not known
    function: Optional[str]  #: ``'absolute'``/``'incremental'`` from ``AC()``/``IC()``
    value: Optional[Decimal]  #: effective, in ``report_units``, as a column value; ``None`` when not known
    reading: Optional[str]  #: ``'diameter'``/``'radius'`` for a diameter word, else ``None``
    unknown: Optional[str]  #: the :data:`UNKNOWN_KINDS` id when ``value`` is ``None``


class FlowEvent(NamedTuple):
    """P4a fix B1 (NC-5): one thing the flow of the program does at a line (:data:`FLOW_EVENTS`)."""

    kind: str
    line: int  #: the other line: the jump, the label, the loop start; 0 when there is none
    axes: Tuple[str, ...] = ()  #: for ``'reentry'``: the axes (and ``'pole'``) that differ
    detail: str = ""  #: the label or the code as written


class Arc(NamedTuple):
    """An arc of one block, in coordinates of its plane, whatever the program's convention."""

    line: int
    plane: Tuple[str, str]  #: the plane's first and second axis (``("X", "Y")``, ``("Z", "X")``)
    direction: str  #: ``'cw'`` or ``'ccw'``, as the control defines it (§6.2)
    form: str  #: ``'centre'`` (I/J/K), ``'radius'`` (R, CR=), ``'pole'`` (Klartext C, CR about CC), ``'polar'`` (CP)
    centre: Tuple[Decimal, Decimal]  #: absolute
    start: Tuple[Decimal, Decimal]
    end: Tuple[Decimal, Decimal]
    full: bool  #: a whole circle (end = start with a centre, or ``TURN=`` above 0)
    sweep: Optional[float]  #: degrees, signed (ccw positive), when the block gives it (``CP IPA``)
    #: The axes outside the plane that move with the arc (a helix): axis -> (start, end) column values.
    helix: Dict[str, Tuple[Optional[Decimal], Optional[Decimal]]]


class Polar(NamedTuple):
    """A polar move about the pole (Klartext ``LP``, ``CP``), in coordinates of its plane."""

    line: int
    plane: Tuple[str, str]
    pole: Tuple[Decimal, Decimal]
    radius: Decimal  #: after the block
    angle: Decimal  #: after the block, degrees, absolute (an ``IPA`` already added)
    arc: bool  #: ``CP`` (an arc about the pole) rather than ``LP``


class Step:
    """What one line did to the path. Built by :meth:`PathTracker.line`; read, never changed."""

    __slots__ = (
        "line",
        "kind",
        "tokens",
        "masked",
        "entries",
        "unknown_codes",
        "calls",
        "moves",
        "words",
        "reads",
        "before",
        "after",
        "pole",
        "arc",
        "polar",
        "cycle",
        "units",
        "events",
        "pole_line",
        "unsure",
        "unwritten",
        "levels",
        "flow",
    )

    def __init__(self, line: int) -> None:
        self.line = line
        #: One of :data:`STEP_KINDS`: ``'none'`` writes nothing that matters to the path.
        self.kind = "none"
        #: The line's tokens and its comment-masked text (``gedit_nc.mask_comments``).
        self.tokens: List[Any] = []
        self.masked = ""
        #: (database entry, canonical code, token kind) of every code the line writes, as
        #: ``Extents.written`` found them.
        self.entries: List[Tuple[Dict[str, Any], str, str]] = []
        #: Codes under the database's motion letter that the database lacks (``G123``).
        self.unknown_codes: List[str] = []
        #: The call tokens of the line (Sinumerik ``CYCLE81(…)``, ``L100``).
        self.calls: List[Any] = []
        #: The words that move an axis, in written order: (axis, token).
        self.moves: List[Tuple[str, Any]] = []
        #: Every word of the line by its upper-case address (the last one wins).
        self.words: Dict[str, Any] = {}
        #: How each of ``moves`` was read. In a machine position, a data block and a pole
        #: block: the value as written, never added to a position; ``value`` is ``None`` (with
        #: ``unknown``) for a word of a frame, an unknown code or a cycle's own position.
        self.reads: List[WordRead] = []
        #: Every axis of ``PathAxes.order`` before the line (after a program start has
        #: forgotten them) and after it, column values; ``None`` while not known.
        self.before: Dict[str, Optional[Decimal]] = {}
        self.after: Dict[str, Optional[Decimal]] = {}
        #: The pole (Klartext ``CC``) after the line, by axis, coordinates.
        self.pole: Dict[str, Decimal] = {}
        self.arc: Optional[Arc] = None
        self.polar: Optional[Polar] = None
        #: The cycle the line runs (``Extents.after_cycle``'s ``running``), canonical code.
        self.cycle: Optional[str] = None
        #: The units in force on the line (``'mm'``, ``'inch'`` or ``None``; ``None`` too on a
        #: line that writes neither a code nor an axis word).
        self.units: Optional[str] = None
        #: :class:`Unknown` and :class:`Reach`, in the order of the contract above.
        self.events: List[Event] = []
        #: P4a fix B1 (NC-4): the line that set the pole in force after this line (0: none).
        self.pole_line = 0
        #: P4a fix B1 (NC-5, NC-11; plan §7 #312, #315): the axes (and ``'pole'``) whose
        #: position at the start of this line is **not known** for a reason the straight walk
        #: does not see — a jump or a loop reaches the line from elsewhere, a block before it
        #: may be skipped (``/``), or a frame code turned the rotary axes — although
        #: :attr:`before` may hold a value. Empty almost always.
        self.unsure: FrozenSet[str] = _NO_AXES
        #: P4a fix B1 (NC-9; plan §7 #313): the axes the program has not written before this
        #: line (since the program start or a move to a machine position). An axis a cycle
        #: left not known has been written.
        self.unwritten: FrozenSet[str] = _NO_AXES
        #: v1.2.0 (T011, NC-18): the axes whose position at the start of this line is not known
        #: (:attr:`before` is ``None``) but is a level the program wrote: where a cycle in the
        #: XY plane leaves the tool axis (its start level or its retract plane, `G98`/`G99`),
        #: when the level the cycle started from was known, and an increment from such a level.
        #: The value is not computed; a translation moves the level with the program.
        self.levels: FrozenSet[str] = _NO_AXES
        #: P4a fix B1 (NC-5): what the flow of the program does at this line (:class:`FlowEvent`).
        self.flow: Tuple["FlowEvent", ...] = ()


# ---------------------------------------------------------------------------
# Number helpers (moved from extents.py, verbatim; extents imports them)
# ---------------------------------------------------------------------------


def literal_of(token: Any) -> Tuple[Any, Optional[str]]:
    """The number a word is written with, and ``'absolute'``/``'incremental'`` when a value
    function (:data:`VALUE_FUNCTIONS`) says so; ``(None, None)`` for an expression."""
    if token.value is not None:
        return token.value, None
    text = (token.value_text or "").strip()
    open_at = text.find("(")
    if open_at <= 0 or not text.endswith(")"):
        return None, None
    mode = VALUE_FUNCTIONS.get(text[:open_at].strip().upper())
    literal = gedit_nc.parse_number(text[open_at + 1 : -1].strip()) if mode is not None else None
    return (literal, mode) if literal is not None else (None, None)


def dec(text: Optional[str]) -> Optional[Decimal]:
    """A decimal string as a :class:`Decimal`, or ``None``."""
    if text is None:
        return None
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


def _value_text(value: Decimal) -> str:
    """The canonical text of a value (``gedit_nc``'s own: no trailing zeros, no exponent, zero is ``'0'``)."""
    if value == _ZERO:
        return "0"
    return format(value.normalize(), "f")


class Readings:
    """What a written number is worth on one machine: ``gedit_nc.resolve_value``, asked once for
    the kind of word instead of once for each number.

    A word's value is the number as written times a factor that depends only on whether it has a
    point, its number class and the units (1 where the machine reads numbers as written, the
    increment where it counts in increments). When every preset the profile declares (or the
    machine) agrees on the factor, the value of any number is that product, so the answer is
    worked out by one multiplication; the factor is read from ``resolve_value`` itself, on a ``1``
    written the same way. Where the presets disagree (no machine chosen, readings that differ) the
    answer is ``resolve_value``'s, remembered per number. One instance is shared by the path
    tracker and ``_nc_geom``, so a number is read once whoever asks first.
    """

    #: How many numbers the slow path remembers (a program of distinct coordinates cannot grow it).
    LIMIT = 4096

    def __init__(self, machine: Dict[str, Any], profile: Dict[str, Any]) -> None:
        self.machine = machine
        self.profile = profile
        #: (has_point, class, units) -> the factor, or ``None`` when the presets differ.
        self._factors: Dict[Any, Optional[Decimal]] = {}
        self._slow: Dict[Any, Tuple[Optional[str], List[Dict[str, Any]]]] = {}

    def _factor(self, has_point: bool, cls: str, units: str) -> Optional[Decimal]:
        probe = gedit_nc.parse_number("1." if has_point else "1")
        if probe is None:  # pragma: no cover - "1" is a number
            return None
        text, readings = gedit_nc.resolve_value(probe, cls, self.machine, self.profile, units)
        if text is None or readings:
            return None
        factor = dec(text)
        return factor if factor is not None and factor > _ZERO else None

    def get(self, literal: Any, cls: Optional[str], units: str) -> Tuple[Optional[str], List[Dict[str, Any]]]:
        """``(value text, readings)`` as ``gedit_nc.resolve_value(literal, cls, machine, profile, units)`` gives them."""
        if cls is None or cls == "count":
            return None, []
        has_point = bool(getattr(literal, "has_point", False))
        key = (has_point, cls, units)
        try:
            factor = self._factors[key]
        except KeyError:
            factor = self._factors[key] = self._factor(has_point, cls, units)
        if factor is not None and isinstance(literal, gedit_nc.NumericLiteral):
            value = gedit_nc.decimal_of(literal)
            if value is not None:
                if factor != _ONE:
                    with localcontext() as context:
                        context.prec = 80
                        value = value * factor
                return _value_text(value), []
        slow_key = (getattr(literal, "raw", None), has_point, cls, units)
        found = self._slow.get(slow_key)
        if found is None:
            if len(self._slow) > self.LIMIT:
                self._slow = {}
            found = self._slow[slow_key] = gedit_nc.resolve_value(literal, cls, self.machine, self.profile, units)
        return found


def sqrt(value: Decimal) -> Decimal:
    """The square root, with digits to spare."""
    with localcontext() as context:
        context.prec = 34
        return value.sqrt()


def rounded(value: Decimal, places: int) -> Decimal:
    """``value`` rounded half away from zero to ``places`` decimals."""
    with localcontext() as context:
        context.prec = 60
        return value.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)


def distance(da: Decimal, db: Decimal) -> Decimal:
    """The length of a vector, to :data:`COMPUTED` decimals."""
    return rounded(sqrt(da * da + db * db), COMPUTED)


def angle_of(dy: Decimal, dx: Decimal) -> float:
    """The angle of a vector in degrees, ``0 <= a < 360`` (floats only decide *which* side)."""
    a = math.degrees(math.atan2(float(dy), float(dx)))
    return a + 360.0 if a < 0 else a


def polar_point(radius: Decimal, degrees: Decimal) -> Tuple[Decimal, Decimal]:
    """``(r·cos a, r·sin a)``, exact on the quarter turns and to 1e-6 elsewhere."""
    quarter = degrees / Decimal(90)
    if quarter == quarter.to_integral_value():
        k = int(quarter) % 4
        return [(radius, _ZERO), (_ZERO, radius), (-radius, _ZERO), (_ZERO, -radius)][k]
    a = math.radians(float(degrees))
    return (
        rounded(radius * Decimal(repr(math.cos(a))), COMPUTED),
        rounded(radius * Decimal(repr(math.sin(a))), COMPUTED),
    )


def within(t0: float, sweep: float, k: float) -> bool:
    """Whether the angle ``k`` lies strictly inside the sweep from ``t0``."""
    if sweep >= 0:
        d = (k - t0) % 360.0
        return 1e-9 < d < sweep - 1e-9
    d = (t0 - k) % 360.0
    return 1e-9 < d < -sweep - 1e-9


def centre_reading(interp: Any, axis: str, mode: Optional[str]) -> Optional[str]:
    """How an **absolute** arc centre along ``axis`` is read: ``'diameter'``, ``'radius'`` or
    ``None`` when not known. On a diameter axis (``addresses.diameter``) it is a diameter
    while the axis is read as one, and under ``DIAM90`` (``'absolute-only'``) always, since
    the centre is absolute (SINUMERIK 840D sl programming manual, diameter programming).
    ``mode`` is the modal state's ``diameter.mode``."""
    if mode == "absolute-only":
        return "diameter"
    reading = interp.diameter_reading(axis)
    return reading if reading in ("diameter", "radius") else None


def centre_from_radius(sa, sb, ea, eb, r: Decimal, direction: str) -> Optional[Tuple[Decimal, Decimal]]:
    """The centre of an arc given by its radius: a negative radius is the arc over 180°."""
    with localcontext() as context:
        context.prec = 34
        da, db = ea - sa, eb - sb
        d2 = da * da + db * db
        if d2 == _ZERO:
            return None
        rr = abs(r)
        h2 = rr * rr - d2 / 4
        if h2 < 0:
            half = sqrt(d2) / 2
            if half - rr > CHORD_SLACK:
                return None
            h2 = _ZERO
        h = sqrt(h2) if h2 > 0 else _ZERO
        d = sqrt(d2)
        ma, mb = sa + da / 2, sb + db / 2
        # The unit normal to the left of the chord.
        na, nb = -db / d, da / d
        left = (direction == "ccw") == (r > 0)
        sign = Decimal(1) if left else Decimal(-1)
        return (rounded(ma + sign * h * na, COMPUTED), rounded(mb + sign * h * nb, COMPUTED))


# ---------------------------------------------------------------------------
# Arc geometry
# ---------------------------------------------------------------------------


def arc_extremes(arc: Arc) -> List[Tuple[str, Decimal]]:
    """The quadrant points the arc passes, as ``(axis, coordinate)``, in the order
    ``Extents.extremes`` noted them (0°, 90°, 180°, 270° of the plane's first axis); every one
    for a full circle or a sweep of 360° or more, none for a zero radius. The caller turns
    them into column values (:meth:`PathAxes.col`)."""
    a, b = arc.plane
    ca, cb = arc.centre
    sa, sb = arc.start
    r = distance(sa - ca, sb - cb)
    if r == _ZERO:
        return []
    t0 = angle_of(sb - cb, sa - ca)
    sweep = arc.sweep
    if sweep is None:
        if arc.full:
            sweep = 360.0 if arc.direction == "ccw" else -360.0
        else:
            ea, eb = arc.end
            t1 = angle_of(eb - cb, ea - ca)
            if arc.direction == "ccw":
                sweep = (t1 - t0) % 360.0
            else:
                sweep = -((t0 - t1) % 360.0)
    points = ((0, a, ca + r), (90, b, cb + r), (180, a, ca - r), (270, b, cb - r))
    return [(axis, value) for k, axis, value in points if abs(sweep) >= 360.0 or within(t0, sweep, float(k))]


def arc_radii(arc: Arc) -> Tuple[Decimal, Decimal]:
    """The distance from the centre to the start and to the end, to :data:`COMPUTED` decimals:
    what the arc check of AD-44 compares (``_nc_geom.check_arcs``)."""
    ca, cb = arc.centre
    return (
        distance(arc.start[0] - ca, arc.start[1] - cb),
        distance(arc.end[0] - ca, arc.end[1] - cb),
    )


# ---------------------------------------------------------------------------
# Small helpers (moved from extents.py)
# ---------------------------------------------------------------------------


def as_dict(value: Any) -> Dict[str, Any]:
    """``value`` when it is a dictionary, else an empty one — profiles arrive as JSON."""
    return value if isinstance(value, dict) else {}


def upper_list(value: Any) -> List[str]:
    """A profile list of addresses, upper-cased; anything else is an empty list."""
    return [str(item).upper() for item in value if isinstance(item, str)] if isinstance(value, list) else []


#: The parameter units of a value that is no coordinate: a time, a count, a step, an angle.
NOT_A_COORDINATE = ("dwell", "count", "increment", "angle")


def values_of(entries: Sequence[Dict[str, Any]]) -> frozenset:
    """The addresses ``entries`` declare as a value that is no coordinate (``CodeParam.unit``)."""
    out = set()
    for entry in entries:
        params = entry.get("params")
        for param in params if isinstance(params, list) else []:
            if isinstance(param, dict) and param.get("unit") in NOT_A_COORDINATE and isinstance(param.get("address"), str):
                out.add(param["address"].upper())
    return frozenset(out)


def head_of(code: Any) -> str:
    """The letters a code starts with (``G`` of ``G84.2``, ``CYCL`` of ``CYCL DEF``), upper case."""
    text = str(code or "")
    end = 0
    while end < len(text) and text[end].isalpha():
        end += 1
    return text[:end].upper()


def is_word_code(code: Any) -> bool:
    """`G1`, `M30`, `G84.2`: a letter and a number, the way an ISO dialect writes a code."""
    text = str(code or "")
    head = head_of(text)
    rest = text[len(head) :]
    return head != "" and rest != "" and rest.replace(".", "", 1).isdigit()


def canonical(entry: Dict[str, Any], written: str) -> str:
    """The database's spelling of a code (``G2`` for a written ``G02``)."""
    code = entry.get("code")
    return code if isinstance(code, str) and code != "" else written


def zero(token: Any) -> bool:
    """A radius word of 0 is no radius (Klartext `R0` is a radius-compensation word)."""
    value = gedit_nc.decimal_of(token.value) if token.value is not None else None
    return value is not None and value == 0


# ---------------------------------------------------------------------------
# The profile's axes (moved from extents.Axes, unchanged; ``direction_words`` is new)
# ---------------------------------------------------------------------------


class PathAxes:
    """The profile's axes, incremental twins, rotary axes, diameter words and arc centre words.

    Members (as ``extents.Axes`` had them): ``twins`` (``gedit_nc.incremental_axes``),
    ``order`` (the axes a row can be about, twins resolved), ``known``, ``angular``,
    ``diameter_words`` (``gedit_nc.diameter_axes``), ``lathe_column`` (a turning profile whose
    ``X`` is a diameter word), ``centre_words`` (``addresses.arcCenter`` ∩ ``CENTRE_AXIS``),
    ``centre_incremental`` (``arcCenterMode`` is not ``'absolute'``) and, new,
    ``direction_words`` (``gedit_nc.arc_direction_words_of``: ``{"DR+": "ccw", "DR-": "cw"}``)
    with ``direction_addresses``, the addresses they are written with (``DR``).
    """

    def __init__(self, profile: Dict[str, Any]) -> None:
        addresses = as_dict(profile.get("addresses"))
        self.twins = gedit_nc.incremental_axes(profile)
        listed = upper_list(addresses.get("axes"))
        #: The axes a row can be about, in the profile's order. A twin moves an axis; it is
        #: not one (the Fanuc lathe lists `U`/`W` under `axes` *and* as twins).
        self.order = [axis for axis in listed if axis not in self.twins]
        for axis in self.twins.values():
            if axis not in self.order:
                self.order.append(axis)
        self.known = frozenset(self.order)
        self.angular = frozenset(upper_list(addresses.get("angular")))
        self.diameter_words = frozenset(gedit_nc.diameter_axes(profile))
        #: A turning profile shows X as a diameter; a milling one keeps the coordinate.
        self.lathe_column = gedit_nc.machine_type_of(profile) == "lathe" and "X" in self.diameter_words
        centre = upper_list(addresses.get("arcCenter"))
        self.centre_words = frozenset(word for word in centre if word in CENTRE_AXIS)
        self.centre_incremental = addresses.get("arcCenterMode") != "absolute"
        #: The arc direction written as a word (§6.2), and the addresses those words use.
        self.direction_words = gedit_nc.arc_direction_words_of(profile)
        self.direction_addresses = tuple(sorted({word[:-1] for word in self.direction_words}))

    def axis_of(self, address: str) -> Optional[str]:
        """The axis a word moves, or ``None`` for a word that is no axis."""
        if address in self.twins:
            return self.twins[address]
        return address if address in self.known else None

    def label(self, axis: str) -> str:
        """``'X (diameter)'`` for a diameter column, else the axis."""
        return "X (diameter)" if axis == "X" and self.lathe_column else axis

    def geo(self, axis: str, value: Decimal) -> Decimal:
        """A column value as a coordinate: a diameter column holds twice the radius."""
        return value / _TWO if axis == "X" and self.lathe_column else value

    def col(self, axis: str, value: Decimal) -> Decimal:
        """A coordinate as a column value."""
        return value * _TWO if axis == "X" and self.lathe_column else value


# ---------------------------------------------------------------------------
# The tracker
# ---------------------------------------------------------------------------


class _Written:
    """The codes one line writes, as the interpreter reads them (§7.4)."""

    __slots__ = ("entries", "words", "calls", "ids")

    def __init__(self) -> None:
        #: (database entry, canonical code, token kind)
        self.entries: List[Tuple[Dict[str, Any], str, str]] = []
        #: The ``id`` of every token that is one of ``entries`` (its code, not a value).
        self.ids: Set[int] = set()
        #: unknown word codes under the database's motion letter (`G123`)
        self.words: List[str] = []
        self.calls: List[Any] = []


# ---------------------------------------------------------------------------
# The flow of the program (P4a fix B1, NC-5, NC-9, NC-11; plan §7 #312, #313, #315)
# ---------------------------------------------------------------------------


class _Snap(NamedTuple):
    """Where the tool is and what is in force at one point of the walk."""

    line: int
    pos: Dict[str, Optional[Decimal]]
    pole: Dict[str, Decimal]
    fp: Any
    unsure: FrozenSet[str]
    unwritten: FrozenSet[str]
    #: T011: the tracker's ``levels`` there.
    levels: FrozenSet[str] = _NO_AXES


def _split_args(text: str) -> List[str]:
    """The arguments of a call as written (``_nc_geom._split_arguments`` without the spans)."""
    out: List[str] = []
    depth = 0
    quoted = False
    start = 0
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
            out.append(text[start:i].strip())
            start = i + 1
    out.append(text[start:].strip())
    return out


def empty_levels(token: Any, entry: Dict[str, Any]) -> List[str]:
    """v1.2.0 (NCR-9b): the parameters on the tool axis (``CodeParam.position: 'tool-axis'``) of
    a cycle written as a call (``CYCLE81(,0,2,-10)``) that are left empty or left out, upper case.
    The control reads such a parameter as 0, a level nobody wrote. One whose twin
    (``CodeParam.twin``, the same depth the other way: ``DP`` and ``DPR``) is written is not
    empty: the cycle takes the depth from the twin."""
    params = [p for p in (entry.get("params") or []) if isinstance(p, dict)]
    if not any(gedit_nc.position_of(p) == "tool-axis" for p in params):
        return []
    text = getattr(token, "value_text", None) or ""
    args = _split_args(text) if "(" in (getattr(token, "text", None) or "") else []
    written: Dict[str, bool] = {}
    for i, param in enumerate(params):
        address = str(param.get("address") or "").upper()
        if address:
            written[address] = i < len(args) and args[i].strip() != ""
    out: List[str] = []
    for param in params:
        if gedit_nc.position_of(param) != "tool-axis":
            continue
        address = str(param.get("address") or "").upper()
        twin = param.get("twin")
        if written.get(address) or (isinstance(twin, str) and written.get(twin.upper())):
            continue
        out.append(address)
    return out


def writes_tool_offset(entry: Dict[str, Any], tokens: Sequence[Any], codes: Any) -> bool:
    """v1.2 NC fix round (T013, NCR-10): the block of a shift code writes a tool offset, no
    coordinate system: a parameter with ``toolOffsetValues`` (Fanuc ``G10``'s ``L``) is written
    there as a plain number equal to one of them (``G10 L11 P1 R0.1``). A variable, another value
    or the parameter left out keeps the reading of ``shift``. ``codes``: the ``id`` of every token
    of the block that is a code (they are no values). The tracker and ``_nc_geom`` both ask it."""
    for param in entry.get("params") or []:
        if not isinstance(param, dict):
            continue
        values = param.get("toolOffsetValues")
        address = param.get("address")
        if not isinstance(values, list) or not isinstance(address, str):
            continue
        wanted = {Decimal(v) for v in values if isinstance(v, str) and v.isdigit()}
        written = [
            t
            for t in tokens
            if t.kind == "word"
            and id(t) not in codes
            and (t.address or "").upper() == address.upper()
            and (t.value_text or "")
        ]
        if len(written) != 1 or written[0].value is None:
            return False
        number = gedit_nc.decimal_of(written[0].value)
        return number is not None and number in wanted
    return False


def _assigned_numbers(tokens: Sequence[Any], names: FrozenSet[str]) -> Set[str]:
    """The parameters of ``names`` a line assigns a plain number (Klartext ``Q203=+0``)."""
    out: Set[str] = set()
    count = len(tokens)
    for i, token in enumerate(tokens):
        if token.kind != "variable" or token.text.strip().upper() not in names:
            continue
        j = i + 1
        while j < count and tokens[j].kind == "whitespace":
            j += 1
        if j >= count or tokens[j].kind != "operator" or tokens[j].text.strip() != "=":
            continue
        values = []
        for t in tokens[j + 1 :]:
            if t.kind in ("comment", "continuation"):
                break
            if t.kind != "whitespace":
                values.append(t)
        if len(values) == 1 and values[0].kind == "word" and values[0].address is None and values[0].value is not None:
            out.add(token.text.strip().upper())
    return out


def _written_zero(text: str) -> bool:
    try:
        return Decimal(text.strip()) == _ZERO
    except (InvalidOperation, ValueError):
        return False


def _number_name(text: Optional[str]) -> Optional[str]:
    """``'N100'`` for a block number or a jump target written as digits (``0100`` too)."""
    digits = (text or "").strip()
    return "N%d" % int(digits) if digits.isdigit() else None


class _Flow:
    """What the straight walk of :class:`PathTracker` does not see (plan §7 #312, #313, #315).

    The tracker walks the lines in written order. A jump, a loop or a block the operator may
    skip (``/``) makes the control run them in another order; a frame code may turn the rotary
    axes to angles the program never writes. This reads the flow codes from data
    (``CodeEntry.flow``, ``positionsRotary``), never from a list of names, and keeps, beside the
    tracker's positions and without changing them (so the extents stay byte for byte, AD-48):

    * ``unsure``: the axes (and ``'pole'``) whose position is not known although the straight
      walk has one. At a jump target the positions the jump brings are compared with those of
      the straight run; an axis where they differ is not known until a block writes it
      absolutely. The same after a loop's end (the loop may run any number of times), after a
      block that may be skipped (the axes it moves), and for the rotary axes after a code that
      turns them.
    * ``unwritten``: the axes the program has not written yet (NC-9).
    * the events of :data:`FLOW_EVENTS`: a jump target or a loop end reached with another modal
      state than the straight run (``'modal'``), the blocks of a loop or of a backward jump that
      run again from another position (``'reentry'``), a jump whose target cannot be followed
      (``'target'``).

    Block numbers are labels too (Fanuc ``GOTO 100`` continues at ``N100``); they are kept in
    two compact arrays, only on a database that has a jump code, so a backward jump can find
    its target.
    """

    def __init__(self, tracker: "PathTracker") -> None:
        self.t = tracker
        heads: Set[str] = set()
        label_heads: Set[str] = set()
        jumps = False
        rotary_codes = False
        for entry in tracker.codes:
            if not isinstance(entry, dict):
                continue
            flow = entry.get("flow")
            code = str(entry.get("code") or "").strip().upper()
            head = code.split(" ")[0] if code else ""
            if flow in FLOWS and head:
                heads.add(head)
                if flow == "label":
                    label_heads.add(head)
                if flow in ("jump", "repeat"):
                    jumps = True
            if entry.get("positionsRotary") is True:
                rotary_codes = True
        #: The keyword heads of the flow codes (``GOTO``, ``FN``, ``LBL``, ``WHILE``).
        self.heads = frozenset(heads)
        self.label_heads = frozenset(label_heads)
        self.jumps = jumps
        self.rotary_codes = rotary_codes
        axes = tracker.axes
        self.rotary = tuple(a for a in axes.order if a in axes.angular)
        self.reset()

    def reset(self) -> None:
        """A program starts: no jump reaches across it."""
        self.pending: Dict[str, List[_Snap]] = {}
        self.labels: Dict[str, _Snap] = {}
        self.stack: List[Tuple[str, _Snap]] = []
        self.numbers = array("q")
        self.number_lines = array("l")
        #: (line, fingerprint) whenever the fingerprint changed, for a backward jump to a block number.
        self.fps: List[Tuple[int, Any]] = []
        self.unsure: FrozenSet[str] = _NO_AXES
        self.unwritten: FrozenSet[str] = frozenset(self.t.axes.order)
        #: A label or a loop has been seen: `_nc_geom` keeps which blocks needed a start point.
        self.recording = False
        self._events: List[FlowEvent] = []
        self._skip: Optional[_Snap] = None
        #: T010: the entries of the earlier lines of a block that goes on (`~`).
        self._carry: List[Tuple[Dict[str, Any], str, str]] = []

    # -- helpers ----------------------------------------------------------------

    def fp(self) -> Any:
        return self.t.interp.fingerprint()

    def snap(self, line: int, fp: Any, unsure: FrozenSet[str], unwritten: FrozenSet[str]) -> _Snap:
        return _Snap(line, dict(self.t.pos), dict(self.t.pole), fp, unsure, unwritten, self.t.levels)

    def differ(self, a: _Snap, pos: Dict[str, Optional[Decimal]], pole: Dict[str, Decimal], unsure: FrozenSet[str]) -> Set[str]:
        """The axes (and ``'pole'``) not known where two ways meet."""
        out = set(a.unsure) | set(unsure)
        for axis in self.t.axes.order:
            if a.pos.get(axis) != pos.get(axis):
                out.add(axis)
        if a.pole != pole:
            out.add("pole")
        return out

    def merge_levels(self, a: _Snap) -> None:
        """T011: where two ways meet, an axis stands at a level the program wrote only when it
        does on both (or is known on the other)."""
        t = self.t
        if t.levels:
            t.levels = frozenset(x for x in t.levels if a.pos.get(x) is not None or x in a.levels)

    def everything(self) -> Set[str]:
        return set(self.t.axes.order) | {"pole"}

    def fp_before(self, line: int) -> Any:
        """The fingerprint in force before ``line`` (from the log of changes)."""
        found = None
        for at, fp in self.fps:
            if at >= line:
                break
            found = fp
        return found

    def number_line(self, name: str) -> Optional[int]:
        """The last line before this one that has the block number ``name`` (``N100``)."""
        try:
            wanted = int(name[1:])
        except ValueError:
            return None
        numbers = self.numbers
        for i in range(len(numbers) - 1, -1, -1):
            if numbers[i] == wanted:
                return self.number_lines[i]
        return None

    @staticmethod
    def significant(tokens: Sequence[Any]) -> List[Any]:
        return [t for t in tokens if t.kind not in ("whitespace", "comment", "continuation")]

    def defined(self, tokens: Sequence[Any]) -> List[str]:
        """The labels a line defines: its block number, a label at its head (not one a jump
        names), a label code at its head (Klartext ``LBL 1``)."""
        out: List[str] = []
        seen_code = False
        sig = self.significant(tokens)
        for i, token in enumerate(sig):
            kind = token.kind
            if kind == "skip":
                continue
            if kind == "blockNumber":
                name = _number_name(token.value_text)
                if name is not None:
                    out.append(name)
                continue
            if kind == "label" and not seen_code:
                name = token.text.strip().rstrip(":").strip().upper()
                if name:
                    out.append(name)
                continue
            if kind == "keyword" and (token.address or "").upper() in self.label_heads and not seen_code:
                nxt = sig[i + 1] if i + 1 < len(sig) else None
                if nxt is not None and nxt.text.strip() not in ("", "0"):
                    out.append("%s %s" % ((token.address or "").upper(), nxt.text.strip().upper()))
            break
        return out

    def targets(self, tokens: Sequence[Any]) -> List[str]:
        """The labels a jump block names, behind its first flow code."""
        out: List[str] = []
        sig = self.significant(tokens)
        started = False
        i = 0
        while i < len(sig):
            token = sig[i]
            address = (token.address or "").upper()
            if not started:
                if token.kind == "keyword" and address in self.heads and address not in self.label_heads:
                    started = True
                    name = _number_name(token.value_text)
                    if name is not None:
                        out.append(name)
                i += 1
                continue
            if token.kind == "label":
                name = token.text.strip().rstrip(":").strip().upper()
                if name:
                    out.append(name)
            elif token.kind == "blockNumber":
                name = _number_name(token.value_text)
                if name is not None:
                    out.append(name)
            elif token.kind == "keyword" and address in self.label_heads:
                nxt = sig[i + 1] if i + 1 < len(sig) else None
                if nxt is not None:
                    out.append("%s %s" % (address, nxt.text.strip().upper()))
                    i += 1
            elif token.kind == "keyword" and address in self.heads:
                name = _number_name(token.value_text)
                if name is not None:
                    out.append(name)
            i += 1
        return out

    def repeat_target(self, tokens: Sequence[Any]) -> Optional[str]:
        """The label a section repeat names (``REPEAT MARK1 P=2``), or ``None`` (a loop start)."""
        sig = self.significant(tokens)
        for i, token in enumerate(sig):
            if token.kind == "keyword" and (token.address or "").upper() in self.heads:
                nxt = sig[i + 1] if i + 1 < len(sig) else None
                if nxt is not None and nxt.kind in ("label", "unknown") or (
                    nxt is not None and nxt.kind == "word" and nxt.address and not (nxt.value_text or "")
                ):
                    return nxt.text.strip().rstrip(":").strip().upper()
                return None
        return None

    def turns_rotary(self, step: "Step", block: Sequence[Tuple[Dict[str, Any], str, str]] = ()) -> bool:
        """A code of the block turns the rotary axes (``positionsRotary``; a ``keepsRotary``
        parameter written as 0, or a call without arguments, keeps them still).

        v1.2.0 (T010): nor does one whose block leaves the plane untilted. When the block
        (``block``: the entries of its lines written so far, a Klartext ``~`` block over
        several lines included) writes a frame code of the same group and no frame of that
        group is open after it — ``PLANE RESET``, or a ``PLANE SPATIAL`` / ``PROJECTED`` /
        ``EULER`` whose angles (``frameZeroWords``) are all written as 0 — the angles at zero
        turn no rotary axis: they keep what the program wrote, and an axis already not known
        stays so. An angle that is not a plain 0 (``SPB+Q5``) leaves the frame open and turns
        them, as before; ``STAY`` never turns them."""
        for entry, code, kind in step.entries:
            if entry.get("positionsRotary") is not True:
                continue
            if self.untilted(entry, code, block or step.entries):
                continue
            params = entry.get("params") if isinstance(entry.get("params"), list) else []
            keep = [i for i, p in enumerate(params) if isinstance(p, dict) and p.get("keepsRotary") is True]
            if not keep:
                return True
            token = next((t for t in step.tokens if t.kind == "call" and canonical(self.t.interp.entry(t.address or "") or {}, t.address or "") == code), None)
            if token is None:
                continue  # written without its arguments: a reset (`CYCLE800` alone)
            args = _split_args(token.value_text or "")
            if all(a == "" for a in args):
                continue  # `CYCLE800()`
            if any(i < len(args) and _written_zero(args[i]) for i in keep):
                continue
            return True
        return False

    def untilted(self, entry: Dict[str, Any], code: str, block: Sequence[Tuple[Dict[str, Any], str, str]]) -> bool:
        """T010: ``block`` writes a frame code of ``entry``'s group (other than ``code``) and no
        frame of that group is open after it (the interpreter's reading, rule 13)."""
        group = entry.get("group")
        if not isinstance(group, str) or not group:
            return False
        if not any(c != code and e.get("group") == group and gedit_nc.frame_of(e) in ("open", "close") for e, c, _ in block):
            return False
        interp = self.t.interp
        for frame in interp.open_frames:
            opened = interp.entry(str(frame.get("code") or ""))
            if opened is None or opened.get("group") == group:
                return False
        return True

    # -- one line ---------------------------------------------------------------

    def before(self, tokens: Sequence[Any], line: int) -> None:
        """Before the interpreter reads the line: the labels it defines (a jump that comes here
        meets the straight run), and a skip mark (what the block changes may not happen)."""
        self._events = []
        self._skip = None
        names = self.defined(tokens)
        skip = any(t.kind == "skip" for t in tokens)
        named = [n for n in names if not n.startswith("N") or not n[1:].isdigit()]
        if not (named or skip or (self.pending and names)):
            if self.jumps:
                for name in names:
                    self.numbers.append(int(name[1:]))
                    self.number_lines.append(line)
            return
        fp = self.fp()
        unsure = self.unsure
        unwritten = self.unwritten
        t = self.t
        for name in names:
            for jump in self.pending.pop(name, []):
                diff = self.differ(jump, t.pos, t.pole, unsure)
                unsure = unsure | frozenset(diff)
                self.merge_levels(jump)
                unwritten = unwritten | jump.unwritten
                if jump.fp != fp:
                    self._events.append(FlowEvent("modal", jump.line, (), name))
            if name in named:
                self.labels[name] = _Snap(line, dict(t.pos), dict(t.pole), fp, unsure, unwritten, t.levels)
                self.recording = True
            elif self.jumps:
                self.numbers.append(int(name[1:]))
                self.number_lines.append(line)
        if skip:
            self._skip = _Snap(line, dict(t.pos), dict(t.pole), fp, unsure, unwritten, t.levels)
        self.unsure = unsure
        self.unwritten = unwritten

    def after(self, step: "Step", tokens: Sequence[Any], line: int) -> None:
        """After the block: what it wrote, and the flow codes it carries."""
        t = self.t
        step.unsure = self.unsure
        step.unwritten = self.unwritten
        events = self._events
        unsure = set(self.unsure)
        unwritten = set(self.unwritten)
        for read in step.reads if step.kind in ("move", "frame") else ():
            # Written: any word but an increment from a start nobody knows (that one leaves
            # the axis where nobody knows, as before it).
            if not (read.incremental is True and read.value is None):
                unwritten.discard(read.axis)
            if read.incremental is False and read.value is not None:
                unsure.discard(read.axis)
                if read.axis in self.rotary:
                    # The program writes its rotary axes back: one it has never written is
                    # taken for one this machine does not have (a B/C table never writes A).
                    unsure.difference_update(a for a in self.rotary if a in unwritten)
        if step.kind == "machine":
            for axis, _ in step.moves:
                unwritten.add(axis)
        polar = step.polar
        if polar is not None:
            # A move about the pole: known when the pole is, and when it does not build on the
            # polar point before it (an increment, a word left out) while that one was not.
            words = (step.words.get(POLAR_ANGLE), step.words.get(POLAR_RADIUS))
            builds = any(tok is None or tok.incremental for tok in words)
            keep = "pole" in unsure or (builds and bool(set(polar.plane) & self.unsure))
            for axis in polar.plane:
                if keep:
                    unsure.add(axis)
                else:
                    unsure.discard(axis)
                    unwritten.discard(axis)
        if step.kind == "pole":
            absolute = {r.axis for r in step.reads if r.incremental is False and r.value is not None}
            if len(absolute) >= 2:
                unsure.discard("pole")
            elif unsure & set(t.axes.order):
                unsure.add("pole")
            else:
                unsure.discard("pole")
        block = self._carry + list(step.entries) if self._carry else step.entries
        if self.rotary_codes and self.rotary and self.turns_rotary(step, block):
            unsure |= set(self.rotary)
        # The entries of a block written over several lines (Klartext `~`), for its next line.
        self._carry = list(block) if any(t.kind == "continuation" for t in tokens) else []
        if self._skip is not None:
            skipped = self._skip
            unsure |= self.differ(skipped, t.pos, t.pole, frozenset())
            self.merge_levels(skipped)
            unwritten |= skipped.unwritten
            if skipped.fp != self.fp():
                events.append(FlowEvent("modal", line, (), "/"))
        flows = [e.get("flow") for e, _, _ in step.entries if e.get("flow") in FLOWS]
        if flows:
            self.recording = True
            self.flow_codes(step, tokens, line, flows, events, unsure, unwritten)
        if self.jumps and step.entries:
            fp = self.fp()
            if not self.fps or self.fps[-1][1] != fp:
                self.fps.append((line, fp))
        if unsure != self.unsure:
            self.unsure = frozenset(unsure)
        if unwritten != self.unwritten:
            self.unwritten = frozenset(unwritten)
        step.flow = tuple(events)

    def flow_codes(self, step: "Step", tokens: Sequence[Any], line: int, flows: List[str], events: List[FlowEvent], unsure: Set[str], unwritten: Set[str]) -> None:
        t = self.t
        fp = self.fp()

        def now() -> _Snap:
            return _Snap(line, dict(t.pos), dict(t.pole), fp, frozenset(unsure), frozenset(unwritten), t.levels)

        def back(to: _Snap, name: str, start: int) -> None:
            diff = self.differ(to, t.pos, t.pole, frozenset(unsure))
            events.append(FlowEvent("reentry", start, tuple(sorted(diff)), name))
            if to.fp != fp:
                events.append(FlowEvent("modal", to.line, (), name))
            unsure.update(diff)
            self.merge_levels(to)

        written = " ".join(tok.text.strip() for tok in self.significant(tokens))[:40]
        if "jump" in flows:
            targets = self.targets(tokens)
            if not targets:
                events.append(FlowEvent("target", 0, (), written))
                return
            here = now()
            for name in targets:
                self.pending.setdefault(name, []).append(here)
                label = self.labels.get(name)
                if label is not None:
                    back(label, name, label.line)
                elif name.startswith("N") and name[1:].isdigit():
                    at = self.number_line(name)
                    if at is not None:
                        everything = self.everything()
                        events.append(FlowEvent("reentry", at, tuple(sorted(everything)), name))
                        if self.fp_before(at) != fp:
                            events.append(FlowEvent("modal", at, (), name))
                        unsure.update(everything)
                        t.levels = _NO_AXES
            return
        for flow in flows:
            if flow == "branch":
                self.stack.append(("branch", now()))
            elif flow == "else":
                if not self.stack or self.stack[-1][0] != "branch":
                    events.append(FlowEvent("target", 0, (), written))
                    continue
                _, opened = self.stack.pop()
                end = now()
                unsure.update(self.differ(opened, t.pos, t.pole, frozenset(unsure)))
                unwritten.update(opened.unwritten)
                self.merge_levels(opened)
                if opened.fp != fp:
                    events.append(FlowEvent("modal", opened.line, (), written))
                self.stack.append(("else", end))
            elif flow == "branch-end":
                if not self.stack or self.stack[-1][0] not in ("branch", "else"):
                    events.append(FlowEvent("target", 0, (), written))
                    continue
                _, opened = self.stack.pop()
                unsure.update(self.differ(opened, t.pos, t.pole, frozenset(unsure)))
                unwritten.update(opened.unwritten)
                self.merge_levels(opened)
                if opened.fp != fp:
                    events.append(FlowEvent("modal", opened.line, (), written))
            elif flow == "loop":
                self.stack.append(("loop", now()))
            elif flow == "repeat":
                name = self.repeat_target(tokens)
                if name is None:
                    self.stack.append(("loop", now()))
                    continue
                label = self.labels.get(name)
                if label is None:
                    events.append(FlowEvent("target", 0, (), name))
                    continue
                back(label, name, label.line)
            elif flow == "loop-end":
                if not self.stack or self.stack[-1][0] != "loop":
                    events.append(FlowEvent("target", 0, (), written))
                    continue
                _, opened = self.stack.pop()
                back(opened, written, opened.line + 1)
                unwritten.update(opened.unwritten)


class PathTracker:
    """Walks a program line by line and knows where the tool is (plan §6.1).

    Public members after construction (read them, do not set them, except where noted):
    ``profile``, ``cp``, ``codes``, ``interp`` (the ``gedit_nc.ModalInterpreter`` the tracker
    feeds; a caller reads its state, e.g. the diameter mode before the first recorded line),
    ``machine`` (``gedit_nc.machine_params``), ``axes`` (:class:`PathAxes`), ``pos`` (axis →
    column value or ``None``), ``pole``, ``last_polar``, ``report_units``,
    ``units_switched``, ``called`` (``"O2 (line 14)"`` inside a program after the first),
    ``unstated`` (the axes that program has not stated yet).

    The rules are the ones ``Extents.block`` applied before P4.1, moved, not changed (AD-48);
    the one reading that changed is an ``AR=`` arc with no end point (plan §7 #294).
    """

    def __init__(self, context: Dict[str, Any], cp: Any, reach: bool = True, flow: bool = True) -> None:
        #: ``reach=False``: no :class:`Reach` events (what the extents list; a transform does not read
        #: them). ``flow=False``: no :class:`_Flow` bookkeeping (``unsure``, ``unwritten``, ``flow``
        #: stay at their defaults; a walk that only reads the arcs and the positions does not need it).
        self._reach_on = reach
        self._flow_on = flow
        self.profile = as_dict(context.get("profile"))
        self.cp = cp
        self.codes = context.get("codes") if isinstance(context.get("codes"), list) else []
        self.interp = gedit_nc.ModalInterpreter(cp, self.codes)
        self.machine = gedit_nc.machine_params(context)
        self.axes = PathAxes(self.profile)
        #: The context the tracker was made for (``_nc_geom`` shares ``readings`` with a caller of the same context).
        self.context = context
        #: Caches for the two questions every word asks (`value`).
        self._classes: Dict[Any, Optional[str]] = {}
        self.readings = Readings(self.machine, self.profile)
        #: The address letters the database writes its motion codes with (`G`): a word under
        #: one of them that the database lacks may be a machine position (R3) or a frame.
        self.code_heads = frozenset(
            head_of(e.get("code"))
            for e in self.codes
            if isinstance(e, dict) and e.get("group") == "motion" and is_word_code(e.get("code"))
        )
        #: The letters any code of the database starts with: only a word under one of them
        #: can be a code, which spares a lookup for every axis word.
        self.all_heads = frozenset(head_of(e.get("code")) for e in self.codes if isinstance(e, dict))
        for e in self.codes:
            for alias in (e.get("aliases") or []) if isinstance(e, dict) else []:
                self.all_heads = self.all_heads | {head_of(alias)}
        #: The position of every axis, in column values, or `None` while it is not known.
        self.pos: Dict[str, Optional[Decimal]] = {axis: None for axis in self.axes.order}
        #: The pole (Klartext `CC`), by axis, and the last polar radius and angle about it.
        self.pole: Dict[str, Decimal] = {}
        self.last_polar: Optional[Tuple[Decimal, Decimal]] = None
        self.report_units: Optional[str] = None
        self.units_switched = False
        #: M13 review (NC-4): the program after the first one the walk is in (`O2 (line 14)`),
        #: and the axes it has not stated yet: it starts where its caller left the tool.
        self.called: Optional[str] = None
        self.unstated: set = set()
        #: The arc direction of a motion code, by its canonical code (`arc_direction_of`).
        self._directions: Dict[Any, Optional[str]] = {}
        self._step: Step = Step(0)
        #: The positions after the line before, while nothing has changed them since.
        self._last: Optional[Dict[str, Optional[Decimal]]] = None
        #: P4a fix B1 (NC-4): the line that set the pole (0: none yet).
        self.pole_line = 0
        #: P4a fix B1 (NC-4, NC-5): the first recorded line, where the scope starts (a
        #: selection's first line); ``None`` until one is walked.
        self.first_recorded: Optional[int] = None
        #: T011 (NC-18): the axes not known that stand at a level the program wrote (`Step.levels`).
        self.levels: FrozenSet[str] = _NO_AXES
        #: v1.2.0 (NCF-C): the values the single passes share while they are in force (the
        #: control keeps them until a block writes them again, a one-shot code other than a
        #: dwell or a plane code clears them): the length written for each length parameter of a
        #: pass (`CodeParam.lengthAlong`, the taper `R`) as ``(value, word, why not known,
        #: readings)``, the value a coordinate in ``report_units`` or ``None`` with the kind of
        #: :data:`UNKNOWN_KINDS` that says why; and the end point of the passes per axis, as a
        #: column value, while no other move has written that axis since.
        self.pass_lengths: Dict[str, Tuple[Optional[Decimal], str, Optional[str], Any]] = {}
        self.pass_end: Dict[str, Decimal] = {}
        #: v1.2.0 (NCR-2): why the values the single passes share are not known, or ``None``:
        #: after :meth:`forget_all` (a program after the first, a macro or data block that may
        #: set anything) and after a subprogram call, a taper the passes run with is not known
        #: (an empty :attr:`pass_lengths` reads as "no taper"). A block that writes the taper,
        #: or a code that clears the pass values, makes it known again (:meth:`pass_taper`).
        self.pass_unknown: Optional[str] = None
        #: v1.2.0 (NCR-9): whether the levels on the tool axis of a cycle with parameters were
        #: written as numbers where it was defined or called with them, by the cycle's code
        #: (:func:`empty_levels`; a Klartext definition's Q parameters on the lines of its
        #: block). Read by the T011 levels: an empty level is 0, no level the program wrote.
        self.cycle_levels: Dict[str, bool] = {}
        #: The Klartext definition whose parameter lines are being read: (code, the tool-axis
        #: parameters it has, the ones written as a plain number so far).
        self._open_define: Optional[Tuple[str, FrozenSet[str], Set[str]]] = None
        #: P4a fix B1 (NC-5, NC-9, NC-11): what the straight walk does not see (:class:`_Flow`).
        self.flow = _Flow(self)

    # -- one line -------------------------------------------------------------

    def line(self, text: str, number: int, state: Optional[Any], record: bool) -> Tuple[Optional[Any], Step]:
        """Tokenizes ``text`` (line ``number``, 1-based) with the tokenizer ``state`` carried
        from the line before, feeds the interpreter, moves the path, and returns the new
        tokenizer state and the :class:`Step`. ``record`` is ``False`` for priming lines: the
        path moves, ``report_units`` is not fixed by them (``Extents`` semantics)."""
        cp = self.cp
        step = Step(number)
        self._step = step
        if record and self.first_recorded is None:
            self.first_recorded = number
        tokens, state = gedit_nc.tokenize_line(text, cp, state)
        masked = gedit_nc.mask_comments(text, cp)
        start = gedit_nc.program_start_of(text, cp)
        if start is not None and self.interp.program_start(number):
            # M13 review (NC-4): a program after the first (a subprogram behind `M30`) runs
            # with the tool and from the position its caller left, which the file does not
            # say: no axis is known until it states it.
            self.forget_all("%s (line %d)" % (start, number))
            self.called = "%s (line %d)" % (start, number)
            self.unstated = set(self.axes.order)
            self.flow.reset()
        flow = self.flow if self._flow_on else None
        if flow is not None:
            flow.before(tokens, number)
        self.interp.update(tokens, number, masked)
        step.tokens = tokens
        step.masked = masked
        # A line that writes nothing shares the positions of the line before: a long
        # program copies them only where they can change. (`pole` is replaced, never changed.)
        before = self._last if self._last is not None else dict(self.pos)
        step.before = before
        step.levels = self.levels
        step.after = dict(self.pos) if self._block(step, tokens, number, record) else before
        step.pole = self.pole
        step.pole_line = self.pole_line
        self._last = step.after
        if flow is not None:
            flow.after(step, tokens, number)
        return state, step

    # -- events ---------------------------------------------------------------

    def _miss(self, axes: Sequence[str], kind: str, detail: str = "", key: str = "", **extra: Any) -> None:
        """One thing that left a position of each of ``axes`` not known: one :class:`Unknown`."""
        step = self._step
        known = self.axes.known
        step.events.append(Unknown(kind, tuple(a for a in axes if a in known), step.line, detail, key, extra or None))

    def _reach(self, axis: str, value: Decimal) -> None:
        if self._reach_on:
            step = self._step
            step.events.append(Reach(axis, value, step.line))

    # -- the codes a line writes ----------------------------------------------

    def _written(self, tokens: Sequence[Any]) -> _Written:
        """The database entries of the codes a line writes (the interpreter's reading)."""
        out = _Written()
        interp = self.interp
        count = len(tokens)
        for i, token in enumerate(tokens):
            kind = token.kind
            if kind == "word":
                address = (token.address or "").upper()
                if address == "" or gedit_nc.is_assignment(token):
                    continue
                if address not in self.all_heads:
                    continue  # no code of the database starts with this letter (`X`, `Y`)
                code = address + (token.value_text or "")
                entry = interp.entry(code)
                if entry is not None:
                    out.entries.append((entry, canonical(entry, code), kind))
                    out.ids.add(id(token))
                elif address in self.code_heads and token.value is not None:
                    out.words.append(token.text)
            elif kind == "call":
                entry = interp.entry(token.address or "")
                out.calls.append(token)
                if entry is not None:
                    out.entries.append((entry, canonical(entry, token.address or ""), kind))
                    out.ids.add(id(token))
            elif kind == "keyword":
                name = token.address or token.text
                number = token.value_text
                if number is None:
                    nxt = next((t for t in tokens[i + 1 : count] if t.kind != "whitespace"), None)
                    if nxt is not None and nxt.address is None and nxt.value_text is not None:
                        number = nxt.value_text
                entry = None
                if number is not None:
                    entry = interp.entry("%s %s" % (name, number))
                    whole, dot, part = number.partition(".")
                    if entry is None and dot == "." and whole.isdigit():
                        entry = interp.entry("%s %s" % (name, whole))
                if entry is None:
                    entry = interp.entry(name)
                if entry is not None:
                    out.entries.append((entry, canonical(entry, name), kind))
                    out.ids.add(id(token))
        return out

    # -- one block --------------------------------------------------------------

    def _block(self, step: Step, tokens: Sequence[Any], line: int, record: bool) -> bool:
        """Moves the path by one block; ``False`` when the block writes nothing that can."""
        interp = self.interp
        written = self._written(tokens)
        step.entries = written.entries
        step.unknown_codes = written.words
        step.calls = written.calls
        entries = [e for e, _, _ in written.entries]
        axes = self.axes

        # The words that move an axis, in written order.
        moves: List[Tuple[str, Any]] = []
        words: Dict[str, Any] = {}
        for token in tokens:
            if token.kind != "word" or not token.address:
                continue
            address = token.address.upper()
            if token.index is not None:
                continue
            words[address] = token
            axis = axes.axis_of(address)
            if axis is not None and (token.value_text or "") != "":
                moves.append((axis, token))
        step.moves = moves
        step.words = words
        self._read_levels(written, tokens)

        if not moves and not written.calls and not entries and not self.pass_written(words):
            return False
        held = self.levels
        if held and moves:
            # A word written for an axis puts it somewhere else (an increment from the level
            # keeps it on one, below).
            self.levels = held - {axis for axis, _ in moves}
        state = interp.state
        units = state["units"]["value"]
        step.units = units if units in ("mm", "inch") else None
        self.clear_passes(entries, moves)
        call = next((c for e, c, _ in written.entries if e.get("call") is True or any(isinstance(p, dict) and p.get("programNumber") for p in e.get("params") or [])), None)
        if call is not None:
            # v1.2.0 (NCR-2): a subprogram may write the taper the passes share.
            self.pass_unknown = "%s (line %d)" % (call, line)
        if units in ("mm", "inch") and self.report_units is None and record:
            self.report_units = units
        elif units in ("mm", "inch") and record and units != self.report_units:
            self.units_switched = True

        flags = [(gedit_nc.axis_words_of(e), e, code) for e, code, _ in written.entries]
        machine = next(((e, c) for f, e, c in flags if f == "machine"), None)
        multipass = next(
            ((e, c) for f, e, c in flags if f == "data" and as_dict(e.get("sets")).get("cycle") == "start"),
            None,
        )
        data = [(e, c) for f, e, c in flags if f == "data"]
        plane = state["plane"]

        if machine is not None:
            # A machine position: the axes it moved are no longer known (the extents list
            # its words in rows of their own, from `Step.moves` and `value`).
            step.kind = "machine"
            step.reads = self._plain_reads(moves, units, entries, state)
            for axis, _ in moves:
                self.pos[axis] = None
            self.last_polar = None
            return True
        if multipass is not None:
            step.kind = "multi-pass"
            step.reads = self._plain_reads(moves, units, entries, state)
            self._miss(self.plane_axes(plane), "multi-pass", multipass[1], key=multipass[1])
            return True
        if data:
            pole = next(((e, c) for e, c in data if e.get("pole") == "set"), None)
            step.reads = self._plain_reads(moves, units, entries, state)
            if pole is not None:
                step.kind = "pole"
                self._set_pole(moves, units, entries, plane)
                return True
            step.kind = "data"
            if moves:
                self._miss((), "data", data[0][1], key=data[0][1])
            # A shift, a coordinate set or a macro call: where the tool stands in the new
            # coordinates is not something the tracker computes. A word the code declares as a
            # value of another kind (a dwell's `X`, `unit: 'dwell'`) moves nothing.
            values = values_of([e for e, _ in data])
            for axis, token in moves:
                if token.address.upper() not in values:
                    self.pos[axis] = None
            # v1.2.0 (NCR-10): a block that writes a tool offset (`G10 L11 P1 R0.1`: its `L` one of
            # the code's `toolOffsetValues`) sets no coordinate system and moves nothing.
            forget = next(
                (c for e, c in data if e.get("wordsAreData") is True and not writes_tool_offset(e, tokens, written.ids)),
                None,
            )
            if forget is not None:
                self.forget_all("%s (line %d)" % (forget, line))
            return True

        frame = interp.frame
        if frame is not None and moves:
            step.kind = "frame"
            detail = "%s (line %d)" % (frame["code"], frame["line"])
            for axis, token in moves:
                self._miss([axis], "frame", detail, key=frame["code"])
                step.reads.append(self._unknown_read(axis, token, state, "frame"))
                self.pos[axis] = None
            self.last_polar = None
            return True
        if written.words and moves:
            step.kind = "unknown-code"
            self._miss([axis for axis, _ in moves], "unknown-code", written.words[0], key=written.words[0])
            for axis, token in moves:
                step.reads.append(self._unknown_read(axis, token, state, "unknown-code"))
                self.pos[axis] = None
            return True

        # Axis words that are the parameters of a cycle the block calls (`CYCL CALL POS`).
        other = self.cycle_positions(entries)
        if other:
            hit = [(axis, t) for axis, t in moves if t.address.upper() in other[0]]
            if hit:
                self._miss([axis for axis, _ in hit], "cycle-position", other[1], key=other[1])
            for axis, token in hit:
                step.reads.append(self._unknown_read(axis, token, state, "cycle-position"))
                self.pos[axis] = None
            moves = [(axis, t) for axis, t in moves if t.address.upper() not in other[0]]

        start = dict(self.pos)
        targets = self.resolve_moves(moves, line, units, entries, state)
        polar = bool(words.get(POLAR_ANGLE) or words.get(POLAR_RADIUS))
        if polar:
            self.polar_move(words, written, start, targets, line, units, entries, plane)
        else:
            self.last_polar = None
        arc = self.arc(words, written, start, targets, line, units, entries, plane, state, moves)
        for axis, value in targets.items():
            if value is not None:
                self._reach(axis, value)
            self.pos[axis] = value
        if held and moves:
            # T011: an increment from a level the program wrote ends on one too.
            kept = {r.axis for r in step.reads if r.unknown == "incremental-start" and r.axis in held}
            if kept:
                self.levels = self.levels | kept
        if moves or polar or arc:
            step.kind = "move"
        if self.whole_pass(state, entries):
            if targets or self.pass_written(words):
                # v1.2.0 (NCF-C): the taper start of the pass.
                self.single_pass(words, targets, entries, state, units, line)
            # v1.2.0 (T111): a block of a single-pass cycle (`path: 'cycle'`: the lathe `G90`,
            # `G92`, `G94`, system B `G77`-`G79`) cuts to the point it writes and goes back to
            # where it started: the end point is reached, the start is where the tool stands after.
            for axis in targets:
                self.pos[axis] = start.get(axis)
        self.after_cycle(state, written, moves, line, plane)
        return True

    # -- the single passes (v1.2.0, NCF-C) ----------------------------------------

    def _read_levels(self, written: _Written, tokens: Sequence[Any]) -> None:
        """v1.2.0 (NCR-9): whether a cycle with parameters writes its levels on the tool axis as
        numbers (:attr:`cycle_levels`): a call with its arguments (`CYCLE81(10,0,2,-10)`, also
        behind `MCALL`) on its line, a Klartext definition (`CYCL DEF 200`) on the lines of its
        block (`Q203=+0`, up to the line that does not go on with `~`)."""
        open_define = self._open_define
        if open_define is not None:
            open_define[2].update(_assigned_numbers(tokens, open_define[1]))
        for token in written.calls:
            entry = self.interp.entry(token.address or "")
            if isinstance(entry, dict) and as_dict(entry.get("sets")).get("cycle") is not None:
                self.cycle_levels[str(entry.get("code"))] = not empty_levels(token, entry)
        for entry, _, kind in written.entries:
            if kind != "keyword" or as_dict(entry.get("sets")).get("cycle") != "define":
                continue
            wanted = frozenset(
                str(p.get("address")).upper()
                for p in entry.get("params") or []
                if isinstance(p, dict) and gedit_nc.position_of(p) == "tool-axis" and isinstance(p.get("address"), str)
            )
            open_define = (str(entry.get("code")), wanted, set(_assigned_numbers(tokens, wanted)))
            self._open_define = open_define
        if open_define is not None and not any(t.kind == "continuation" for t in tokens):
            code, wanted, seen = open_define
            self.cycle_levels[code] = wanted <= seen
            self._open_define = None

    def pass_motion(self, state: Dict[str, Any], entries: Sequence[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """The motion code the block runs: one it writes, else the one in force."""
        written = [e for e in entries if e.get("group") == "motion" and (as_dict(e.get("sets")).get("motion") or as_dict(e.get("sets")).get("path"))]
        if written:
            return written[-1]
        code = as_dict(as_dict(state.get("groups")).get("motion")).get("code")
        motion = self.interp.entry(code) if isinstance(code, str) and code != "" else None
        return motion if isinstance(motion, dict) else None

    def pass_lengths_of(self, motion: Optional[Dict[str, Any]]) -> Dict[str, str]:
        """The length parameters of a single pass and the axis each lies along
        (`CodeParam.lengthAlong`: the taper `R`, along X for `G90`/`G92`, along Z for `G94`)."""
        out: Dict[str, str] = {}
        if not isinstance(motion, dict) or as_dict(motion.get("sets")).get("path") != "cycle":
            return out
        for param in motion.get("params") or []:
            if not isinstance(param, dict):
                continue
            address, along = param.get("address"), param.get("lengthAlong")
            if isinstance(address, str) and address and isinstance(along, str) and along in self.axes.known:
                out.setdefault(address.upper(), along)
        return out

    def pass_written(self, words: Dict[str, Any]) -> bool:
        """A block that writes a length of the single pass in force (`R-1.` alone): the control
        runs the pass again with it."""
        if not words:
            return False
        lengths = self.pass_lengths_of(self.pass_motion(self.interp.state, ()))
        return any((words[a].value_text or "") != "" for a in lengths if a in words)

    def clear_passes(self, entries: Sequence[Dict[str, Any]], moves: Sequence[Any]) -> None:
        """A one-shot code other than a dwell, or a plane code, clears the values the single
        passes share (FANUC 30i lathe manual, the restrictions of the canned cycles). An axis
        word forgets the end point the passes keep along its axis: a pass block that resolves it
        writes it again (:meth:`single_pass`); after any other move (a rapid, a frame, a word
        not resolved) the control may read that word as the pass's own, which is not certain."""
        if not self.pass_lengths and not self.pass_end and self.pass_unknown is None:
            return
        for axis, _ in moves:
            self.pass_end.pop(axis, None)
        for entry in entries:
            sets = as_dict(entry.get("sets"))
            dwell = any(isinstance(p, dict) and p.get("unit") == "dwell" for p in entry.get("params") or [])
            if (entry.get("group") == "nonmodal" and not dwell) or sets.get("plane") is not None:
                self.pass_lengths = {}
                self.pass_end = {}
                self.pass_unknown = None
                return

    def single_pass(self, words, targets, entries, state, units, line: int) -> None:
        """v1.2.0 (NCF-C): a block that runs a single pass with a taper starts the cut at its end
        point plus the taper, along the axis the taper lies along (`lengthAlong`): `G90`/`G92`
        add the radius `R` to X (twice it in a diameter column), `G94` adds `R` to Z (FANUC 30i
        lathe manual: the first move goes at rapid from the start point to the end coordinate
        of that axis plus the taper; R is a radius value). That point is reached; a taper or an
        end point that is not known leaves it not resolved."""
        motion = self.pass_motion(state, entries)
        lengths = self.pass_lengths_of(motion)
        code = str(as_dict(motion).get("code") or "")
        for address in lengths:
            token = words.get(address)
            if token is None or (token.value_text or "") == "" or gedit_nc.is_assignment(token):
                continue
            word = "%s (line %d)" % (token.text, line)
            literal, _ = literal_of(token)
            if literal is None:
                self.pass_lengths[address] = (None, word, "expression", None)
                continue
            value, readings = self.value(token, units, entries, "length")
            self.pass_lengths[address] = (value, word, None if value is not None else "machine-dependent", readings)
        for axis, value in targets.items():
            if value is None:
                self.pass_end.pop(axis, None)
            else:
                self.pass_end[axis] = value
        for address, along in lengths.items():
            found = self.pass_lengths.get(address)
            if found is None:
                if self.pass_unknown is not None:
                    # NCR-2: the taper the passes share is not known (a program after the first, a
                    # macro, a subprogram call above): nor is where the cut starts.
                    self._miss([along], "cycle", "the taper start of %s (line %d)" % (code, line), key=code, names=self.axes.label(along))
                continue
            value, word, why, readings = found
            if why == "machine-dependent":
                self._miss([along], why, word, readings=readings, angle=False, units=units)
                continue
            if why is not None:
                self._miss([along], why, word)
                continue
            if value is None or value == _ZERO:
                continue
            end = self.pass_end.get(along)
            if end is None:
                if along not in targets:
                    # The end along the taper's axis was written by a move outside the passes.
                    self._miss([along], "cycle", "the taper start of %s (line %d)" % (code, line), key=code, names=self.axes.label(along))
                continue
            self._reach(along, end + self.axes.col(along, value))

    def pass_taper(self, address: str) -> Optional[Tuple[Optional[Decimal], str, Optional[str], Any]]:
        """v1.2.0 (NCR-2): the length the passes share for ``address`` (the taper ``R``), as
        :attr:`pass_lengths` holds it, ``(None, what made it not known, 'unknown', None)`` after
        :meth:`forget_all` or a subprogram call, or ``None`` when no pass value is in force (no
        taper; ``R`` written as 0 is a value of 0)."""
        found = self.pass_lengths.get(address.upper())
        if found is not None:
            return found
        if self.pass_unknown is not None:
            return (None, self.pass_unknown, "unknown", None)
        return None

    def whole_pass(self, state: Dict[str, Any], entries: Sequence[Dict[str, Any]]) -> bool:
        """T111: the block runs a code whose every block is a whole pass that returns to its
        start (``sets.path: 'cycle'``): one it writes, else the motion code in force."""
        motion = self.pass_motion(state, entries)
        return isinstance(motion, dict) and as_dict(motion.get("sets")).get("path") == "cycle"

    # -- the kinds of block ---------------------------------------------------

    def plane_axes(self, plane: str) -> List[str]:
        """The axes of a plane the profile knows (``X``, ``Y``, ``Z`` when the plane is not known)."""
        pair = PLANE_AXES.get(plane)
        return [axis for axis in (pair or ("X", "Y", "Z")) if axis in self.axes.known]

    def forget_all(self, why: str = "") -> None:
        """Every axis and the last polar point become not known, and so do the values the single
        passes share (``why``: the block that made them so, for :meth:`pass_taper`)."""
        self._last = None
        self.levels = _NO_AXES
        self.pass_lengths = {}
        self.pass_end = {}
        self.pass_unknown = why or "a block above"
        for axis in self.pos:
            self.pos[axis] = None
        self.last_polar = None

    def _set_pole(self, moves, units, entries, plane: str) -> None:
        """The pole (Klartext `CC`): written coordinates, an increment, or the position."""
        pair = PLANE_AXES.get(plane)
        if pair is None:
            self.pole = {}
            return
        pole: Dict[str, Optional[Decimal]] = {}
        for axis in pair:
            pole[axis] = self.geo_pos(axis)
        for axis, token in moves:
            value, _ = self.value(token, units, entries)
            if value is None:
                pole[axis] = None
                continue
            if token.incremental:
                base = pole.get(axis)
                pole[axis] = None if base is None else base + value
            else:
                pole[axis] = value
        self.pole = {axis: v for axis, v in pole.items() if v is not None}
        self.pole_line = self._step.line
        self.last_polar = None

    def cycle_positions(self, entries) -> Optional[Tuple[frozenset, str]]:
        """The axis words that are a called cycle's own positions (`position: 'other'`)."""
        for entry in entries:
            params = entry.get("params")
            found = [
                str(p.get("address")).upper()
                for p in (params if isinstance(params, list) else [])
                if isinstance(p, dict) and gedit_nc.position_of(p) == "other" and isinstance(p.get("address"), str)
            ]
            hits = frozenset(a for a in found if self.axes.axis_of(a) is not None)
            if hits:
                return hits, str(entry.get("code"))
        return None

    # -- values ---------------------------------------------------------------

    def value(self, token: Any, units: Optional[str], entries: Sequence[Dict[str, Any]], number_class: Optional[str] = None) -> Tuple[Optional[Decimal], List[Dict[str, Any]]]:
        """The effective value of a word in ``report_units`` (degrees for an angle) and, when
        it has none, the readings the profile's presets give it (``Extents.value``)."""
        literal, _ = literal_of(token)
        if literal is None:
            return None, []
        cls = number_class
        if cls is None:
            # The class of an axis word depends on the block's codes (a `CodeParam.unit`) and,
            # for a feed, on the unit in force; remembered per combination, because a long
            # program asks the same question on every line.
            key = (token.address or "", tuple(id(e) for e in entries), self.interp.feed_unit, self.interp.pitch_feed)
            if key in self._classes:
                cls = self._classes[key]
            else:
                cls = gedit_nc.number_class_of(
                    token.address or "", self.profile, self.interp.feed_unit, entries, self.interp.pitch_feed
                )
                self._classes[key] = cls
        text, readings = self.readings.get(literal, cls, units or "mm")
        value = dec(text)
        if value is None:
            return None, readings
        if cls in ("length", "increment") and units in ("mm", "inch"):
            report = self.report_units or units
            if units == "inch" and report == "mm":
                value = value * INCH
            elif units == "mm" and report == "inch":
                value = value / INCH
        return value, []

    def _incremental_of(self, address: str, token: Any, function: Optional[str], distance: Any) -> Optional[bool]:
        """Whether a word moves by an increment: a twin, the word's own prefix or value
        function, then the distance mode; ``None`` when none of them says."""
        if address in self.axes.twins or token.incremental or function == "incremental":
            return True
        if function == "absolute":
            return False
        if distance == "incremental":
            return True
        if distance == "absolute":
            return False
        return None

    def _unknown_read(self, axis: str, token: Any, state: Dict[str, Any], kind: str) -> WordRead:
        """How a word was read when the block leaves its axis not known (``kind``)."""
        address = token.address.upper()
        _, function = literal_of(token)
        return WordRead(axis, token, address, self._incremental_of(address, token, function, state["distance"]), function, None, None, kind)

    def _plain_reads(self, moves, units, entries, state) -> List[WordRead]:
        """How the words of a block that is no move were read: their effective value as
        written (a machine position, a data word, the pole), never added to a position."""
        out: List[WordRead] = []
        distance = state["distance"]
        for axis, token in moves:
            address = token.address.upper()
            literal, function = literal_of(token)
            incremental = self._incremental_of(address, token, function, distance)
            if literal is None:
                out.append(WordRead(axis, token, address, incremental, function, None, None, "expression"))
                continue
            value, _ = self.value(token, units, entries)
            out.append(WordRead(axis, token, address, incremental, function, value, None, None if value is not None else "machine-dependent"))
        return out

    def resolve_moves(self, moves, line: int, units, entries, state) -> Dict[str, Optional[Decimal]]:
        """Every axis word of a positioning block, as the column value it moves to."""
        targets: Dict[str, Optional[Decimal]] = {}
        reads = self._step.reads
        distance = state["distance"]
        for axis, token in moves:
            address = token.address.upper()
            word = "%s (line %d)" % (token.text, line)
            literal, function = literal_of(token)
            incremental = self._incremental_of(address, token, function, distance)
            if literal is None:
                self._miss([axis], "expression", word)
                targets[axis] = None
                reads.append(WordRead(axis, token, address, incremental, function, None, None, "expression"))
                continue
            value, readings = self.value(token, units, entries)
            if value is None:
                angle = axis in self.axes.angular
                self._miss([axis], "machine-dependent", word, readings=readings, angle=angle, units=units)
                targets[axis] = None
                reads.append(WordRead(axis, token, address, incremental, function, None, None, "machine-dependent"))
                continue
            reading: Optional[str] = None
            if address in self.axes.diameter_words:
                reading = self.interp.diameter_reading(address)
                mode = as_dict(state["diameter"]).get("mode")
                if mode == "absolute-only" and function is not None:
                    # DIAM90: the word's own function decides, as the distance mode would.
                    reading = "diameter" if function == "absolute" else "radius"
                if reading == "unknown" or reading not in ("diameter", "radius"):
                    self._miss([axis], "diameter-unknown", word)
                    targets[axis] = None
                    reads.append(WordRead(axis, token, address, incremental, function, None, None, "diameter-unknown"))
                    continue
                if self.axes.lathe_column and reading == "radius":
                    value = value * _TWO
                elif not self.axes.lathe_column and reading == "diameter":
                    value = value / _TWO
            if incremental is None:
                self._miss([axis], "distance-unknown", word)
                targets[axis] = None
                reads.append(WordRead(axis, token, address, None, function, None, reading, "distance-unknown"))
                continue
            if incremental:
                base = targets.get(axis) if axis in targets else self.pos.get(axis)
                if base is None:
                    if axis in self.unstated and self.called is not None:
                        self._miss([axis], "called-program", word, key=self.called)
                        why = "called-program"
                    else:
                        self._miss([axis], "incremental-start", word)
                        why = "incremental-start"
                    targets[axis] = None
                    reads.append(WordRead(axis, token, address, True, function, None, reading, why))
                    continue
                value = base + value
            # NC-4: an axis a called program states is known from here on.
            self.unstated.discard(axis)
            targets[axis] = value
            reads.append(WordRead(axis, token, address, incremental, function, value, reading, None))
        return targets

    def geo_pos(self, axis: str) -> Optional[Decimal]:
        """Where ``axis`` is now, as a coordinate (``None`` while not known)."""
        value = self.pos.get(axis)
        return None if value is None else self.axes.geo(axis, value)

    def _geo(self, table, axis: str) -> Optional[Decimal]:
        value = table.get(axis)
        return None if value is None else self.axes.geo(axis, value)

    # -- the arc direction (data, §6.2) ----------------------------------------

    def _direction_word(self, words) -> Tuple[Any, Optional[str]]:
        """The direction word of the block (Klartext ``DR``) and the direction it gives:
        the address followed by its sign alone (``DR-1`` in a tool call gives none)."""
        for address in self.axes.direction_addresses:
            token = words.get(address)
            if token is not None:
                return token, self.axes.direction_words.get(address + (token.value_text or ""))
        return None, None

    def _motion_direction(self, motion: Any) -> Optional[str]:
        """``arcDirection`` of the motion code in force (``gedit_nc.arc_direction_of``)."""
        if motion not in self._directions:
            entry = self.interp.entry(motion) if isinstance(motion, str) and motion != "" else None
            self._directions[motion] = gedit_nc.arc_direction_of(entry)
        return self._directions[motion]

    def _helix(self, pair, start, targets) -> Dict[str, Tuple[Optional[Decimal], Optional[Decimal]]]:
        return {axis: (start.get(axis), value) for axis, value in targets.items() if axis not in pair}

    def _note_arc(self, arc: Arc) -> None:
        if not self._reach_on:
            return
        for axis, value in arc_extremes(arc):
            if axis in self.axes.known:
                self._reach(axis, self.axes.col(axis, value))

    # -- arcs -----------------------------------------------------------------

    def arc(self, words, written, start, targets, line, units, entries, plane, state, moves) -> bool:
        """The arc of a block in the active plane, its extremes, or why it is not resolved;
        whether the block is an arc at all (a polar arc is ``polar_move``'s)."""
        if self.word_cycle(state, moves):
            return False
        direction: Optional[str] = None
        codes = [code for _, code, _ in written.entries]
        tangent = next((c for c in codes if c in UNRESOLVED_ARCS), None)
        drw, written_direction = self._direction_word(words)
        motion = as_dict(state["groups"].get("motion")).get("code")
        if written_direction is not None and tangent is None:
            direction = written_direction
        elif tangent is None:
            direction = self._motion_direction(motion)
        if tangent is None and direction is None:
            return False
        if POLAR_ANGLE in words and direction is not None:
            return False  # a polar arc: `polar_move` has done it
        pair = PLANE_AXES.get(plane)
        centre_words = [w for w in self.axes.centre_words if w in words]
        in_plane = pair is not None and any(axis in pair for axis, _ in moves)
        radius_word = next((words[w] for w in RADIUS_WORDS if w in words and not zero(words[w])), None)
        if direction is not None and drw is None and not centre_words and radius_word is None and not in_plane:
            return False  # a modal G2 block that moves no axis of the plane: no arc
        name = tangent or (codes[0] if codes else None) or motion or "arc"
        word = "%s (line %d)" % (name, line)
        if tangent is not None or pair is None:
            self._arc_miss(pair, word)
            return True
        a, b = pair
        if words.get(ANGLE_WORD) is not None and a not in targets and b not in targets:
            # Plan §7 #294: an arc by its centre (or radius) and its opening angle, with no end
            # point: the control computes the end, the tracker does not, so it is not known.
            self._arc_miss(pair, word)
            for axis in pair:
                if axis in self.pos:
                    targets[axis] = None
            return True
        sa, sb = self._geo(start, a), self._geo(start, b)
        ea = self._geo(targets, a) if a in targets else sa
        eb = self._geo(targets, b) if b in targets else sb
        if a in targets and targets[a] is None or b in targets and targets[b] is None:
            self._arc_miss(pair, word)
            return True
        if sa is None or sb is None or ea is None or eb is None:
            self._arc_miss(pair, word)
            return True
        centre: Optional[Tuple[Decimal, Decimal]] = None
        full = False
        if radius_word is not None:
            form = "radius"
            r, _ = self.value(radius_word, units, entries, "length")
            if r is None:
                self._arc_miss(pair, word)
                return True
            centre = centre_from_radius(sa, sb, ea, eb, r, direction)
            if centre is None:
                self._arc_miss(pair, word)
                return True
        elif drw is not None:
            form = "pole"
            ca, cb = self.pole.get(a), self.pole.get(b)
            if ca is None or cb is None:
                self._arc_miss(pair, word)
                return True
            centre = (ca, cb)
            full = sa == ea and sb == eb
        else:
            # Each centre word on its own: incremental from the start point by the profile's
            # `arcCenterMode`, unless a value function says otherwise (`J=AC(8.381)`). A centre
            # word left out is an offset of 0 in incremental mode, and missing in absolute.
            form = "centre"
            found: Dict[str, Decimal] = {}
            starts = {a: sa, b: sb}
            for w in centre_words:
                axis = CENTRE_AXIS[w]
                if axis not in starts:
                    continue
                value, _ = self.value(words[w], units, entries, "length")
                if value is None:
                    self._arc_miss(pair, word)
                    return True
                _, function = literal_of(words[w])
                incremental = function == "incremental" or (function is None and self.axes.centre_incremental)
                if not incremental and axis in self.axes.diameter_words:
                    # SINUMERIK 840D sl programming manual, diameter programming (plan §7
                    # #302): an absolute centre in the diameter axis is a diameter under
                    # DIAMON and DIAM90 (an incremental one is always a radius).
                    reading = centre_reading(self.interp, axis, as_dict(state["diameter"]).get("mode"))
                    if reading is None:
                        self._arc_miss(pair, word)
                        return True
                    if reading == "diameter":
                        value = value / _TWO
                found[axis] = starts[axis] + value if incremental else value
            if not found:
                self._arc_miss(pair, word)
                return True
            for axis in pair:
                if axis not in found:
                    if not self.axes.centre_incremental:
                        self._arc_miss(pair, word)
                        return True
                    found[axis] = starts[axis]
            centre = (found[a], found[b])
            full = sa == ea and sb == eb
        turns = words.get(TURNS_WORD)
        if turns is not None and turns.value is not None and dec(turns.value.raw) not in (None, _ZERO):
            full = True
        arc = Arc(line, pair, direction, form, centre, (sa, sb), (ea, eb), full, None, self._helix(pair, start, targets))
        self._step.arc = arc
        self._note_arc(arc)
        return True

    def word_cycle(self, state: Dict[str, Any], moves: Sequence[Any]) -> bool:
        """v1.2.0 (FZ-4): a cycle written as a word (``sets.cycle: 'start'``: the ISO drilling
        cycles ``G81``–``G89``, the lathe ``G74``) runs in the block, written there or in force:
        the block's axis words are the cycle's position, reached at rapid, whatever arc code
        the motion group still holds. Its ``R`` is the retract plane, never a radius. A cycle
        called with its parameters (Sinumerik ``MCALL CYCLE81(…)``, Klartext ``M99``/``M89``)
        runs where an ordinary move, an arc too, takes the tool, so it is no such cycle."""
        running = as_dict(state.get("block")).get("cycle")
        if not running and moves:
            running = self.interp.active_cycle
        # An address letter and a number (`G81`), not a named call (`CYCLE81`, also letters
        # and digits but written with its arguments).
        if not isinstance(running, str) or not is_word_code(running) or len(head_of(running)) != 1:
            return False
        entry = self.interp.entry(running)
        return entry is not None and as_dict(entry.get("sets")).get("cycle") == "start"

    def _arc_miss(self, pair, word: str) -> None:
        self._miss(list(pair or ("X", "Y")), "arc", word)

    # -- polar moves (Klartext `LP`, `CP`, `CTP` about the pole `CC`) ---------

    def polar_move(self, words, written, start, targets, line, units, entries, plane) -> None:
        """A move about the pole: its end point, and for ``CP`` the arc and its extremes."""
        pair = PLANE_AXES.get(plane)
        codes = [code for _, code, _ in written.entries]
        word = "%s (line %d)" % (codes[0] if codes else POLAR_ANGLE, line)
        a_word, r_word = words.get(POLAR_ANGLE), words.get(POLAR_RADIUS)
        _, direction = self._direction_word(words)
        arc = direction is not None

        def fail() -> None:
            self._miss(list(pair or ("X", "Y")), "polar", word)
            for axis in pair or ("X", "Y"):
                if axis in self.axes.known:
                    targets[axis] = None
            self.last_polar = None

        if pair is None:
            fail()
            return
        a, b = pair
        ca, cb = self.pole.get(a), self.pole.get(b)
        sa, sb = self._geo(start, a), self._geo(start, b)
        if ca is None or cb is None:
            fail()
            return
        angle = radius = None
        if a_word is not None:
            angle, _ = self.value(a_word, units, entries, "angle")
            if angle is None:
                fail()
                return
        if r_word is not None:
            radius, _ = self.value(r_word, units, entries, "length")
            if radius is None:
                fail()
                return
        if arc:
            # `CP`: around the pole from where the tool is, the radius its distance to it.
            if sa is None or sb is None or angle is None:
                fail()
                return
            r = distance(sa - ca, sb - cb)
            t0 = Decimal(repr(angle_of(sb - cb, sa - ca)))
            if a_word.incremental:
                sweep: Optional[float] = float(angle)
                end_angle = t0 + angle
            else:
                end_angle = angle
                sweep = None
            dx, dy = polar_point(r, end_angle)
            ea, eb = ca + dx, cb + dy
            the_arc = Arc(line, pair, direction, "polar", (ca, cb), (sa, sb), (ea, eb), False, sweep, {})
            self._note_arc(the_arc)
            self.last_polar = (r, end_angle)
            self._step.polar = Polar(line, pair, (ca, cb), r, end_angle, True)
        else:
            last = self.last_polar
            if radius is None or r_word.incremental:
                if last is None:
                    fail()
                    return
                radius = last[0] + (radius if radius is not None else _ZERO)
            if angle is None or a_word.incremental:
                if last is None:
                    fail()
                    return
                angle = last[1] + (angle if angle is not None else _ZERO)
            dx, dy = polar_point(radius, angle)
            ea, eb = ca + dx, cb + dy
            self.last_polar = (radius, angle)
            self._step.polar = Polar(line, pair, (ca, cb), radius, angle, False)
            the_arc = None
        targets[a] = self.axes.col(a, ea)
        targets[b] = self.axes.col(b, eb)
        if the_arc is not None:
            self._step.arc = the_arc._replace(helix=self._helix(pair, start, targets))

    # -- cycles ---------------------------------------------------------------

    def after_cycle(self, state, written, moves, line: int, plane: str) -> None:
        """What a block that runs a cycle leaves behind, and what of it is not resolved."""
        block = as_dict(state["block"])
        interp = self.interp
        running: Optional[str] = None
        if block.get("cycle"):
            running = block["cycle"]
        elif interp.active_cycle and moves:
            running = interp.active_cycle
        self._step.cycle = running
        if running is None:
            for entry, code, _ in written.entries:
                cycle = as_dict(entry.get("sets")).get("cycle")
                if cycle in ("call", "call-modal") and interp.defined_cycle is None:
                    self._cycle_miss("%s (line %d), with no cycle the database describes defined" % (code, line), code, plane)
            if interp.modal_call is not None and interp.defined_cycle is None and moves:
                self._cycle_miss("%s (line %d), with no cycle the database describes defined" % (interp.modal_call["code"], line), interp.modal_call["code"], plane)
            return
        entry = interp.entry(running)
        cycle = as_dict(entry.get("sets")).get("cycle") if entry is not None else None
        if cycle not in ("start", "define"):
            return  # a thread move (`G32`) is a move, not a cycle
        written_axes = {axis for axis, _ in moves}
        normal = PLANE_NORMAL.get(plane)
        if plane == "XY":
            forget = {"Z"} if "Z" in self.pos else set()
        else:
            forget = set(written_axes) | set(self.plane_axes(plane))
            if normal is not None:
                forget.add(normal)
        for axis in forget:
            if axis in self.pos:
                self.pos[axis] = None
        # Where the cycle's positions are its parameters (a defined cycle, a call with
        # arguments), the depth it works to is in none of the block's axis words. A cycle
        # that a word in front of it made modal (`MCALL CYCLE83(…)`, rule 11b) runs in the
        # positioning blocks after it, with the parameters of the line that wrote it.
        modal = as_dict(state.get("activeCycle"))
        made_modal = (
            block.get("cycle") == running
            and modal.get("code") == running
            and not any(c == running for _, c, _ in written.entries)
        )
        with_params = cycle == "define" or (entry is not None and (self._written_as_call(written, running) or made_modal))
        if plane == "XY" and forget:
            # T011 (NC-18): the cycle leaves Z at its start level or at its retract plane,
            # which one is not computed (`G98`/`G99` are no data). Both are levels the program
            # wrote when the level it started from was known (the Z before the block, or a
            # level an earlier cycle left). NCR-9: a cycle with parameters leaves the tool at
            # the levels its parameters give, where it was defined or called with them (the
            # `MCALL` line, the Klartext definition's `Q203`): only where each was written as
            # a number; an empty one is 0, which nobody wrote.
            step = self._step
            levels_written = not with_params or self.cycle_levels.get(str(as_dict(entry).get("code"))) is True
            if levels_written and (step.before.get("Z") is not None or "Z" in step.levels):
                self.levels = self.levels | forget
            else:
                self.levels = self.levels - forget
        elif self.levels:
            self.levels = self.levels - forget
        self.last_polar = None
        if with_params:
            defined = state.get("definedCycle") or {}
            at = defined.get("line") if cycle == "define" else modal.get("line") if made_modal else line
            self._cycle_miss("%s (line %d)" % (running, at or line), running, plane)

    def _written_as_call(self, written, code: str) -> bool:
        return any(kind == "call" and c == code for _, c, kind in written.entries)

    def _cycle_miss(self, detail: str, key: str, plane: str) -> None:
        axes = ["Z"] if plane == "XY" else self.plane_axes(plane)
        axes = [axis for axis in axes if axis in self.axes.known]
        label = " and ".join(self.axes.label(x) for x in axes) or "tool-axis"
        self._miss(axes, "cycle", detail, key=key, names=label)


__all__ = [
    "ANGLE_WORD",
    "Arc",
    "CENTRE_AXIS",
    "CHORD_SLACK",
    "COMPUTED",
    "Event",
    "FLOWS",
    "FLOW_EVENTS",
    "FlowEvent",
    "INCH",
    "NOT_A_COORDINATE",
    "PLANE_AXES",
    "PLANE_NORMAL",
    "POLAR_ANGLE",
    "POLAR_RADIUS",
    "PathAxes",
    "PathTracker",
    "Polar",
    "RADIUS_WORDS",
    "Reach",
    "STEP_KINDS",
    "Step",
    "TURNS_WORD",
    "UNKNOWN_KINDS",
    "UNRESOLVED_ARCS",
    "Unknown",
    "VALUE_FUNCTIONS",
    "WordRead",
    "angle_of",
    "as_dict",
    "canonical",
    "arc_extremes",
    "arc_radii",
    "centre_from_radius",
    "centre_reading",
    "dec",
    "empty_levels",
    "head_of",
    "is_word_code",
    "distance",
    "literal_of",
    "polar_point",
    "rounded",
    "sqrt",
    "upper_list",
    "values_of",
    "within",
    "writes_tool_offset",
    "zero",
]
