"""The drilling cycles as plain moves, and the machine's motion data and limits (Phase 4 plan
§6.3, §6.4; AD-45 to AD-47).

Written as a stub by the P4b prelude: the vocabulary below (the roles, levels, steps, kinds,
the form fields, the refusal reasons with their texts, the data types) and the readers are
final and binding; P4.7 filled in the expansion of one cycle block into holes and moves
(:func:`holes_of`, :func:`levels_of`, :func:`peck_bottoms`). ``tests/python/test_nc_cycles.py``
holds the contract.

Who reads it: ``expand_cycles.py`` (P4.7) writes the moves of :func:`holes_of` in the
dialect's own forms; ``time_estimate.py`` (P4.9) times the same moves, so the time estimate
counts what the expansion would write (AD-45); ``extents.py`` (P4.7b) reads the levels of the
holes from :func:`holes_of` (T108); ``program_checks.py`` (P4.10) and ``time_estimate.py``
read :func:`machine_limits`. A helper module **above** ``gedit_nc`` like ``_nc_path`` (plan §7
#292), and it imports **``gedit_nc`` only**: the tracker comes in as an argument, so a script
that needs only the machine readers does not load the geometry modules. Standard library
only, Python 3.9.

The schema itself (``CodeEntry.expand``, ``CodeParam.expandRole``, ``CodeSets.cycleReturn``,
``CodeEntry.dwell``) is checked by the TypeScript loader (``src/lib/core/codes/expand.ts``),
which drops a broken schema whole; the context carries the loaded database, so the readers
here trust its shape and only refuse what is not there.

Settled defaults (the owner's answers of 2026-10-12, plan §9; the prelude's rules, plan §6.3)
----------------------------------------------------------------------------------------------

* **Q4-8, which cycles expand.** The plain drill, peck and bore list: Fanuc mill ``G73``,
  ``G81``, ``G82``, ``G83``, ``G85``, ``G86``, ``G89``; Klartext 200, 201; Sinumerik
  ``CYCLE81``-``CYCLE83`` (``CYCLE83`` with ``VARI=1``), ``CYCLE85``, ``CYCLE86``, ``CYCLE89``.
  Klartext 203 (its full retract runs at the retract feed ``Q208``) and ``CYCLE83`` with
  ``VARI=0`` (``_VRT=0`` means 1 mm) are cycles the step vocabulary cannot say, so the data
  gives them no schema. Never a tapping cycle, an oriented boring ``G76``, a back boring
  ``G87``, a manual-return ``G88``, a lathe cycle or an Okuma contour code: they have no
  schema, so they are refused (``no-schema``).
* **Q4-9, the peck values.** The ``G73`` retract and the ``G83`` clearance are settings of the
  control. The form asks them on each run (``peckRetract``, ``peckClearance``), prefilled from
  the machine's motion block; without a value a cycle that needs it is refused in the
  expansion (``peck-retract-missing``, ``peck-clearance-missing``) and counted as not estimated
  in the statistics, whose report goes on.
* **Q4-12, block numbers.** The first written block keeps the cycle block's number, the
  others get none; Klartext numbers every block, so the program is renumbered there.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, NamedTuple, Optional, Sequence, Tuple

import gedit_nc  # noqa: F401  (the expansion reads numbers and codes through it, P4.7)

# ---------------------------------------------------------------------------
# The vocabulary (final; the same lists as src/lib/core/codes/expand.ts)
# ---------------------------------------------------------------------------

#: `CodeParam.expandRole`, in the order of plan §6.3 (``EXPAND_ROLES`` of ``expand.ts``).
EXPAND_ROLES = (
    "position",
    "r-plane",
    "surface",
    "clearance",
    "depth",
    "depth-relative",
    "return",
    "return-relative",
    "peck",
    "first-peck",
    "first-peck-relative",
    "peck-decrement",
    "peck-minimum",
    "chip-breaks",
    "chip-retract",
    "advance",
    "dwell",
    "dwell-top",
    "feed",
    "feed-out",
    "repeat",
    "variant",
    "spindle-direction",
    "orient-angle",
    "lift-off-first",
    "lift-off-second",
    "lift-off-axis",
    "default",
)
#: The roles one entry may give to more than one parameter.
REPEATABLE_ROLES = ("position", "default")
EXPAND_KINDS = ("drill", "peck", "bore")
EXPAND_LEVELS = ("start", "r-plane", "clearance", "depth", "return")
EXPAND_STEPS = ("rapid", "feed", "pecks", "dwell", "spindle-stop", "spindle-restore", "orient", "lift-off")
PECK_MODES = ("chip-break", "full-retract", "universal")
#: The form fields a step may take a value from (Q4-9), and the `MachineMotion` member each
#: is prefilled from (the same name).
PECK_FIELDS = ("peckRetract", "peckClearance")
#: What `ExpandSchema.feedOutZero` may say a ``feed-out`` of 0 means (the owner, 2026-10-20;
#: Klartext 201 ``Q208=0``: out at the plunging feed ``Q206``): the ``feed`` value.
FEED_OUT_ZERO = ("feed",)
#: `CodeSets.cycleReturn`.
CYCLE_RETURNS = ("initial", "r-plane")
#: What :class:`HoleMove` can be.
MOVE_KINDS = ("rapid", "feed", "dwell", "spindle-stop", "spindle-restore", "orient")

#: Why a cycle block is not expanded: id -> the plain text after "<as written>: " (plan §6.3
#: rule 9). P4.7 may sharpen a text; a new id or a changed meaning needs a §7 row.
REASONS = {
    "no-schema": "gEdit has no description of how this cycle moves, so it cannot be written out as plain moves",
    "tapping": "a tapping or thread cycle keeps the spindle and the feed in step, which plain moves cannot do",
    "lathe": "drilling cycles are written out on milling programs only",
    "param-unknown": "this cycle block writes a value gEdit does not know the meaning of",
    "param-not-default": "this value changes how the cycle moves in a way gEdit does not write out; only its default can be expanded",
    "variant-unknown": "this cycle runs in a way gEdit does not write out for this value",
    "value-missing": "a value the cycle needs is not written and has no default",
    "expression": "a value of the cycle is a variable or a calculation",
    "machine-dependent": "a value of the cycle is read differently on different machines and no machine is chosen",
    "radius-comp": "radius compensation is on, and a drilling cycle runs without it",
    "plane": "the cycle runs outside the XY plane",
    "frame": "the cycle runs in a tilted or turned frame",
    "start-unknown": "the level the tool stands at when the cycle starts is not known",
    "distance-assumed": "the distance mode is only assumed from the profile, not set by the program or the machine",
    "return-assumed": "the return level (initial level or R point) is only assumed from the profile, not set by the program or the machine",
    "depth-direction": "the bottom of the hole is not below the level where the feed starts",
    "peck-retract-missing": "this cycle needs the high-speed peck retract of the machine; enter it in the form",
    "peck-clearance-missing": "this cycle needs the deep peck clearance of the machine; enter it in the form",
    "call-form": "this way of calling the cycle is not written out yet",
    "block-skip": "the block can be skipped (/), and the plain moves written for the cycle would not be skipped the same way",
    "selection-inside": "the selection cuts this cycle: its values, or blocks that run it, are outside the selection",
    "restore-outside": "the block that has to get back the motion code or the feed in force before the cycle is below the selection",
    "renumber-outside": "the program numbers every block, and the blocks below the selection would have to be renumbered",
    "no-code": "the database has no single code for a move this cycle needs (a rapid, a feed move, a dwell, a spindle stop or an oriented stop)",
    "resolution": "a level or a peck the expansion computes does not fit the form of the word it is written in",
}

#: The information rows of a run: id -> the plain text after "<as written>: ".
INFO = {
    "definition-kept": "the cycle definitions are left as written; without a call they do nothing",
    "data-kept": "the block stores the cycle's values and drills nothing, so it is left as written",
}

# ---------------------------------------------------------------------------
# The data types (final)
# ---------------------------------------------------------------------------


class PeckValues(NamedTuple):
    """The two machine-dependent peck values of the run's form, in the program's units, or
    ``None`` where the form left them empty (Q4-9)."""

    retract: Optional[Decimal] = None
    clearance: Optional[Decimal] = None


class HoleMove(NamedTuple):
    """One move or action of one hole.

    ``kind`` is one of :data:`MOVE_KINDS`. ``to`` holds the absolute coordinates the move ends
    at, in the block's units, for the axes it moves (a rapid in the plane to the hole, a move
    along the tool axis, a lift-off). ``feed`` is the feed of a ``feed`` move as the program
    wrote it (the cycle's feed word copied, or ``None`` for the feed in force) and
    ``feed_role`` the role it came from (``feed`` or ``feed-out``). ``seconds`` is a dwell's
    time and ``dwell`` its source word as written (copied where the dwell code takes the same
    word, plan §6.3 rule 6). ``step`` is the index of the schema step it came from."""

    kind: str
    to: Dict[str, Decimal]
    feed: Optional[str] = None
    feed_role: Optional[str] = None
    seconds: Optional[Decimal] = None
    dwell: Optional[str] = None
    step: int = -1


class Hole(NamedTuple):
    """One hole one block drills: where (``position``, the plane axes), from which level
    (``start``, the level the tool stood at, plan §6.3 "Levels"), the computed ``levels`` and
    the moves in order; ``end`` is where the tool stands after it."""

    line: int
    code: str
    kind: str
    position: Dict[str, Decimal]
    start: Decimal
    levels: Dict[str, Decimal]
    moves: List[HoleMove]
    end: Dict[str, Decimal]


class CycleRefusal(NamedTuple):
    """Why one block's cycle is not expanded: one id of :data:`REASONS`."""

    line: int
    reason: str
    written: str
    detail: str = ""


# ---------------------------------------------------------------------------
# The readers (final): twins of what the TypeScript loader keeps
# ---------------------------------------------------------------------------


def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def expand_of(entry: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The schema of a loaded entry (``CodeEntry.expand``: one schema, or ``{by, cases}``), or
    ``None``. The loader has dropped every broken schema, so a dict here is one to use."""
    value = _as_dict(entry).get("expand")
    return value if isinstance(value, dict) and value else None


def expand_role_of(param: Optional[Dict[str, Any]]) -> Optional[str]:
    """``CodeParam.expandRole`` of a loaded parameter, or ``None`` (not understood)."""
    role = _as_dict(param).get("expandRole")
    return role if role in EXPAND_ROLES else None


def schema_for(expand: Optional[Dict[str, Any]], variant: Optional[str]) -> Optional[Dict[str, Any]]:
    """The schema to run: ``expand`` itself, or for ``{by, cases}`` the case of ``variant`` (the
    variant parameter's value as written); ``None`` when there is none (``variant-unknown``)."""
    if not isinstance(expand, dict):
        return None
    if "cases" not in expand:
        return expand
    if variant is None:
        return None
    case = _as_dict(expand.get("cases")).get(variant)
    return case if isinstance(case, dict) else None


def cycle_return_of(entry: Optional[Dict[str, Any]]) -> Optional[str]:
    """``CodeSets.cycleReturn`` of a loaded entry: ``'initial'``, ``'r-plane'`` or ``None``."""
    value = _as_dict(_as_dict(entry).get("sets")).get("cycleReturn")
    return value if value in CYCLE_RETURNS else None


def dwell_form_of(entry: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """``CodeEntry.dwell`` of a loaded entry (``seconds``, ``increments``, ``revolutions``,
    ``lines``), or ``None``."""
    value = _as_dict(entry).get("dwell")
    return value if isinstance(value, dict) and value else None


def roles_of(entry: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Address -> role of every parameter of the entry that has one."""
    out: Dict[str, str] = {}
    for param in _as_dict(entry).get("params") or []:
        role = expand_role_of(param)
        address = _as_dict(param).get("address")
        if role is not None and isinstance(address, str):
            out[address.upper()] = role
    return out


def needs_peck_values(schema: Optional[Dict[str, Any]]) -> Tuple[bool, bool]:
    """Whether a schema takes a value from the form's ``peckRetract`` and ``peckClearance``
    (for a ``{by, cases}`` schema: any of its cases)."""
    if not isinstance(schema, dict):
        return (False, False)
    schemas = list(_as_dict(schema.get("cases")).values()) if "cases" in schema else [schema]
    retract = clearance = False
    for one in schemas:
        for step in _as_dict(one).get("steps") or []:
            for member in ("retract", "reentry"):
                form = _as_dict(_as_dict(step).get(member)).get("form")
                retract = retract or form == "peckRetract"
                clearance = clearance or form == "peckClearance"
    return (retract, clearance)


def call_of(step: Any, interp: Any) -> Optional[str]:
    """The subprogram call, jump or loop the block of ``step`` writes (from data), or ``None``:
    an entry with ``call: true`` or a ``programNumber`` parameter (Fanuc ``M98``, ``G65``,
    ``G66``), an entry whose ``flow`` sends the program elsewhere (``GOTO``, ``IF``, ``WHILE``,
    ``REPEAT``), or a called name the database does not know (a Sinumerik subprogram or a
    pattern cycle such as ``HOLES1(…)``). A cycle entry is no call here (Klartext ``M99`` and
    ``CYCL CALL`` run the defined cycle; ``_nc_cycles`` reads them itself).

    Shared by the expansion (a call while a modal cycle is in force refuses, fix batch 1,
    NC-1) and the time estimate (such a block is not estimated)."""
    for item in getattr(step, "entries", None) or []:
        entry = item[0] if isinstance(item, tuple) else item
        if not isinstance(entry, dict) or _sets(entry).get("cycle"):
            continue
        if entry.get("call") is True or any(p.get("programNumber") for p in _params(entry)):
            return str(entry.get("code"))
        if entry.get("flow") in FLOW_CALLS:
            return str(entry.get("code"))
    for token in getattr(step, "calls", None) or []:
        if interp.entry(token.address or "") is None:
            return (token.address or token.text).strip()
    return None


def machine_motion(ctx: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The machine's motion block (``context.machine.motion``, plan §6.4), or ``None`` when the
    machine has none (or no machine is chosen, or its block is broken: the app leaves it out)."""
    value = _as_dict(_as_dict(ctx).get("machine")).get("motion")
    return value if isinstance(value, dict) and value else None


def machine_limits(ctx: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The machine's limits block (``context.machine.limits``, plan §6.4), or ``None``."""
    value = _as_dict(_as_dict(ctx).get("machine")).get("limits")
    return value if isinstance(value, dict) and value else None


# ---------------------------------------------------------------------------
# The expansion (P4.7)
# ---------------------------------------------------------------------------
#
# How it is used: a caller walks the program with ``_nc_path.PathTracker`` and asks
# :func:`holes_of` after **every** line it walks (the lines above a selection too), right
# after ``tracker.line``, as ``_nc_geom`` is asked. The lines that run no cycle answer
# ``([], [])``, but they are read all the same: a Klartext definition (``CYCL DEF 200`` and
# its ``Q`` lines), a Sinumerik ``MCALL CYCLE81(…)`` line and a Fanuc cycle block leave the
# values the later blocks run with, and the tool-axis level a cycle leaves the tool at (which
# the tracker reports as "not known") is carried to the next cycle block. What the expansion
# keeps between lines lives on the tracker (:func:`_memory`), so a tracker is one walk.
#
# Everything here is read from data: the schema (``CodeEntry.expand``), the roles of the
# parameters (``CodeParam.expandRole``), ``CodeSets.cycleReturn`` of the code in force, the
# modal state of the tracker's interpreter. A value nobody describes refuses the block; no
# value is guessed. :func:`last_read` hands the writer (``expand_cycles.py``) the words the
# last block was expanded from, so it writes each number in the form of the word it came from.

_ZERO = Decimal(0)
#: One inch in millimetres, exactly.
_INCH = Decimal("25.4")
#: The working plane the expansion knows, and its axes (plan §6.3: a cycle outside XY refuses).
_PLANE = "XY"
_PLANE_AXES = ("X", "Y")
_TOOL_AXIS = "Z"
#: At most this many pecks in one hole; more means a peck nobody meant (a value of 0.0001).
MAX_PECKS = 10000
#: At most this many repeats of one cycle block (Fanuc ``K``): a higher count refuses
#: (``value-missing``) instead of drilling millions of holes (fix batch 1, CODE-1);
#: ``_nc_path.MAX_REPEAT`` is the same number for the extents.
MAX_REPEAT = 9999
#: The ``CodeEntry.flow`` values that send the program elsewhere (a jump, a branch, a loop).
FLOW_CALLS = ("jump", "branch", "else", "loop", "repeat")
#: The roles whose value is a length (read on the machine as a length, in the block's units).
LENGTH_ROLES = frozenset(
    (
        "r-plane",
        "surface",
        "clearance",
        "depth",
        "depth-relative",
        "return",
        "return-relative",
        "peck",
        "first-peck",
        "first-peck-relative",
        "peck-decrement",
        "peck-minimum",
        "chip-retract",
        "advance",
        "lift-off-first",
        "lift-off-second",
        "lift-off-axis",
    )
)
#: The roles a Fanuc cycle block keeps for the blocks after it (the drilling data stays in force
#: until the cycle is cancelled, FANUC 30i machining centre manual, the canned cycles); the
#: repeat count is valid only in its own block, and the feed is the modal feed.
_ONE_BLOCK_ROLES = frozenset(("repeat", "feed", "feed-out"))
#: The roles whose value is a whole number.
_COUNT_ROLES = frozenset(("repeat", "chip-breaks", "spindle-direction"))
#: The levels a role gives directly as an absolute coordinate on the tool axis: the words a
#: written level is copied from when it is that word's value.
LEVEL_WORD_ROLES = ("r-plane", "surface", "depth", "return", "first-peck")


class CycleError(ValueError):
    """A refusal found while the levels, the pecks or the moves of a hole are worked out: one id
    of :data:`REASONS` and what it concerns (``detail``, plain words)."""

    def __init__(self, reason: str, detail: str = "") -> None:
        ValueError.__init__(self, "%s: %s" % (reason, detail) if detail else reason)
        self.reason = reason
        self.detail = detail


class CycleRead(NamedTuple):
    """What the last block :func:`holes_of` expanded was read from (:func:`last_read`): the writer
    of ``expand_cycles.py`` needs it to write each number in the form of its word, to know which
    tokens of the block leave the program and which stay on the first written block.

    ``words`` maps each role to the token its value was read from (a word of the block, an
    argument of a call or a Klartext ``Q`` parameter, the last two as tokens made up for them);
    ``form`` is ``'word'`` (Fanuc ``G81 X… Z… R…``), ``'call'`` (Sinumerik ``CYCLE81(…)``, also
    behind ``MCALL``) or ``'define'`` (Klartext ``CYCL DEF 200``). ``removed`` holds ``id()`` of
    the block's tokens that leave the program (the cycle code, its parameter words, the call
    word); ``own`` the significant tokens that stay on the first written block (codes of other
    groups, ``M``, ``S``, ``T``, comments; not the block number); ``keep_block`` is true where the
    block itself stays as written and the holes follow it (a positioning block with ``M99``, under
    ``M89`` or under ``MCALL``). ``plane_words`` are the position words the plane move copies
    (Fanuc); ``approach`` is the move of a ``CYCL CALL POS`` to its point: ``'rapid'``, the feed
    word as written, or ``''`` for the feed in force; ``None`` when the block has no such move.
    ``feed`` is the feed in force at the block as written (the interpreter's value text),
    ``spindle`` the spindle code in force, ``level_token`` the word that wrote the tool-axis level
    the cycle starts from (when the tracker knows it), ``units`` the block's units and
    ``incremental`` whether the cycle's words follow the incremental distance mode, ``first_line``
    the first line any of its values was written on (a selection that starts below it cuts the
    cycle off)."""

    line: int
    code: str
    entry: Dict[str, Any]
    schema: Dict[str, Any]
    form: str
    words: Dict[str, Any]
    units: str
    incremental: bool
    distance: Optional[str]
    call: Optional[str]
    removed: frozenset
    own: Tuple[Any, ...]
    keep_block: bool
    plane_words: Tuple[Any, ...]
    approach: Optional[str]
    feed: Optional[str]
    spindle: Optional[str]
    level_token: Optional[Any]
    first_line: int


class _Memory:
    """What the expansion keeps from line to line of one walk (one per tracker)."""

    def __init__(self) -> None:
        self.step_id: Optional[int] = None
        self.step_ref: Any = None
        self.result: Tuple[List[Hole], List[CycleRefusal]] = ([], [])
        #: The drilling data of a word cycle in force (Fanuc): address -> (token, line).
        self.words: Dict[str, Tuple[Any, int]] = {}
        #: The initial level of the word cycle in force (report units), and the word that wrote it.
        self.initial: Optional[Decimal] = None
        self.initial_token: Any = None
        #: The Klartext definition being read (its block goes on with ``~``), and the last one read:
        #: (code, line, {address: token}).
        self.defining: Optional[Tuple[str, int, Dict[str, Any]]] = None
        self.defined: Optional[Tuple[str, int, Dict[str, Any]]] = None
        #: The cycle a ``MCALL`` made modal: (code, line, {address: token}, written addresses).
        self.mcall: Optional[Tuple[str, int, Dict[str, Any], frozenset]] = None
        #: The tool-axis level (report units) where the tracker no longer knows it because a cycle
        #: moved the tool, and the word that wrote it while it was a written level.
        self.z: Optional[Decimal] = None
        self.z_token: Any = None
        #: How far the tool stands from where the tracker puts it in the plane (report units): a
        #: repeat count under incremental distance moves it by every hole, the tracker by one.
        self.shift: Dict[str, Decimal] = {}
        #: Whether radius compensation is on, from the last code that set it (Klartext ``RL`` is
        #: no modal entry, yet stays on until ``R0``).
        self.comp_on: Optional[bool] = None
        #: The straight motion codes the program writes (canonical), for the one rapid and feed
        #: code of a dialect whose database offers more than one.
        self.straight: List[str] = []
        self.last: Optional[CycleRead] = None
        #: What depends on the database only, worked out once per walk (:func:`_database`).
        self.database: Optional[Dict[str, Any]] = None


def _memory(tracker: Any) -> _Memory:
    found = getattr(tracker, "_nc_cycles_memory", None)
    if isinstance(found, _Memory):
        return found
    memory = _Memory()
    try:
        setattr(tracker, "_nc_cycles_memory", memory)
    except (AttributeError, TypeError):  # pragma: no cover - a tracker with slots
        pass
    return memory


def _database(tracker: Any) -> Dict[str, Any]:
    """What the expansion asks of the database on every cycle block, read once per walk: the groups
    that set the distance mode and the cycle return, and the straight-move codes."""
    memory = _memory(tracker)
    if memory.database is None:
        codes = [e for e in (getattr(tracker, "codes", None) or []) if isinstance(e, dict)]
        memory.database = {
            "distance": sorted({str(e.get("group")) for e in codes if _sets(e).get("distance") in ("absolute", "incremental")}),
            "return": sorted({str(e.get("group")) for e in codes if cycle_return_of(e) is not None}),
            "straight": {kind: _straight_codes(codes, kind) for kind in ("rapid", "feed")},
        }
    return memory.database


def _roles(tracker: Any, entry: Dict[str, Any]) -> Dict[str, str]:
    """:func:`roles_of`, once per entry and walk."""
    table = _database(tracker).setdefault("roles", {})
    found = table.get(id(entry))
    if found is None:
        found = table[id(entry)] = roles_of(entry)
    return found


def last_read(tracker: Any) -> Optional[CycleRead]:
    """The words the last block :func:`holes_of` expanded (without refusal) was read from, or
    ``None``. Read right after :func:`holes_of` answered holes for that block."""
    return _memory(tracker).last


# -- small helpers --------------------------------------------------------------


def _sets(entry: Any) -> Dict[str, Any]:
    return _as_dict(_as_dict(entry).get("sets"))


def _params(entry: Any) -> List[Dict[str, Any]]:
    params = _as_dict(entry).get("params")
    return [p for p in params if isinstance(p, dict) and isinstance(p.get("address"), str)] if isinstance(params, list) else []


def _upper(value: Any) -> str:
    return value.upper() if isinstance(value, str) else ""


def _text(token: Any) -> str:
    return " ".join(str(getattr(token, "text", "") or "").split())


def _decimal(literal: Any) -> Optional[Decimal]:
    return gedit_nc.decimal_of(literal) if literal is not None else None


def _whole(value: Optional[Decimal]) -> Optional[int]:
    if value is None or value != value.to_integral_value():
        return None
    return int(value)


def _convert(value: Optional[Decimal], source: Optional[str], target: str) -> Optional[Decimal]:
    """A length from ``source`` units into ``target`` units (25.4 exactly)."""
    if value is None or source not in ("mm", "inch") or source == target:
        return value
    return value * _INCH if source == "inch" else value / _INCH


def _synthetic(address: str, value_text: str, text: Optional[str] = None) -> Any:
    """A word made up for a value the tokenizer does not give as one (a Klartext ``Q200=2``, an
    argument of a call): its literal is the value as written, ``None`` for anything that is not
    one plain number."""
    stripped = value_text.strip()
    literal = gedit_nc.parse_number(stripped) if stripped != "" else None
    return gedit_nc.Token(kind="word", start=0, end=0, text=text if text is not None else stripped, address=address, value_text=stripped, value=literal)


def split_arguments(text: str) -> List[str]:
    """The arguments of a call as written, an empty one keeping its place (a cycle reads its
    arguments by position); a comma inside a string or brackets does not split."""
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


def _code_tokens(step: Any, interp: Any) -> Dict[int, Dict[str, Any]]:
    """``id(token)`` -> the database entry of every code token of the step (a word code, a call,
    a keyword), as the tracker read them."""
    out: Dict[int, Dict[str, Any]] = {}
    tokens = list(getattr(step, "tokens", None) or [])
    count = len(tokens)
    for i, token in enumerate(tokens):
        kind = token.kind
        entry = None
        if kind == "word":
            address = _upper(token.address)
            if address == "" or gedit_nc.is_assignment(token):
                continue
            entry = interp.entry(address + (token.value_text or ""))
        elif kind == "call":
            entry = interp.entry(token.address or "")
        elif kind == "keyword":
            name = token.address or token.text
            number = token.value_text
            taken = None
            if number is None:
                nxt = next((t for t in tokens[i + 1 : count] if t.kind != "whitespace"), None)
                if nxt is not None and nxt.kind == "word" and nxt.address is None and nxt.value_text is not None:
                    number = nxt.value_text
                    taken = nxt
            if number is not None:
                entry = interp.entry("%s %s" % (name, number))
                whole, dot, _ = number.partition(".")
                if entry is None and dot == "." and whole.isdigit():
                    entry = interp.entry("%s %s" % (name, whole))
                if entry is not None and taken is not None:
                    out[id(taken)] = entry
            if entry is None:
                entry = interp.entry(name)
        if entry is not None:
            out[id(token)] = entry
    return out


def _q_assignments(tokens: Sequence[Any]) -> Dict[str, Any]:
    """The Klartext parameters ``Q200=2`` of one line, as made-up words by their address."""
    out: Dict[str, Any] = {}
    count = len(tokens)
    i = 0
    while i < count:
        token = tokens[i]
        if token.kind != "variable":
            i += 1
            continue
        j = i + 1
        while j < count and tokens[j].kind == "whitespace":
            j += 1
        if j >= count or tokens[j].kind != "operator" or tokens[j].text.strip() != "=":
            i += 1
            continue
        k = j + 1
        end = k
        while end < count and tokens[end].kind not in ("comment", "continuation"):
            end += 1
        value = "".join(t.text for t in tokens[k:end]).strip()
        name = token.text.strip().upper()
        out[name] = _synthetic(name, value, "%s=%s" % (token.text.strip(), value))
        i = end
    return out


def _straight_codes(codes: Sequence[Dict[str, Any]], motion: str) -> List[Dict[str, Any]]:
    """The entries that make a plain straight move of the kind ``motion`` (``'rapid'``,
    ``'feed'``): the motion group, ``sets.motion``, no path, no thread or tap, no machine or data
    words, no pole, no parameters of their own (plan §6.3 rule 5)."""
    out = []
    for entry in codes:
        if not isinstance(entry, dict) or entry.get("group") != "motion":
            continue
        sets = _sets(entry)
        if sets.get("motion") != motion or sets.get("path"):
            continue
        if entry.get("pitchFeed") or entry.get("tapping") or entry.get("pitchFeedAmbiguous"):
            continue
        if entry.get("axisWords") or entry.get("pole") or _params(entry):
            continue
        out.append(entry)
    return out


def straight_code(tracker: Any, motion: str) -> Optional[Dict[str, Any]]:
    """The one database entry a plain ``motion`` move (``'rapid'``, ``'feed'``) is written with,
    or ``None`` (``no-code``). Where the database offers more than one, the one the program itself
    writes decides; one the program never writes is not chosen."""
    found = _database(tracker)["straight"].get(motion) or []
    if len(found) == 1:
        return found[0]
    if len(found) > 1:
        written = _memory(tracker).straight
        used = [e for e in found if str(e.get("code")) in written]
        if len(used) == 1:
            return used[0]
    return None


def _group_state(state: Dict[str, Any], groups: Sequence[str]) -> List[Dict[str, Any]]:
    found = []
    table = _as_dict(state.get("groups"))
    for group in groups:
        value = table.get(group)
        if isinstance(value, dict):
            found.append(value)
    return found


def _assumed(value: Dict[str, Any]) -> bool:
    """A modal value only assumed from the profile: not written by the program, not the machine's
    power-on mode (Q4-5)."""
    return value.get("assumed") is True and value.get("from") != "machine"


# -- levels and pecks (plan §6.3, "Levels" and "Pecks") ---------------------------


def levels_of(schema: Dict[str, Any], values: Dict[str, Decimal], start: Decimal, incremental: bool, return_mode: Optional[str]) -> Dict[str, Decimal]:
    """The absolute levels of one hole (plan §6.3, "Levels").

    ``values`` are the role values read on the machine (coordinates in the block's units);
    ``start`` the start level: for a schema whose return is by the code in force it is the
    **initial level** of the cycle (Fanuc: the level of the first hole's start, kept for the holes
    after it); ``incremental`` whether the cycle's own words follow the incremental distance mode
    (``r-plane`` from ``start``, ``depth`` from the r-plane); ``return_mode`` the
    ``CodeSets.cycleReturn`` in force (``'initial'``, ``'r-plane'``) for ``returnBy: 'code'``.

    A level whose values are not written is left out (the caller refuses a step that needs it,
    ``value-missing``); a return mode that is not known raises ``return-assumed``, an
    into-material depth below 0 ``depth-direction`` (:class:`CycleError`).

    Fix batch 1 (NC-3, NC-7): a set-up clearance or a return distance below 0 refuses
    (``value-missing``: the controls take the clearance without its sign, Klartext ``Q200`` and
    ``Q204`` are 0 or more), and so does an absolute return level that is not above the surface
    (SINUMERIK alarms on ``RTP`` not above ``RFP``). A relative depth of 0 without an absolute
    depth refuses (``value-missing``: Klartext runs no cycle at depth 0, SINUMERIK would drill to
    the reference plane); a signed relative depth above 0 refuses (``depth-direction``)."""
    out: Dict[str, Decimal] = {"start": start}
    surface = values.get("surface")
    if values.get("clearance") is not None and values["clearance"] < _ZERO:
        raise CycleError("value-missing", "a set-up clearance below 0")
    if values.get("return-relative") is not None and values["return-relative"] < _ZERO:
        raise CycleError("value-missing", "a return distance below 0")
    if "r-plane" in values:
        out["r-plane"] = start + values["r-plane"] if incremental else values["r-plane"]
    if surface is not None and "clearance" in values:
        out["clearance"] = surface + values["clearance"]
    relative = values.get("depth-relative")
    depth = values.get("depth")
    if relative is not None and (relative != _ZERO or depth is None):
        # T108: a relative depth wins over an absolute one where both are written and it is
        # not 0 (SINUMERIK cycles manual, DP and DPR: the depth follows DPR; a 0 is a value no
        # cycle reads as a depth, the reading of a parameter left out).
        if relative == _ZERO:
            raise CycleError("value-missing", "a depth of 0 and no other depth")
        if surface is None:
            raise CycleError("value-missing", "the surface the relative depth is measured from")
        mode = schema.get("relativeDepth")
        if mode == "signed":
            if relative > _ZERO:
                raise CycleError("depth-direction", "a relative depth above 0")
            out["depth"] = surface + relative
        elif mode == "into-material":
            if relative < _ZERO:
                raise CycleError("depth-direction", "a relative depth below 0")
            out["depth"] = surface - relative
        else:
            raise CycleError("value-missing", "how the relative depth is read")
    elif depth is not None:
        if incremental:
            if "r-plane" not in out:
                raise CycleError("value-missing", "the R point an incremental depth is measured from")
            out["depth"] = out["r-plane"] + depth
        else:
            out["depth"] = depth
    if schema.get("returnBy") == "code":
        if return_mode == "initial":
            out["return"] = start
        elif return_mode == "r-plane":
            if "r-plane" in out:
                out["return"] = out["r-plane"]
        else:
            raise CycleError("return-assumed")
    elif "return" in values:
        if surface is not None and not values["return"] > surface:
            raise CycleError("value-missing", "a return level that is not above the surface")
        out["return"] = values["return"]
    elif "return-relative" in values and surface is not None:
        out["return"] = surface + values["return-relative"]
    return out


def peck_bottoms(feed_start: Decimal, depth: Decimal, values: Dict[str, Decimal], schema_step: Dict[str, Any]) -> List[Decimal]:
    """The bottom of every peck from ``feed_start`` down to ``depth`` (plan §6.3, "Pecks"); the
    last one is ``depth``.

    The pecks are measured from ``values['surface']`` where the entry has a surface, otherwise
    from the feed start (Fanuc: the R point). The first peck ends at ``values['first-peck']`` (an
    absolute level; the caller turns a ``first-peck-relative`` into one) when it is there,
    otherwise one ``peck`` below that origin; each further peck is the one before less
    ``peck-decrement``, but not shorter than ``peck-minimum`` when that is above 0, else not
    shorter than the decrement. A peck of 0 or less, a negative decrement, or more than
    :data:`MAX_PECKS` pecks raise ``value-missing``.

    The origin (settled at the Wave A integration from the manuals): Klartext feeds to depth in
    one pass when the plunging depth equals the depth (TNC 640 cycles manual 10/2017, cycle 200,
    Q202), so Q202 counts from the surface Q203, not from the set-up clearance; SINUMERIK takes
    the stroke of the first drilling depth, which FDPR measures from the reference plane, for
    the strokes after it (cycles manual 01/2008, CYCLE83, DAM); FANUC cuts Q from the R point
    (30i machining centre manual, G83)."""
    first = values.get("first-peck")
    peck = values.get("peck")
    decrement = values.get("peck-decrement") or _ZERO
    minimum = values.get("peck-minimum")
    origin = values.get("surface", feed_start)
    if origin > feed_start:
        raise CycleError("value-missing", "a surface above the level the feed starts at")
    if first is not None:
        length = origin - first
    elif peck is not None:
        length = peck
    else:
        raise CycleError("value-missing", "the peck depth")
    if length <= _ZERO:
        raise CycleError("value-missing", "a peck of 0 or less")
    if decrement < _ZERO:
        raise CycleError("value-missing", "a peck decrement below 0")
    floor: Optional[Decimal] = None
    if minimum is not None and minimum > _ZERO:
        floor = minimum
    elif decrement > _ZERO:
        floor = decrement
    bottoms: List[Decimal] = []
    level = origin
    while True:
        level = level - length
        if level <= depth:
            bottoms.append(depth)
            return bottoms
        bottoms.append(level)
        if len(bottoms) >= MAX_PECKS:
            raise CycleError("value-missing", "more than %d pecks" % MAX_PECKS)
        following = length - decrement
        if floor is not None and following < floor:
            following = floor
        if following <= _ZERO:
            raise CycleError("value-missing", "a peck of 0 or less")
        length = following


# -- one block --------------------------------------------------------------------


def holes_of(step: Any, tracker: Any, pecks: PeckValues, context: Dict[str, Any]) -> Tuple[List[Hole], List[CycleRefusal]]:
    """The holes the block of ``step`` drills (``tracker`` is the ``_nc_path.PathTracker`` that
    made the step, asked before its next line, as ``_nc_geom`` asks it): one per hole the block
    runs (a repeat count gives several), with every move in order; or the refusals of the
    block. A block that runs no cycle answers ``([], [])``.

    Ask it for every line of the walk, the lines above a selection included: a definition, a
    ``MCALL`` line and a cycle block leave values the later blocks run with (module comment
    above). Asking twice for the same step gives the same answer."""
    memory = _memory(tracker)
    if memory.step_id == id(step) and memory.step_ref is step:
        return memory.result
    memory.last = None
    _observe(memory, step, tracker)
    result: Tuple[List[Hole], List[CycleRefusal]] = ([], [])
    end: Optional[Decimal] = None
    ran = bool(getattr(step, "cycle", None))
    if ran:
        result, end = _Block(memory, step, tracker, pecks, context).run()
    else:
        hidden = _hidden_cycle(step, tracker) or _data_alone(step, tracker)
        if hidden is not None:
            # The tracker stops at a block it cannot place (a move in a frame, an unknown code), so
            # it does not report the cycle the block runs: refused, never written as it stands.
            ran = True
            written = _quote_text("".join(t.text for t in getattr(step, "tokens", None) or []))
            reason = "frame" if getattr(step, "kind", None) == "frame" else "param-unknown"
            result = ([], [CycleRefusal(step.line, reason, written, hidden)])
    # The holes the control drills at a call or a jump while a cycle is in force, or after a block
    # under `MCALL` that writes no position, are not the ones the walk sees: refused, so the run
    # never writes the cycle out with them lost (fix batch 1, NC-1, NC-10). The call is the reason
    # given, whatever else the block has.
    found = _called_under_cycle(step, tracker, ran)
    if found is None and not result[1]:
        found = _runs_under_mcall(memory, step, tracker, ran)
    if found is not None:
        written = _quote_text("".join(t.text for t in getattr(step, "tokens", None) or []))
        result = ([], [CycleRefusal(step.line, "call-form", written, found)])
    _after(memory, step, tracker, ran, result, end)
    memory.step_id = id(step)
    memory.step_ref = step
    memory.result = result
    return result


def _hidden_cycle(step: Any, tracker: Any) -> Optional[str]:
    """The cycle a block runs that the tracker did not report (it stops at a move in a frame, at a
    code the database lacks, at a machine position or a data block), as the interpreter reads it;
    ``None`` when the block runs none."""
    if getattr(step, "kind", None) not in ("frame", "unknown-code", "machine", "data"):
        return None
    interp = tracker.interp
    running = _as_dict(interp.state.get("block")).get("cycle")
    if not running and getattr(step, "moves", None):
        running = interp.active_cycle
    if not isinstance(running, str) or not running:
        return None
    entry = interp.entry(running)
    if _sets(entry).get("cycle") not in ("start", "define"):
        return None
    if getattr(step, "kind", None) == "frame":
        frame = interp.frame or {}
        return "%s (line %s)" % (frame.get("code"), frame.get("line"))
    return "%s with %s" % (running, (getattr(step, "unknown_codes", None) or [step.kind])[0])


def _called_under_cycle(step: Any, tracker: Any, ran: bool) -> Optional[str]:
    """A subprogram call, a jump, a loop or a pattern cycle (:func:`call_of`) in a block that
    runs a cycle or while a modal cycle is in force (a Fanuc cycle, a Sinumerik ``MCALL``, a
    Klartext ``M89``): the control runs the cycle at the positions of the subprogram or the
    pattern, which the straight walk does not follow. ``None`` otherwise (fix batch 1, NC-1)."""
    interp = tracker.interp
    running = interp.active_cycle or (getattr(step, "cycle", None) if ran else None)
    if not running:
        return None
    called = call_of(step, interp)
    if called is None:
        return None
    return "%s while %s is in force" % (called, running)


def _runs_under_mcall(memory: _Memory, step: Any, tracker: Any, ran: bool) -> Optional[str]:
    """A block under a cycle ``MCALL`` made modal that runs the cycle on the control although it
    writes no position: one that writes only a feed or a speed while a straight move code is in
    force, or only a straight move code (``G0``, ``G1``). The walk runs the cycle after a block
    with a position only; refused, never written out without those holes (fix batch 1, NC-10).
    ``None`` for any other block."""
    if ran or memory.mcall is None or getattr(step, "moves", None):
        return None
    interp = tracker.interp
    if interp.active_cycle != memory.mcall[0]:
        return None
    entries = list(getattr(step, "entries", None) or [])
    if any(_sets(e).get("cycle") for e, _, _ in entries):
        return None
    straight = [e for e, _, _ in entries if e.get("group") == "motion" and _sets(e).get("motion") in ("rapid", "feed") and not _sets(e).get("path")]
    if straight:
        return "%s under MCALL: the control runs the cycle after this block too" % str(straight[0].get("code"))
    code = _as_dict(_as_dict(interp.state.get("groups")).get("motion")).get("code")
    motion = _sets(interp.entry(code)) if isinstance(code, str) else {}
    if motion.get("motion") not in ("rapid", "feed") or motion.get("path"):
        return None
    addresses = _as_dict(_as_dict(getattr(tracker, "profile", None)).get("addresses"))
    wanted = {_upper(addresses.get("feed")) or "F", _upper(addresses.get("spindle")) or "S"}
    for token in getattr(step, "tokens", None) or []:
        if token.kind == "word" and _upper(token.address) in wanted and (token.value_text or "") != "":
            return "%s under MCALL: the control runs the cycle after this block too" % _text(token)
    return None


def _data_alone(step: Any, tracker: Any) -> Optional[str]:
    """A block without a position that writes drilling data of the word cycle in force (Fanuc
    ``R5.`` or ``Q3.`` alone under ``G81``): the control drills in a block with ``R`` and keeps the
    others as data (FANUC 30i machining centre manual, the canned cycles), the tracker runs no
    cycle there, and once the cycle is written out no cycle is left to take them. The feed word
    is the modal feed and stays. ``None`` for any other block."""
    if getattr(step, "moves", None) or getattr(step, "kind", None) != "none":
        return None
    interp = tracker.interp
    running = interp.active_cycle
    if not isinstance(running, str) or not running or not running[:1].isalpha() or not running[1:2].isdigit():
        return None
    entry = interp.entry(running)
    if _sets(entry).get("cycle") != "start":
        return None
    feed = _upper(_as_dict(getattr(tracker, "profile", None)).get("addresses", {}).get("feed")) or "F"
    params = {_upper(p.get("address")) for p in _params(entry)} - {feed}
    for token in getattr(step, "tokens", None) or []:
        if token.kind == "word" and _upper(token.address) in params and (token.value_text or "") != "":
            if interp.entry(_upper(token.address) + (token.value_text or "")) is None:
                return "%s without a position under %s" % (_text(token), running)
    return None


def _observe(memory: _Memory, step: Any, tracker: Any) -> None:
    """What a line leaves for the lines after it, read before its own cycle is judged."""
    tokens = list(getattr(step, "tokens", None) or [])
    entries = list(getattr(step, "entries", None) or [])
    continues = any(t.kind == "continuation" for t in tokens)
    # A Klartext definition: its parameters on the lines of its block.
    for entry, code, kind in entries:
        if kind == "keyword" and _sets(entry).get("cycle") == "define":
            memory.defining = (str(entry.get("code")), step.line, {})
    if memory.defining is not None:
        memory.defining[2].update(_q_assignments(tokens))
        if not continues:
            memory.defined = memory.defining
            memory.defining = None
    # A cycle made modal by the word in front of it (Sinumerik `MCALL CYCLE81(…)`); a bare
    # `MCALL` ends it.
    if any(_sets(e).get("cycle") == "call-modal-next" for e, _, _ in entries):
        memory.mcall = None
        for token in tokens:
            if token.kind != "call":
                continue
            entry = tracker.interp.entry(token.address or "")
            if _sets(entry).get("cycle") == "start":
                args, written = _call_arguments(token, entry)
                memory.mcall = (str(entry.get("code")), step.line, args, written)
    for entry, _, _ in entries:
        comp = _sets(entry).get("radiusComp")
        if comp in ("on", "off"):
            memory.comp_on = comp == "on"
        if entry.get("group") == "motion" and _sets(entry).get("motion") in ("rapid", "feed") and not _sets(entry).get("path"):
            code = str(entry.get("code"))
            if code not in memory.straight:
                memory.straight.append(code)


def _call_arguments(token: Any, entry: Dict[str, Any]) -> Tuple[Dict[str, Any], frozenset]:
    """The arguments of a cycle written as a call, by the address of the parameter at their place:
    ``({address: token}, written addresses)``; an argument past the last parameter is kept under
    ``#n``; an empty one is not written."""
    params = _params(entry)
    out: Dict[str, Any] = {}
    for position, arg in enumerate(split_arguments(token.value_text or ""), 1):
        if arg == "":
            continue
        address = _upper(params[position - 1]["address"]) if position <= len(params) else "#%d" % position
        out[address] = _synthetic(address, arg, "%s=%s" % (address, arg))
    return out, frozenset(out)


def _after(memory: _Memory, step: Any, tracker: Any, ran: bool, result: Tuple[List[Hole], List[CycleRefusal]], end: Optional[Decimal]) -> None:
    """Where the tool stands after the line, where the tracker no longer follows it: the tool-axis
    level a cycle left (the tracker forgets it), and the plane position a repeat count under
    incremental distance left (the tracker moves the tool by one hole)."""
    after = getattr(step, "after", None) or {}
    holes, refusals = result
    if ran:
        _after_cycle(memory, step, tracker, after, holes, refusals, end)
    else:
        for read in getattr(step, "reads", None) or []:
            if read.axis in _PLANE_AXES and read.incremental is not True:
                memory.shift.pop(read.axis, None)
        for axis in _PLANE_AXES:
            if after.get(axis) is None:
                memory.shift.pop(axis, None)
        _after_line(memory, step, tracker, after.get(_TOOL_AXIS))
    if tracker.interp.active_cycle is None:
        # The cycle is cancelled (`G80`, a motion code): its drilling data with it.
        memory.words = {}
        memory.initial = None
        memory.initial_token = None


def _after_cycle(memory: _Memory, step: Any, tracker: Any, after: Dict[str, Optional[Decimal]], holes: List[Hole], refusals: List[CycleRefusal], end: Optional[Decimal]) -> None:
    if refusals:
        memory.z = None
        memory.z_token = None
        memory.shift = {}
        return
    if end is not None:
        memory.z = end
        memory.z_token = None
    if not holes:
        return
    report = tracker.report_units if tracker.report_units in ("mm", "inch") else "mm"
    last = holes[-1].end
    units = getattr(step, "units", None) or report
    for axis in _PLANE_AXES:
        where = after.get(axis)
        real = _convert(last.get(axis), units, report)
        if where is None or real is None or real == where:
            memory.shift.pop(axis, None)
        else:
            memory.shift[axis] = real - where


def _after_line(memory: _Memory, step: Any, tracker: Any, value: Optional[Decimal]) -> None:
    if value is not None:
        token = None
        for read in getattr(step, "reads", None) or []:
            if read.axis == _TOOL_AXIS and read.incremental is False and read.value is not None and read.value == value:
                token = read.token
        if token is None and memory.z == value:
            token = memory.z_token
        memory.z = value
        memory.z_token = token
        return
    if _TOOL_AXIS in (getattr(tracker, "levels", None) or ()) and memory.z is not None:
        reads = [r for r in (getattr(step, "reads", None) or []) if r.axis == _TOOL_AXIS]
        if reads:
            # T011: an increment from a level the program wrote stays on a written level.
            total: Optional[Decimal] = memory.z
            units = getattr(step, "units", None) or "mm"
            for read in reads:
                literal = getattr(read.token, "value", None)
                text, _ = tracker.readings.get(literal, "length", units) if literal is not None else (None, [])
                if read.incremental is not True or text is None or total is None:
                    total = None
                    break
                total = total + _convert(Decimal(text), units, tracker.report_units or units)  # type: ignore[operator]
            memory.z = total
            memory.z_token = None
        return
    memory.z = None
    memory.z_token = None


class _Block:
    """One block that runs a cycle, judged and worked out into holes."""

    def __init__(self, memory: _Memory, step: Any, tracker: Any, pecks: PeckValues, context: Dict[str, Any]) -> None:
        self.memory = memory
        self.step = step
        self.tracker = tracker
        self.pecks = pecks
        self.context = context
        self.interp = tracker.interp
        self.state = tracker.interp.state
        self.found: List[Tuple[str, str]] = []
        tokens = list(getattr(step, "tokens", None) or [])
        self.tokens = tokens
        self.written = _quote_text("".join(t.text for t in tokens))
        units = getattr(step, "units", None)
        if units not in ("mm", "inch"):
            units = _as_dict(self.state.get("units")).get("value")
        self.units = units if units in ("mm", "inch") else "mm"
        self.report = tracker.report_units if tracker.report_units in ("mm", "inch") else self.units

    def refuse(self, reason: str, detail: str = "") -> None:
        if (reason, detail) not in self.found:
            self.found.append((reason, detail))

    def refusals(self) -> List[CycleRefusal]:
        return [CycleRefusal(self.step.line, reason, self.written, detail) for reason, detail in self.found]

    def col(self, value: Optional[Decimal]) -> Optional[Decimal]:
        """A tracker position (report units) in the block's units."""
        return _convert(value, self.report, self.units)

    def plane(self, table: Dict[str, Optional[Decimal]], axis: str) -> Optional[Decimal]:
        """A tracker position in the plane, where the tool really stands (``_Memory.shift``), in the
        block's units."""
        value = table.get(axis)
        if value is None:
            return None
        return self.col(value + self.memory.shift.get(axis, _ZERO))

    # -- the run ------------------------------------------------------------------

    def run(self) -> Tuple[Tuple[List[Hole], List[CycleRefusal]], Optional[Decimal]]:
        try:
            holes = self.work()
        except CycleError as err:
            self.refuse(err.reason, err.detail)
            holes = []
        if self.found:
            return ([], self.refusals()), None
        end = holes[-1].end.get(_TOOL_AXIS) if holes else self.start_z
        return (holes, []), _convert(end, self.units, self.report)

    def work(self) -> List[Hole]:
        step = self.step
        interp = self.interp
        running = str(step.cycle)
        entry = interp.entry(running)
        self.entry = entry
        self.start_z: Optional[Decimal] = None
        if entry is None:
            self.refuse("no-schema", running)
            return []
        if entry.get("tapping") or entry.get("pitchFeed") or entry.get("pitchFeedAmbiguous") or _as_dict(self.state.get("block")).get("pitchFeed"):
            self.refuse("tapping", running)
            return []
        expand = expand_of(entry)
        if expand is None:
            self.refuse("no-schema", running)
            return []
        codes = _code_tokens(step, interp)
        self.codes = codes
        kind = _sets(entry).get("cycle")
        call_token = next((t for t in self.tokens if t.kind == "call" and codes.get(id(t)) is entry), None)
        calls = [(t, e) for t in self.tokens for e in [codes.get(id(t))] if e is not None and _sets(e).get("cycle") in ("call", "call-modal")]
        removed: set = set()
        own: List[Any] = []
        keep_block = False
        plane_words: List[Any] = []
        approach: Optional[str] = None
        call_code: Optional[str] = None
        written: Dict[str, Any] = {}
        lines: Dict[str, int] = {}
        if kind == "define":
            form = "define"
            defined = self.memory.defined
            if defined is None or defined[0] != str(entry.get("code")):
                self.refuse("value-missing", "the definition of %s" % running)
                return []
            written = dict(defined[2])
            lines = {address: defined[1] for address in written}
            call = calls[0] if calls else None
            call_code = str(call[1].get("code")) if call is not None else (self.interp.modal_call or None)
            if call is not None and _positions_elsewhere(call[1]):
                # Wave Y (T094, BL-NC-data): a call that runs the cycle at points of its own that
                # are not axis words (Klartext pattern cycles 220 and 221: a centre or a start
                # point and a count). Written out where the tool stands, the other points would
                # be lost.
                self.refuse("call-form", str(call[1].get("code")))
                return []
            if call is not None and _cycle_positions(call[1]):
                named = [a for a in _cycle_positions(call[1])]
                if not any(_upper(t.address) in named for t in self.tokens if t.kind == "word"):
                    # `CYCL CALL PAT`: its points are in a pattern or a table elsewhere.
                    self.refuse("call-form", str(call[1].get("code")))
                    return []
                approach = self.call_position(call, removed, own)
                if approach is None:
                    return []
            elif call is not None and call[0].kind == "keyword":
                # `CYCL CALL`: at the position the tool stands at; the call word leaves.
                removed.add(id(call[0]))
                for token in self.tokens:
                    if codes.get(id(token)) is call[1]:
                        removed.add(id(token))
                own = self.others(removed)
            else:
                # `M99`/`M89` on a positioning block, or a positioning block under `M89`: the
                # block stays, without its call word, and the hole follows it.
                keep_block = True
                if call is not None:
                    removed.add(id(call[0]))
        elif call_token is not None:
            form = "call"
            written, _ = _call_arguments(call_token, entry)
            lines = {address: step.line for address in written}
            removed.add(id(call_token))
            own = self.others(removed)
            if getattr(step, "moves", None):
                # A block with its own move and the call (`G0 X10 Y20 CYCLE81(…)`): the control
                # makes the move, then runs the cycle there. The block stays without its call and
                # the holes follow it, never one move merged with the first step (fix batch 1, NC-4).
                keep_block = True
        elif self.memory.mcall is not None and self.memory.mcall[0] == str(entry.get("code")):
            form = "call"
            written = dict(self.memory.mcall[2])
            lines = {address: self.memory.mcall[1] for address in written}
            call_code = "MCALL"
            keep_block = True
        else:
            form = "word"
            written, lines = self.word_data(entry, removed, own, plane_words)
            if self.found:
                return []
        self.form = form
        self.lines_of = lines
        roles = _roles(self.tracker, entry)
        # The variant picks the schema.
        variant = None
        if "cases" in expand:
            by = _upper(expand.get("by"))
            token = written.get(by)
            variant = token.value_text.strip() if token is not None and (token.value_text or "").strip() != "" else None
        schema = schema_for(expand, variant)
        if schema is None:
            self.refuse("variant-unknown", "%s=%s" % (_upper(expand.get("by")), variant if variant is not None else ""))
            return []
        defaults = _as_dict(schema.get("defaults"))
        words: Dict[str, Any] = {}
        for address, token in written.items():
            role = roles.get(address)
            if role is None:
                self.refuse("param-unknown", _text(token) or address)
                continue
            if role == "default":
                wanted = defaults.get(address)
                if not _at_default(token, wanted):
                    self.refuse("param-not-default", _text(token))
                continue
            if role == "variant":
                continue
            if role == "position":
                continue
            words[role] = token
        if self.found:
            return []
        self.words = words
        self.schema = schema
        retract, clearance = needs_peck_values(schema)
        if retract and self.pecks.retract is None:
            self.refuse("peck-retract-missing")
        if clearance and self.pecks.clearance is None:
            self.refuse("peck-clearance-missing")
        self.check_state(schema)
        values = self.read_values(words)
        if self.found:
            return []
        incremental = form == "word" and self.state.get("distance") == "incremental"
        positions, start_z = self.positions(form, keep_block, plane_words, incremental, values, approach is not None)
        self.start_z = start_z
        if self.found:
            return []
        # The start level: Fanuc's initial level (kept for the holes after the first, set again
        # by a block that starts the cycle again), else where the tool stands.
        if schema.get("returnBy") == "code":
            starts = any(_sets(e).get("cycle") == "start" for e in codes.values())
            if starts and self.memory.initial is not None and start_z != self.col(self.memory.initial):
                # A cycle code written while a cycle is in force, away from its initial level (after
                # a `G99` hole): the control keeps the initial level (FANUC 30i machining centre
                # manual: it stays unchanged while the drilling goes on under G99) or takes the new
                # start, which the manual does not say for a change of cycle code. Not guessed.
                self.refuse("start-unknown", "the initial level, with a cycle code written while a cycle is in force below it")
                return []
            if starts or self.memory.initial is None:
                if starts:
                    level = _convert(start_z, self.units, self.report)
                    if self.memory.initial != level or self.memory.initial_token is None:
                        self.memory.initial_token = self.level_token()
                    self.memory.initial = level
                else:
                    self.refuse("start-unknown", "the initial level")
                    return []
            start_level = self.col(self.memory.initial)
        else:
            start_level = start_z
        if self.call_shift is not None:
            values["surface"] = values["surface"] + self.call_shift
        return_mode = self.return_mode(schema)
        if self.found:
            return []
        levels = levels_of(schema, values, start_level, incremental, return_mode)  # type: ignore[arg-type]
        self.check_levels(schema, levels, values)
        if self.found:
            return []
        holes: List[Hole] = []
        z = start_z
        before = getattr(step, "before", None) or {}
        here: Dict[str, Optional[Decimal]] = {}
        for axis in _PLANE_AXES:
            # A cycle written as words or called at a point moves to its hole; any other runs
            # where the block's own move left the tool.
            here[axis] = self.plane(before, axis) if form == "word" or approach is not None else (positions[0][0].get(axis) if positions else None)
        for position, approach_to in positions:
            builder = _HoleBuilder(self, step.line, running, schema, levels, values, position, approach_to, approach, here, z)
            holes.append(builder.build())
            z = builder.cur[_TOOL_AXIS]
            here = {axis: builder.cur.get(axis) for axis in _PLANE_AXES}
        self.memory.last = CycleRead(
            line=step.line,
            code=running,
            entry=entry,
            schema=schema,
            form=form,
            words=words,
            units=self.units,
            incremental=incremental,
            distance=self.state.get("distance") if isinstance(self.state.get("distance"), str) else None,
            call=call_code,
            removed=frozenset(removed),
            own=tuple(own),
            keep_block=keep_block,
            plane_words=tuple(plane_words),
            approach=approach,
            feed=_feed_value(self.state),
            spindle=self.spindle_code(),
            level_token=self.memory.initial_token if schema.get("returnBy") == "code" else self.level_token(),
            first_line=min([step.line] + [n for n in lines.values() if isinstance(n, int)]),
        )
        return holes

    # -- what the block writes -------------------------------------------------------

    call_shift: Optional[Decimal] = None

    def others(self, removed: set) -> List[Any]:
        """The significant tokens of the block that stay (not the block number, not removed)."""
        return [t for t in self.tokens if id(t) not in removed and t.kind not in ("whitespace", "blockNumber", "continuation")]

    def word_data(self, entry: Dict[str, Any], removed: set, own: List[Any], plane_words: List[Any]) -> Tuple[Dict[str, Any], Dict[str, int]]:
        """A cycle written as words (Fanuc): the block's parameter words over the drilling data
        in force (it stays until the cycle is cancelled, the repeat count excepted)."""
        params = {_upper(p["address"]) for p in _params(entry)}
        # The manual-check round (D1-2, 2026-10-25): besides the codes, the block number and the
        # cycle's own parameters, a cycle block may carry only an M, S, T or F word. Any other
        # address word is a value gEdit does not read: an axis of another plane, a parameter of
        # another cycle, the small-hole peck `I`, the clearance `,D` of G73/G83 (0i-F Plus and
        # newer; D1-1: never left on a rapid line, the form's value never used in its place).
        addresses = _as_dict(getattr(self.tracker, "profile", None)).get("addresses")
        allowed = {"G", "M", "S", "T", "F"} | {_upper(_as_dict(addresses).get(k)) for k in ("tool", "feed", "spindle")}
        allowed.discard("")
        roles = _roles(self.tracker, entry)
        # The words of a code the block is refused for below (`G43 H2`) are no second refusal.
        covered = {
            _upper(p["address"])
            for e in (self.codes.get(id(t)) for t in self.tokens)
            if e is not None and _sets(e).get("cycle") != "start" and (e.get("group") == "motion" or _sets(e).get("lengthComp"))
            for p in _params(e)
        }
        block: Dict[str, Any] = {}
        for token in self.tokens:
            entry_of = self.codes.get(id(token))
            if entry_of is not None:
                if _sets(entry_of).get("cycle") == "start":
                    removed.add(id(token))
                elif entry_of.get("group") == "motion":
                    # A motion code and a drilling cycle in one block: the control cancels the
                    # cycle (FANUC 30i machining centre manual, the canned cycles), whatever the
                    # order of the two.
                    self.refuse("param-unknown", "%s, a motion code in the cycle block" % _text(token))
                elif _sets(entry_of).get("lengthComp"):
                    # Fix batch 1 (NC-16): a tool length offset taken in the cycle block shifts the
                    # levels the control drills to by the offset, which gEdit does not know.
                    self.refuse("param-unknown", "%s, a tool length offset code in the cycle block" % _text(token))
                else:
                    own.append(token)
                continue
            if token.kind in ("whitespace", "blockNumber", "continuation"):
                continue
            if token.kind != "word" or not token.address:
                own.append(token)
                continue
            address = _upper(token.address)
            if address in params:
                removed.add(id(token))
                block[address] = token
                if roles.get(address) == "position":
                    plane_words.append(token)
                continue
            if address not in allowed:
                if address in covered:
                    continue
                if address == ",D" and "peck" in roles.values():
                    self.refuse("param-unknown", "%s, the peck clearance written in the cycle block, which gEdit does not read yet" % _text(token))
                else:
                    self.refuse("param-unknown", _text(token))
                continue
            own.append(token)
        data = {a: v for a, v in self.memory.words.items()}
        for address, token in block.items():
            data[address] = (token, self.step.line)
        self.memory.words = {a: v for a, v in data.items() if roles.get(a) not in _ONE_BLOCK_ROLES and roles.get(a) != "position"}
        # Data another cycle code left (a `Q` under `G82`) is no value of this cycle: it is kept for
        # the cycle that reads it and plays no part here.
        words = {a: v[0] for a, v in data.items() if a in params and (roles.get(a) != "position" or a in block)}
        lines = {a: v[1] for a, v in data.items() if a in words}
        return words, lines

    def call_position(self, call: Tuple[Any, Dict[str, Any]], removed: set, own: List[Any]) -> Optional[str]:
        """``CYCL CALL POS X… Y… Z…`` (TNC 640 cycle manual, cycle call with CYCL CALL POS): the
        point is in the plane, its tool-axis value shifts the surface of the cycle; the tool goes
        there in the plane first (the call's feed: ``FMAX`` or ``F``) while it stands above the
        surface, otherwise the control goes to a safe height first, a value the cycle does not
        give: refused (``call-form``). Returns the approach (``'rapid'``, the feed word, ``''``)."""
        token, entry = call
        named = _cycle_positions(entry)
        rapid = _upper(_as_dict(self.tracker.profile.get("addresses")).get("rapid"))
        feed_address = _upper(_as_dict(self.tracker.profile.get("addresses")).get("feed")) or "F"
        removed.add(id(token))
        for other in self.tokens:
            if self.codes.get(id(other)) is entry:
                removed.add(id(other))
        point: Dict[str, Any] = {}
        approach = ""
        for other in self.tokens:
            if other.kind == "keyword" and rapid and "".join((other.text or "").split()).upper() == rapid:
                approach = "rapid"
                removed.add(id(other))
                continue
            if other.kind != "word" or not other.address or id(other) in removed:
                continue
            address = _upper(other.address)
            if address in named:
                if other.incremental:
                    self.refuse("call-form", "%s, an incremental position" % _text(other))
                point[address] = other
                removed.add(id(other))
            elif address == feed_address and approach != "rapid":
                approach = _text(other)
                removed.add(id(other))
        own.extend(self.others(removed))
        missing = [a for a in (_PLANE_AXES + (_TOOL_AXIS,)) if a not in point]
        if missing:
            self.refuse("call-form", "%s without %s" % (str(entry.get("code")), "".join(missing)))
            return None
        self.call_point = point
        return approach

    call_point: Dict[str, Any] = {}

    # -- the values -----------------------------------------------------------------

    def read_values(self, words: Dict[str, Any]) -> Dict[str, Decimal]:
        """The values of the roles, read on the machine (a length) or as written (a count)."""
        values: Dict[str, Decimal] = {}
        #: A feed-out written as 0 where the schema gives 0 a meaning (``feedOutZero``).
        zero_out: Optional[str] = None
        for role, token in words.items():
            literal = getattr(token, "value", None)
            if literal is None:
                self.refuse("expression", _text(token))
                continue
            if role in LENGTH_ROLES:
                text, _ = self.tracker.readings.get(literal, "length", self.units)
                if text is None:
                    self.refuse("machine-dependent", _text(token))
                    continue
                values[role] = Decimal(text)
            elif role in _COUNT_ROLES:
                number = _whole(_decimal(literal))
                if number is None or number < 0:
                    self.refuse("value-missing", "%s, not a whole number of 0 or more" % _text(token))
                    continue
                if role == "repeat" and number > MAX_REPEAT:
                    # Fix batch 1 (CODE-1): a count nobody meant, never millions of holes.
                    self.refuse("value-missing", "%s, more than %d repeats" % (_text(token), MAX_REPEAT))
                    continue
                values[role] = Decimal(number)
            elif role in ("feed", "feed-out"):
                number = _decimal(literal)
                if role == "feed-out" and number == _ZERO and self.schema.get("feedOutZero") in FEED_OUT_ZERO:
                    # 0 means another feed where the manual says so (Klartext 201 Q208=0: out at
                    # the plunging feed Q206, TNC 640 cycles manual 10/2017 §3.4; the owner,
                    # 2026-10-20): the schema's ``feedOutZero`` names it (plan §6.3 rule 3).
                    zero_out = str(self.schema.get("feedOutZero"))
                    continue
                if number is None or number <= _ZERO:
                    # Any other feed of 0 or less moves nothing: refused, never guessed.
                    self.refuse("value-missing", "%s, a feed of 0 or less" % _text(token))
                    continue
                values[role] = number
            else:
                number = _decimal(literal)
                if number is None:
                    self.refuse("expression", _text(token))
                    continue
                values[role] = number
        if zero_out is not None:
            # The moves at the feed-out run at the named feed: its word as written (``Q206``
            # written as ``F``), or, where the block leaves it out, the feed in force.
            if zero_out in words:
                words["feed-out"] = words[zero_out]
                if zero_out in values:
                    values["feed-out"] = values[zero_out]
            else:
                words.pop("feed-out", None)
        if "first-peck-relative" in values:
            relative = values["first-peck-relative"]
            if relative != _ZERO or "first-peck" not in values:
                surface = values.get("surface")
                mode = self.schema.get("relativeDepth")
                if surface is None or mode not in ("signed", "into-material"):
                    self.refuse("value-missing", "the surface the first peck is measured from")
                elif mode == "signed":
                    values["first-peck"] = surface + relative
                else:
                    if relative < _ZERO:
                        self.refuse("depth-direction", "a relative first peck below 0")
                    values["first-peck"] = surface - relative
        return values

    def check_state(self, schema: Dict[str, Any]) -> None:
        """The modal state the cycle runs in (plan §6.3 rule 9)."""
        state = self.state
        comp = self.memory.comp_on is True
        for value in _as_dict(state.get("groups")).values():
            code = _as_dict(value).get("code")
            if isinstance(code, str) and _sets(self.interp.entry(code)).get("radiusComp") == "on":
                comp = True
        if comp:
            self.refuse("radius-comp")
        if state.get("plane") != _PLANE:
            plane = state.get("plane")
            self.refuse("plane", plane if isinstance(plane, str) else "not known")
        frame = self.interp.frame
        if frame is not None:
            self.refuse("frame", "%s (line %s)" % (frame.get("code"), frame.get("line")))
        groups = _database(self.tracker)["distance"]
        if groups:
            distance = state.get("distance")
            if distance not in ("absolute", "incremental") or any(_assumed(v) for v in _group_state(state, groups)):
                self.refuse("distance-assumed")

    def return_mode(self, schema: Dict[str, Any]) -> Optional[str]:
        """``CodeSets.cycleReturn`` of the code in force (``returnBy: 'code'``); the owner's answer
        of 2026-10-19: one neither the program nor the machine's power-on modes set refuses."""
        if schema.get("returnBy") != "code":
            return None
        groups = _database(self.tracker)["return"]
        for value in _group_state(self.state, groups):
            if _assumed(value):
                continue
            mode = cycle_return_of(self.interp.entry(str(value.get("code") or "")))
            if mode is not None:
                return mode
        self.refuse("return-assumed")
        return None

    def check_levels(self, schema: Dict[str, Any], levels: Dict[str, Decimal], values: Dict[str, Decimal]) -> None:
        """Every level a step goes to, and the values the steps take, are there."""
        for item in schema.get("steps") or []:
            step = _as_dict(item)
            kind = step.get("step")
            if kind in ("rapid", "feed"):
                level = step.get("to")
                if level not in levels:
                    self.refuse("value-missing", _level_words(level))
            elif kind == "pecks":
                if "depth" not in levels:
                    self.refuse("value-missing", _level_words("depth"))
                if step.get("mode") in ("full-retract", "universal") and step.get("back") not in levels:
                    self.refuse("value-missing", _level_words(step.get("back")))
                if step.get("mode") == "universal" and "chip-breaks" not in values:
                    self.refuse("value-missing", "the number of chip breaks")
            elif kind == "orient" and "orient-angle" not in self.words:
                self.refuse("value-missing", "the angle of the oriented stop")
            elif kind == "spindle-restore" and self.spindle_code() is None:
                self.refuse("value-missing", "the spindle direction in force")
        # Fix batch 1 (NC-3): no rapid of the cycle ends below the surface, before the feed or
        # after it (a set-up clearance, an R point or a return level under the surface).
        surface = values.get("surface")
        if surface is not None:
            for item in schema.get("steps") or []:
                step = _as_dict(item)
                level = step.get("to") if step.get("step") == "rapid" else step.get("back") if step.get("step") == "pecks" else None
                if isinstance(level, str) and level in levels and levels[level] < surface:
                    self.refuse("value-missing", "%s below the surface" % _level_words(level))
        restores = any(_as_dict(item).get("step") == "spindle-restore" for item in schema.get("steps") or [])
        direction = self.words.get("spindle-direction")
        directed = "spindle-direction" in _roles(self.tracker, self.entry).values()
        if restores and directed and direction is None:
            # Fix batch 1 (NC-9): SINUMERIK CYCLE86 without SDIR alarms on the control.
            address = next((a for a, r in _roles(self.tracker, self.entry).items() if r == "spindle-direction"), "")
            self.refuse("value-missing", "the spindle direction %s" % address if address else "the spindle direction")
        if restores and not directed:
            # Fix batch 1 (owner's question Q2): a cycle that stops the spindle and starts it again
            # without a direction of its own (FANUC G86) is written out under the clockwise
            # spindle code only (number 3, as `SDIR=3` names `M3`): the manual does not say the
            # spindle restarts the other way.
            code = self.spindle_code()
            digits = "".join(ch for ch in (code or "") if ch.isdigit())
            if code is not None and (digits == "" or int(digits) != 3):
                self.refuse("variant-unknown", "%s in force" % code)
        if direction is not None:
            code = self.spindle_code()
            number = _whole(_decimal(getattr(direction, "value", None)))
            digits = "".join(ch for ch in (code or "") if ch.isdigit())
            if code is None or number is None or digits == "" or int(digits) != number:
                self.refuse("param-not-default", _text(direction))

    def spindle_code(self) -> Optional[str]:
        value = _as_dict(_as_dict(self.state.get("groups")).get("spindle")).get("code")
        entry = self.interp.entry(value) if isinstance(value, str) else None
        return str(entry.get("code")) if entry is not None and _sets(entry).get("spindle") == "on" else None

    def level_token(self) -> Any:
        return self.memory.z_token

    # -- where the holes are ----------------------------------------------------------

    def tool_level(self) -> Optional[Decimal]:
        """Where the tool stands on the tool axis when the block starts (block units)."""
        before = getattr(self.step, "before", None) or {}
        value = before.get(_TOOL_AXIS)
        if value is None and _TOOL_AXIS in (getattr(self.step, "levels", None) or ()):
            value = self.memory.z
        return self.col(value)

    def positions(self, form: str, keep_block: bool, plane_words: List[Any], incremental: bool, values: Dict[str, Decimal], called_at: bool) -> Tuple[List[Tuple[Dict[str, Decimal], Optional[Dict[str, Decimal]]]], Optional[Decimal]]:
        """``[(the hole's position, where the block's own move to it goes)]`` and the tool-axis
        level the first hole starts from."""
        step = self.step
        before = getattr(step, "before", None) or {}
        after = getattr(step, "after", None) or {}
        reads = {r.axis: r for r in (getattr(step, "reads", None) or []) if r.axis in _PLANE_AXES + (_TOOL_AXIS,)}
        z = self.tool_level()
        out: List[Tuple[Dict[str, Decimal], Optional[Dict[str, Decimal]]]] = []
        if called_at:
            point: Dict[str, Decimal] = {}
            for axis, token in self.call_point.items():
                literal = getattr(token, "value", None)
                if literal is None:
                    self.refuse("expression", _text(token))
                    continue
                text, _ = self.tracker.readings.get(literal, "length", self.units)
                if text is None:
                    self.refuse("machine-dependent", _text(token))
                    continue
                point[axis] = Decimal(text)
            if self.found:
                return [], z
            if z is None:
                self.refuse("start-unknown", _TOOL_AXIS)
                return [], z
            surface = values.get("surface")
            if surface is None:
                self.refuse("call-form", "a cycle without a surface")
                return [], z
            shift = point[_TOOL_AXIS]
            if not (z > surface and z > surface + shift):
                self.refuse("call-form", "the tool stands below the surface; the control goes to a safe height first")
                return [], z
            self.call_shift = shift
            target = {a: point[a] for a in _PLANE_AXES}
            return [(target, dict(target))], z
        if form == "word":
            # The block's own position words: absolute targets, or increments from where the tool
            # stands (a repeat count repeats the increment).
            count = 1
            if "repeat" in self.words:
                count = int(values.get("repeat", Decimal(1)))
            if count == 0 and plane_words:
                # Fix batch 1 (the owner's question Q1): a repeat count of 0 stores the drilling
                # data and drills nothing; whether the control still moves to the position written
                # with it, the manual does not say. Not guessed.
                self.refuse("call-form", "%s with a position in the same block" % _text(self.words["repeat"]))
                return [], z
            first: Dict[str, Decimal] = {}
            step_by: Dict[str, Decimal] = {}
            for axis in _PLANE_AXES:
                read = reads.get(axis)
                base = self.plane(before, axis)
                if read is not None and any(read.token is t for t in plane_words):
                    if read.value is None:
                        self.refuse(_unknown_reason(read.unknown), _text(read.token))
                        continue
                    target = self.plane({axis: read.value}, axis) if (incremental or read.incremental) else self.col(read.value)
                    first[axis] = target  # type: ignore[assignment]
                    if incremental or read.incremental:
                        if base is None:
                            self.refuse("start-unknown", axis)
                            continue
                        step_by[axis] = target - base  # type: ignore[operator]
                elif base is None:
                    self.refuse("start-unknown", axis)
                else:
                    first[axis] = base
            if z is None:
                self.refuse("start-unknown", _TOOL_AXIS)
            if self.found:
                return [], z
            for i in range(count):
                position = {a: first[a] + step_by.get(a, _ZERO) * i for a in _PLANE_AXES}
                out.append((position, None))
            return out, z
        # A positioning block that runs the cycle after its own move, or a call that runs it where
        # the tool stands.
        position = {}
        for axis in _PLANE_AXES:
            value = self.plane(after, axis)
            if value is None:
                self.refuse("start-unknown", axis)
            else:
                position[axis] = value
        read = reads.get(_TOOL_AXIS)
        if keep_block and read is not None:
            if read.value is None:
                self.refuse(_unknown_reason(read.unknown), _text(read.token))
            else:
                z = self.col(read.value)
        if z is None:
            self.refuse("start-unknown", _TOOL_AXIS)
        if self.found:
            return [], z
        return [(position, None)], z


def _cycle_positions(entry: Dict[str, Any]) -> List[str]:
    """The axis-named positions of a call (`CYCL CALL POS X Y Z`, `position: 'other'`)."""
    return [_upper(p["address"]) for p in _params(entry) if gedit_nc.position_of(p) == "other" and _upper(p["address"]) in _PLANE_AXES + (_TOOL_AXIS,)]


def _positions_elsewhere(entry: Any) -> List[str]:
    """Wave Y (T094): the positions of a call that are not axis words (`position: 'other'` on a
    parameter such as the centre `Q216` of Klartext cycle 220): the call runs the cycle at points
    of its own, which no plain move written here can stand for."""
    return [_upper(p["address"]) for p in _params(entry) if gedit_nc.position_of(p) == "other" and _upper(p["address"]) not in _PLANE_AXES + (_TOOL_AXIS,)]


def _unknown_reason(kind: Optional[str]) -> str:
    """The refusal of a position word the tracker could not read (``WordRead.unknown``)."""
    if kind == "expression":
        return "expression"
    if kind in ("machine-dependent", "diameter-unknown"):
        return "machine-dependent"
    if kind == "distance-unknown":
        return "distance-assumed"
    if kind == "frame":
        return "frame"
    return "start-unknown"


def default_values(wanted: Any) -> List[str]:
    """The values ``ExpandSchema.defaults`` gives one ``'default'`` parameter: one value, or the
    list of values the manuals prove equivalent (the owner, 2026-10-20; plan §6.3 rule 1)."""
    if isinstance(wanted, str):
        return [wanted.strip()]
    if isinstance(wanted, (list, tuple)):
        return [v.strip() for v in wanted if isinstance(v, str) and v.strip() != ""]
    return []


def at_default(text: Optional[str], wanted: Any) -> bool:
    """A ``'default'`` parameter written as ``text`` is at an understood value: empty or left out,
    or equal as a number (``Q211=0.0``, ``Q395=+0``) or as written to one of its defaults."""
    text = (text or "").strip()
    if text == "":
        return True
    a = gedit_nc.decimal_of(text)
    for value in default_values(wanted):
        if text == value:
            return True
        b = gedit_nc.decimal_of(value)
        if a is not None and b is not None and a == b:
            return True
    return False


def _at_default(token: Any, wanted: Any) -> bool:
    """A ``'default'`` parameter token at an understood value (:func:`at_default`)."""
    return at_default(getattr(token, "value_text", None), wanted)


def _feed_value(state: Dict[str, Any]) -> Optional[str]:
    feed = _as_dict(state.get("feed"))
    text = feed.get("valueText")
    return text if isinstance(text, str) and text != "" and feed.get("variable") is not True else None


def _level_words(level: Any) -> str:
    return {
        "r-plane": "the R point",
        "clearance": "the surface and the set-up clearance",
        "depth": "the depth",
        "return": "the return level",
        "start": "the start level",
    }.get(level if isinstance(level, str) else "", "a level of the cycle")


def _quote_text(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= 80 else text[:79].rstrip() + "…"


class _HoleBuilder:
    """The moves of one hole, from where the tool stands, step by step (plan §6.3 "Steps")."""

    def __init__(self, block: _Block, line: int, code: str, schema: Dict[str, Any], levels: Dict[str, Decimal], values: Dict[str, Decimal], position: Dict[str, Decimal], approach_to: Optional[Dict[str, Decimal]], approach: Optional[str], here: Dict[str, Optional[Decimal]], z: Optional[Decimal]) -> None:
        self.block = block
        self.line = line
        self.code = code
        self.schema = schema
        self.levels = levels
        self.values = values
        self.position = position
        self.approach_to = approach_to
        self.approach = approach
        self.cur: Dict[str, Optional[Decimal]] = dict(here)
        self.cur[_TOOL_AXIS] = z
        self.moves: List[HoleMove] = []
        #: Where each tool-axis rapid started, to merge two that go the same way.
        self._from: List[Optional[Decimal]] = []
        self.lifted: List[Dict[str, Decimal]] = []

    def build(self) -> Hole:
        start = self.cur[_TOOL_AXIS]
        if self.approach_to is not None:
            if self.approach == "rapid":
                self.add(HoleMove("rapid", dict(self.approach_to)), plane=True)
            else:
                self.add(HoleMove("feed", dict(self.approach_to), feed=self.approach or None), plane=True)
        else:
            changed = {a: v for a, v in self.position.items() if self.cur.get(a) != v}
            if changed:
                self.add(HoleMove("rapid", changed), plane=True)
        for index, item in enumerate(self.schema.get("steps") or []):
            self.step(index, _as_dict(item))
        return Hole(
            line=self.line,
            code=self.code,
            kind=str(self.schema.get("kind")),
            position=dict(self.position),
            start=start,  # type: ignore[arg-type]
            levels=dict(self.levels),
            moves=list(self.moves),
            end={a: v for a, v in self.cur.items() if v is not None},
        )

    def add(self, move: HoleMove, plane: bool = False) -> None:
        if plane:
            for axis, value in move.to.items():
                self.cur[axis] = value
            self.moves.append(move)
            self._from.append(None)
            return
        if move.kind in ("rapid", "feed") and set(move.to) == {_TOOL_AXIS}:
            here = self.cur[_TOOL_AXIS]
            there = move.to[_TOOL_AXIS]
            if here == there:
                return
            last = self.moves[-1] if self.moves else None
            origin = self._from[-1] if self._from else None
            if move.kind == "rapid" and last is not None and last.kind == "rapid" and set(last.to) == {_TOOL_AXIS} and origin is not None and here is not None:
                if (here - origin) * (there - here) > 0:
                    # Two rapids along the tool axis the same way are one move.
                    self.moves[-1] = last._replace(to={_TOOL_AXIS: there})
                    self.cur[_TOOL_AXIS] = there
                    return
            self.moves.append(move)
            self._from.append(here)
            self.cur[_TOOL_AXIS] = there
            return
        for axis, value in move.to.items():
            self.cur[axis] = value
        self.moves.append(move)
        self._from.append(None)

    def feed_text(self, role: str) -> Optional[str]:
        token = self.block.words.get(role)
        if token is None:
            return None
        address = _upper(_as_dict(self.block.tracker.profile.get("addresses")).get("feed")) or "F"
        if _upper(token.address) == address:
            return _text(token)
        return "%s%s" % (address, (token.value_text or "").strip())

    def value_of(self, item: Any, what: str) -> Decimal:
        """A step value: a role's value or one of the form's peck values (Q4-9)."""
        source = _as_dict(item)
        if "form" in source:
            found = self.block.pecks.retract if source["form"] == "peckRetract" else self.block.pecks.clearance
            if found is None:
                raise CycleError("peck-retract-missing" if source["form"] == "peckRetract" else "peck-clearance-missing")
            return Decimal(found)
        role = source.get("role")
        if role in self.values:
            return self.values[role]
        raise CycleError("value-missing", what)

    def step(self, index: int, item: Dict[str, Any]) -> None:
        kind = item.get("step")
        z = self.cur[_TOOL_AXIS]
        if kind == "rapid":
            level = self.levels[str(item.get("to"))]
            if item.get("to") == "return" and z is not None and not level > z:
                return
            self.add(HoleMove("rapid", {_TOOL_AXIS: level}, step=index))
        elif kind == "feed":
            level = self.levels[str(item.get("to"))]
            if item.get("to") == "depth":
                self.check_direction()
            role = "feed-out" if item.get("feed") == "feed-out" else "feed"
            self.add(HoleMove("feed", {_TOOL_AXIS: level}, feed=self.feed_text(role), feed_role=role, step=index))
        elif kind == "pecks":
            self.pecks(index, item)
        elif kind == "dwell":
            self.dwell(index, "dwell" if item.get("at") != "top" else "dwell-top")
        elif kind == "spindle-stop":
            self.add(HoleMove("spindle-stop", {}, step=index))
        elif kind == "spindle-restore":
            self.add(HoleMove("spindle-restore", {}, step=index))
        elif kind == "orient":
            self.add(HoleMove("orient", {}, step=index))
        elif kind == "lift-off":
            self.lift_off(index, bool(item.get("back")))
        else:
            raise CycleError("no-schema", "a step gEdit does not know")

    def check_direction(self) -> None:
        z = self.cur[_TOOL_AXIS]
        depth = self.levels.get("depth")
        if z is None or depth is None or not depth < z:
            raise CycleError("depth-direction")

    def dwell(self, index: int, role: str) -> None:
        token = self.block.words.get(role)
        if token is None:
            return
        number = _decimal(getattr(token, "value", None))
        if number is None or number == _ZERO:
            return
        unit = None
        for param in _params(self.block.entry):
            if _upper(param.get("address")) == _upper(token.address):
                unit = param.get("unit")
        seconds = number if unit != "count" and number > _ZERO else None
        self.add(HoleMove("dwell", {}, seconds=seconds, dwell=_text(token), step=index))

    def pecks(self, index: int, item: Dict[str, Any]) -> None:
        self.check_direction()
        start = self.cur[_TOOL_AXIS]
        depth = self.levels["depth"]
        bottoms = peck_bottoms(start, depth, self.values, item)  # type: ignore[arg-type]
        mode = item.get("mode")
        breaks = int(self.values.get("chip-breaks", _ZERO))
        count = 0
        retract_at = item.get("retractAt")
        for k, bottom in enumerate(bottoms):
            if k > 0:
                previous = bottoms[k - 1]
                kind = mode
                if mode == "universal":
                    if count < breaks:
                        kind = "chip-break"
                        count += 1
                    else:
                        kind = "full-retract"
                        count = 0
                if kind == "chip-break":
                    retract = self.value_of(item.get("retract"), "the retract of a chip break")
                    if retract < _ZERO:
                        raise CycleError("value-missing", "a chip-break retract below 0")
                    if retract > _ZERO:
                        if retract_at == "feed-out":
                            self.add(HoleMove("feed", {_TOOL_AXIS: previous + retract}, feed=self.feed_text("feed-out"), feed_role="feed-out", step=index))
                        else:
                            self.add(HoleMove("rapid", {_TOOL_AXIS: previous + retract}, step=index))
                else:
                    back = self.levels[str(item.get("back"))]
                    self.add(HoleMove("rapid", {_TOOL_AXIS: back}, step=index))
                    self.dwell(index, "dwell-top")
                    reentry = self.value_of(item.get("reentry"), "the distance above the last bottom the tool comes back down to")
                    if reentry <= _ZERO:
                        raise CycleError("value-missing", "a re-entry distance that is not above the last bottom")
                    if not previous + reentry < back:
                        raise CycleError("value-missing", "a re-entry distance that reaches the retract level")
                    self.add(HoleMove("rapid", {_TOOL_AXIS: previous + reentry}, step=index))
            self.add(HoleMove("feed", {_TOOL_AXIS: bottom}, feed=self.feed_text("feed"), feed_role="feed", step=index))

    def lift_off(self, index: int, back: bool) -> None:
        if back:
            if not self.lifted:
                return
            moved = self.lifted.pop()
            # Back in the plane only (fix batch 1, NC-5): the tool has gone up along the tool axis
            # since the lift-off, and going back along it would take the stopped tool back into
            # the bore (SINUMERIK CYCLE86: RPA and RPO back, RPAP not).
            target = {a: self.cur[a] - v for a, v in moved.items() if a in _PLANE_AXES and self.cur.get(a) is not None and v != _ZERO}  # type: ignore[operator]
        else:
            moved = {}
            for role, axis in (("lift-off-first", _PLANE_AXES[0]), ("lift-off-second", _PLANE_AXES[1]), ("lift-off-axis", _TOOL_AXIS)):
                if role in self.block.words:
                    moved[axis] = self.values.get(role, _ZERO)
            self.lifted.append(moved)
            target = {a: self.cur[a] + v for a, v in moved.items() if self.cur.get(a) is not None and v != _ZERO}  # type: ignore[operator]
        if target:
            self.add(HoleMove("rapid", target, step=index))
