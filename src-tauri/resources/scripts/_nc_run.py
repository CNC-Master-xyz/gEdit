"""The run of the transforms: what every script that rewrites a program shares (Phase 4 plan
§5 P4b, the prelude; TODO CODE-6, triage T014).

``translate.py``, ``rotate.py`` and ``mirror.py`` carried their run three times: rotate and
mirror one engine of some 800 lines, word for word (a test held the two copies equal), and
translate a third with the same small helpers. The P4b prelude moved them here **without
changing one byte of what any of them writes**; the expansion of the drilling cycles
(``expand_cycles.py``, P4.7) and the time estimate (``time_estimate.py``, P4.9) start from the same
frame. A helper module **above** ``gedit_nc``, like ``_nc_path`` and ``_nc_geom`` (plan §7
#292): it imports them, and ``gedit_nc`` never imports it. Standard library only, Python 3.9.

Two parts:

1. **The frame** (every rewriting script): the form and context checks of ``main``
   (:func:`prepare`), the scope of the run and the lines above a selection (:func:`scope_of`),
   the refusal of a selection whose lines above were not sent (:func:`unprimed_envelope`), the
   machine sentence that ends every message (:func:`machine_note`), the edits written into a
   line (:func:`splice`), and the small text helpers.
2. **The plane run** of rotate and mirror (:class:`PlaneRun`, :func:`plane_main`): one walk
   with the path tracker, every block judged with ``_nc_geom`` and rewritten in memory, the
   arc check after rounding, the findings and the message. The two scripts keep their form
   (``Params``), their name and the text of their own refusal (``RUN_REASONS``) and hand them
   to :func:`plane_main`.

Translate keeps its own walk (its selection start adds words, its findings are per line and
its cap is 500): it uses the frame only. Address arithmetic is an M10 script on ``gedit_nc``
alone and does not import this module (it would load the geometry modules for three small
helpers it has its own copies of).
"""

from __future__ import annotations

import sys
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Dict, List, NamedTuple, Optional, Sequence, Tuple, Union

import gedit_nc
import _nc_geom
import _nc_path

# ===========================================================================
# 1. The frame
# ===========================================================================

_ZERO = Decimal(0)
#: One inch in millimetres, exactly.
INCH = Decimal("25.4")
QUOTE_LENGTH = _nc_geom.QUOTE_LENGTH


def as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def trim(value: Decimal) -> str:
    """A number as the message shows it: ``90``, ``-12.5``, ``0``; never in exponent form."""
    if value == _ZERO:
        return "0"
    text = format(value.normalize(), "f")
    return text


def count_text(count: int, singular: str, plural: Optional[str] = None) -> str:
    return "%s %s" % ("{:,}".format(count), singular if count == 1 else (plural or singular + "s"))


def quote(text: str) -> str:
    """A block or a word as written, its runs of blanks made one, cut to a length a finding
    can carry."""
    text = " ".join(text.split())
    return text if len(text) <= QUOTE_LENGTH else text[: QUOTE_LENGTH - 1].rstrip() + "…"


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
    """The parameter rows of a database entry (``CodeEntry.params``), the malformed left out."""
    params = entry.get("params") if isinstance(entry, dict) else None
    return [p for p in params if isinstance(p, dict)] if isinstance(params, list) else []


def splice(text: str, edits: Sequence[Tuple[int, int, str]]) -> str:
    """``text`` with every ``(start, end, new)`` edit written in, in the order of their
    starts; the edits do not overlap (each is one token, or an insertion beside one)."""
    parts: List[str] = []
    at = 0
    for start, end, new in sorted(edits):
        parts.append(text[at:start])
        parts.append(new)
        at = end
    parts.append(text[at:])
    return "".join(parts)


class Scope(NamedTuple):
    """What the run is over (``context.input``): its first line, whether it is a selection,
    whether that selection starts below line 1 (then the lines above it prime the walk), and
    those lines (``gedit_nc.preceding_lines``; empty when the app did not send them)."""

    first: int
    selection: bool
    fragment: bool
    preceding: List[str]


def scope_of(context: Dict[str, Any]) -> Scope:
    scope = as_dict(context.get("input"))
    start = scope.get("startLine")
    first = start if isinstance(start, int) and not isinstance(start, bool) and start >= 1 else 1
    selection = scope.get("scope") == "selection"
    fragment = selection and first > 1
    preceding = gedit_nc.preceding_lines(context) if fragment else []
    return Scope(first, selection, fragment, preceding)


class Setup(NamedTuple):
    """What :func:`prepare` hands a script's ``main``: the context, the input lines and their
    text, the profile and its compiled form, the checked form and the code database (``[]``
    when the run has none; the script says what that means for it)."""

    context: Dict[str, Any]
    lines: List[str]
    text: str
    profile: Dict[str, Any]
    cp: Any
    params: Any
    codes: List[Any]


def prepare(script: str, params_class: Any, errors: Tuple[type, ...] = (ValueError, ArithmeticError)) -> Union[int, Setup]:
    """The checks every rewriting script makes before it reads a block: the profile, its
    compiled form and the form (``params_class(values, profile)``, which raises one of
    ``errors`` with the plain text of what is wrong). A failure is printed to stderr with the
    script's name and the exit code 1 is returned; otherwise the :class:`Setup`."""
    context = gedit_nc.load_context()
    lines = gedit_nc.read_input()
    profile = context.get("profile")
    if not isinstance(profile, dict) or not profile:
        print("%s needs a dialect profile. Run it from gEdit, which puts the profile into the script context." % script, file=sys.stderr)
        return 1
    try:
        cp = gedit_nc.compile_profile(profile)
    except ValueError as err:
        print("%s cannot use this profile: %s" % (script, err), file=sys.stderr)
        return 1
    try:
        params = params_class(as_dict(context.get("params")), profile)
    except errors as err:
        print("%s: %s" % (script, err), file=sys.stderr)
        return 1
    codes = context.get("codes") if isinstance(context.get("codes"), list) else []
    return Setup(context, lines, "\n".join(lines), profile, cp, params, codes)


#: The machine sentence without a machine.
NO_MACHINE = "No machine chosen: a word whose reading depends on the machine would refuse the run."
#: A machine whose number reading was not set on its page.
NO_NUMBER_INPUT = "it does not say how it reads numbers, so a word whose reading depends on that would refuse the run"


def number_reading(params: Dict[str, Any], inch: bool) -> Optional[str]:
    """How the machine reads a length written without a point, in words, or ``None`` when its
    number input says nothing the message can name (``params``: ``EffectiveMachine.params``)."""
    number_input = as_dict(params.get("numberInput"))
    length = as_dict(as_dict(number_input.get("classes")).get("length"))
    mode = length.get("mode") or number_input.get("mode")
    unit = length.get("incrementInch" if inch else "increment") or number_input.get("incrementInch" if inch else "incrementMm")
    unit_name = "inch" if inch else "mm"
    if mode == "increment" and isinstance(unit, str):
        return "numbers without a point are increments of %s %s" % (unit, unit_name)
    if mode == "scale" and isinstance(unit, str):
        return "every number counts in units of %s %s, with or without a point" % (unit, unit_name)
    if mode == "calculator":
        return "numbers are read as written"
    return None


def machine_note(machine: Dict[str, Any], x_reading: Optional[str] = None, fallback: Optional[str] = None) -> str:
    """The machine, always the last sentence of the message (README, "The message"):
    ``machine`` is ``gedit_nc.machine_params(context)``; ``x_reading`` adds how a turning
    program's X is meant (translate); ``fallback`` is said when the number reading has no
    words of its own (rotate and mirror: "numbers are read as written")."""
    if machine.get("id") is None:
        return NO_MACHINE
    name = machine.get("name") or machine.get("id")
    params = as_dict(machine.get("params"))
    parts: List[str] = []
    if as_dict(machine.get("source")).get("numberInput") == "machine":
        how = number_reading(params, params.get("units") == "inch") or fallback
        if how:
            parts.append(how)
    else:
        parts.append(NO_NUMBER_INPUT)
    if x_reading is not None:
        parts.append("X is a %s" % x_reading)
    return "Machine '%s': %s." % (name, "; ".join(parts))


def unprimed_envelope(text: str, first: int, script: str, note: str, in_force: str, verb: str) -> None:
    """The run of a selection whose lines above were not sent (the app leaves them out when
    the text above is too large): what is in force there decides how every word is read, so
    nothing is changed (``selection-unprimed``). ``in_force`` names what is not known ("the
    distance mode, the units, a frame and a cycle"), ``verb`` what did not happen ("moved")."""
    gedit_nc.envelope(
        text,
        "Nothing was changed: this run saw only the selection, from line %d, so what is in force "
        "above it is not known. Run %s on the whole program. %s" % (first, script, note),
        [
            {
                "line": first,
                "severity": "error",
                "message": "The lines above the selection were not available, so %s in force there are "
                "not known; nothing was %s." % (in_force, verb),
                "reason": "selection-unprimed",
            }
        ],
    )


# ===========================================================================
# 2. The plane run of rotate and mirror
# ===========================================================================

#: The plane rotate and the mill mirror work in (Q4-3).
PLANE = ("X", "Y")
#: The centre word of each axis of the plane (the inverse of ``_nc_path.CENTRE_AXIS``).
CENTRE_WORD = {axis: word for word, axis in _nc_path.CENTRE_AXIS.items()}
#: The most findings a run hands back; the message counts the rest (the app takes 1000).
PLANE_MAX_FINDINGS = 1000

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
    "shift-increment": ("incremental move after a shift", "incremental moves after a shift"),
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

#: The ids of the refusals of the run itself, beside ``_nc_geom.REASONS`` (plan §7, the P4a
#: fix round). Each script gives their plain text after "<as written>: " in its own
#: ``RUN_REASONS`` (rotate and mirror word ``selection-start`` each for its own moves).
PLANE_RUN_REASONS = ("selection-start",)


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


#: The place of each reason in the order the findings and the message use: the reasons of `_nc_geom`, then the run's own.
REASON_PLACE = {reason: place for place, reason in enumerate(list(_nc_geom.REASONS) + list(PLANE_RUN_REASONS))}


def reason_order(reason: str) -> int:
    return REASON_PLACE.get(reason, len(REASON_PLACE))


def finding_of(item: _nc_geom.Refusal, run_reasons: Dict[str, str]) -> Dict[str, Any]:
    """A refusal or an information row as a finding (``_nc_geom.finding_of``, and the run's own
    reasons, ``run_reasons``: id -> text, the script's ``RUN_REASONS``)."""
    if item.reason in run_reasons:
        return {"line": item.line, "severity": "error", "message": "%s: %s." % (item.written, run_reasons[item.reason]), "reason": item.reason}
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


class PlaneRun:
    """One walk over the scope with the path tracker: every block judged and rewritten in
    memory; the text is written only when nothing refused (Q4-1). ``params`` is the script's
    form (``op()``, ``headline()``, ``verb()``, ``decimals``); ``run_reasons`` the texts of its
    own refusals (:data:`PLANE_RUN_REASONS`)."""

    def __init__(self, context: Dict[str, Any], cp: Any, params: Any, run_reasons: Dict[str, str]) -> None:
        self.context = context
        self.cp = cp
        self.params = params
        self.run_reasons = run_reasons
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
        #: v1.2.0 (NCR-3): the axes a single pass of the selection wrote its end point on (a
        #: pass takes the others from the block that last wrote them, perhaps above it).
        self.pass_axes: set = set()
        #: The axes whose position the tracker computed (after a polar move, Klartext ``LP``,
        #: ``CP``): a word written from it is an approximation and counts as rounded.
        self.computed: set = set()
        #: Wave Y (T015): the first blocks of two-block roughing cycles still waiting for their
        #: second block: (the block, its refusal if none comes, the codes it writes).
        self.first_blocks: List[Tuple["Block", Any, List[Any]]] = []

    # -- the walk ---------------------------------------------------------------

    def walk(self, preceding: Sequence[str], lines: Sequence[str], first: int) -> None:
        tracker = self.tracker
        state: Any = None
        if self.lathe_z:
            # Wave Y (T015): the block numbers the scope and the lines above carry, so a roughing
            # or finishing cycle can be told whether its contour lies in the scope.
            scope, above = block_numbers(self.cp, preceding, lines, first)
            _nc_geom.set_block_numbers(tracker, scope, above)
        for number, text in enumerate(preceding, first - len(preceding)):
            state, step = tracker.line(text, number, state, False)
            _nc_geom.observe(step, tracker)
        self.first = first
        if self.selection:
            self.prime_selection(state, first)
        for index, text in enumerate(lines):
            number = first + index
            state, step = tracker.line(text, number, state, True)
            block = self.judge(step, index, text)
            self.blocks.append(block)
        self.end_first_blocks()
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
        """A selection that ends inside a block or while a cycle it started is still in force.
        v1.2.0 (NCR-3): or while the single passes are in force and the run changed the
        selection: a pass below it would run from a moved start point or to a moved end point."""
        last = self.blocks[-1]
        if state is not None and state.continuation:
            last.refuse("selection-inside", quote(last.text), "a block that runs on below the selection")
        tracker = self.tracker
        if tracker.whole_pass(tracker.interp.state, []) and any(b.edits for b in self.blocks):
            motion = tracker.pass_motion(tracker.interp.state, [])
            target = next((b for b in reversed(self.blocks) if b.text.strip()), last)
            target.refuse("selection-inside", quote(target.text), "%s is still in force at the end" % as_dict(motion).get("code"))
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
        _nc_geom.observe(step, tracker)
        # Wave Y (T015): the first block of a two-block roughing cycle waits for its second.
        waiting = [r for r in refusals if r.reason == "roughing-cycle" and r.detail == _nc_geom.SECOND_BLOCK]
        refusals = [r for r in refusals if r not in waiting]
        self.settle_second(step, refusals)
        block.refusals.extend(refusals)
        block.notes.extend(_nc_geom.notes_of(step, roles, tracker, self.op, self.context))
        written = quote("".join(t.text for t in step.tokens))
        if self.selection:
            self.selection_reasons(step, block, written)
        moving = False
        passes = self.selection and self.lathe_z and not self.identity and self.check_passes(step, roles, block, written)
        if self.outside and not self.identity and not passes:
            moving = self.check_outside(step, roles, block, written)
        if not block.refusals and not self.identity:
            # A rotation by whole turns changes no word (a polar angle would otherwise come
            # back as the same angle written another way, PA+30 as PA-330).
            self.rewrite(step, roles, block)
        if moving:
            self.outside = False
        if waiting:
            self.first_blocks.append((block, waiting[0]._replace(detail=""), [e.get("code") for e, _, _ in step.entries]))
        self.note_computed(step)
        block.refusals.sort(key=lambda r: reason_order(r.reason))
        arc = step.arc
        block.arc = arc is not None or any(isinstance(e, _nc_path.Unknown) and e.kind == "arc" for e in step.events)
        if arc is not None and self.swapping:
            block.helix = any(end is not None and start != end for start, end in arc.helix.values())
        elif block.arc and self.swapping:
            # Wave Y (T016): an arc the tracker does not compute (a tangential arc, an arc
            # through a point) that also moves an axis outside the plane is a helix too.
            plane = ("Z", "X") if self.lathe_z else PLANE
            rotary = _nc_geom._data(self.tracker).rotary
            block.helix = any(axis not in plane and axis not in rotary for axis, _ in step.moves)
        return block

    def settle_second(self, step: Any, refusals: Sequence[Any]) -> None:
        """Wave Y (T015): a block judged after the first block of a two-block roughing cycle. Its
        second block (the same code, naming the contour) that is not refused for the cycle settles
        it; any other block that writes something refuses the first one."""
        if not self.first_blocks:
            return
        codes = [e.get("code") for e, _, _ in step.entries]
        if not codes and not any(t.kind not in ("whitespace", "comment", "blockNumber") for t in step.tokens):
            return  # an empty line or a comment between the two blocks
        block, refusal, wanted = self.first_blocks.pop()
        second = any(code in wanted for code in codes) and not any(r.reason in ("roughing-cycle", "lathe-cycle") for r in refusals)
        if not second:
            block.refuse(refusal.reason, refusal.written, refusal.detail)

    def end_first_blocks(self) -> None:
        """Wave Y (T015): a first block whose second block the scope does not hold is refused."""
        for block, refusal, _ in self.first_blocks:
            block.refuse(refusal.reason, refusal.written, refusal.detail)
        self.first_blocks = []

    def pass_runs(self, step: Any) -> bool:
        """The block runs a single pass (`sets.path: 'cycle'`: the lathe `G90`, `G92`, `G94`,
        `G77`-`G79`, written or in force): while the passes are in force a block runs one again
        even when it moves nothing (lathe manual, the canned cycles)."""
        tracker = self.tracker
        if not tracker.whole_pass(tracker.interp.state, [e for e, _, _ in step.entries]):
            return False
        return any(t.kind not in ("whitespace", "comment") for t in step.tokens)

    def check_passes(self, step: Any, roles: Sequence[Any], block: Block, written: str) -> bool:
        """v1.2.0 (NCR-3): a single pass in a selection under the Z mirror. It goes back to where
        it started: refused while the tool still stands where the lines above left it and the
        mirror moves that point (or it is not known); a pass that does not write its Z takes it
        from the pass before, refused while no pass of the selection wrote it
        (``selection-start``). Returns whether the block runs a pass."""
        if not self.pass_runs(step):
            return False
        tracker = self.tracker
        motion = tracker.pass_motion(tracker.interp.state, [e for e, _, _ in step.entries])
        axes = {str(p.get("address") or "").upper() for p in (motion or {}).get("params") or [] if isinstance(p, dict)}
        absolute = {r.axis for r in roles if r.role in ("point", "cycle-position") and r.axis in ("X", "Y", "Z")}
        taken = "Z" in axes and "Z" not in absolute and "Z" not in self.pass_axes
        self.pass_axes |= absolute
        if self.outside and self.start_moved(step):
            block.refuse("selection-start", written, "a single pass, which goes back to where the lines above left the tool")
        elif taken and self.first > 1:
            block.refuse("selection-start", written, "a single pass that takes its Z from above the selection")
        return True

    def start_moved(self, step: Any) -> set:
        """The axes the lathe Z mirror moves of the point the tool stands at before ``step``:
        where it is known and the mirror changes it, or where it is not known although the
        program has written the axis (one never written, or not since a machine position,
        stands where the whole run leaves it too)."""
        units = self.units_of(step)
        start = {axis: self.start(step, axis, units) for axis in ("X", "Y", "Z")}
        known = {axis: value for axis, value in start.items() if value is not None}
        moved_to, _ = _nc_geom.transform("point", dict(known), self.op)
        moved = {axis for axis, value in known.items() if differs(moved_to[axis], value)}  # type: ignore[index]
        unwritten = getattr(step, "unwritten", None) or frozenset()
        before = step.before or {}
        moved |= {axis for axis in ("Y", "Z") if axis in before and before[axis] is None and axis not in unwritten}
        return moved

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
        if self.lathe_z:
            # v1.2.0 (NCR-3): a start not known on an axis the program wrote refuses too.
            moved = self.start_moved(step)
        else:
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
            # Wave Y (T015): the allowances and reliefs of a roughing cycle along Z change sign.
            for role in _nc_geom.contour_flips(_nc_geom._block_of(step, self.tracker), roles, self.op) or []:
                old = self.read(role, units)
                if old is None:
                    block.refuse("machine-dependent", quote(role.token.text))
                    continue
                self.put(block, role, old, -old, True, units)
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
            out[block.index] = splice(out[block.index], block.edits)
        return out


def block_numbers(cp: Any, preceding: Sequence[str], lines: Sequence[str], first: int) -> Tuple[Dict[str, List[int]], List[str]]:
    """Wave Y (T015): the block numbers of the scope (number -> the lines that carry it) and
    those of the lines above it, read from the tokens (``blockNumber``)."""
    scope: Dict[str, List[int]] = {}
    above: List[str] = []
    state: Any = None
    for index, text in enumerate(list(preceding) + list(lines)):
        tokens, state = gedit_nc.tokenize_line(text, cp, state)
        for token in tokens:
            if token.kind != "blockNumber":
                continue
            number = _nc_geom.number_of(token.value_text if token.value_text is not None else token.text)
            if number is None:
                continue
            if index < len(preceding):
                above.append(number)
            else:
                scope.setdefault(number, []).append(first + index - len(preceding))
    return scope, above


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


def plane_machine_note(context: Dict[str, Any]) -> str:
    """The machine sentence of rotate and mirror: a number reading without words of its own is
    "read as written"."""
    return machine_note(gedit_nc.machine_params(context), fallback="numbers are read as written")


def plane_message(run: PlaneRun, refused: List[Block], dropped: int) -> str:
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
    sentences.append(plane_machine_note(run.context))
    return " ".join(sentences)


def has_point_params(run: PlaneRun, block: Block) -> bool:
    """A machine block whose code takes its axis words as an intermediate point (``G28``)."""
    detail = block.notes[0].detail
    entry = run.tracker.interp.entry(detail) if detail else None
    params = as_dict(entry).get("params") if entry else None
    return isinstance(params, list) and bool(params)


def plane_findings(run: PlaneRun, refused: List[Block]) -> Tuple[List[Dict[str, Any]], int]:
    """One error per refused block (its first reason), the information rows, and, on a
    written run, the warnings and one row for the rounded blocks (at the first of them, with
    their count); in line order. The cap cuts errors and information rows, never a warning."""
    rows: List[Tuple[int, int, Dict[str, Any]]] = []
    warnings: List[Tuple[int, int, Dict[str, Any]]] = []
    for block in run.blocks:
        if block.refusals:
            rows.append((block.line, 0, finding_of(block.refusals[0], run.run_reasons)))
        for note in block.notes:
            rows.append((block.line, 1, finding_of(note, run.run_reasons)))
    if not refused:
        changed = [b for b in run.blocks if b.edits]
        rounded = [b for b in changed if b.rounded]
        if rounded:
            row = finding_of(_nc_geom.Refusal(rounded[0].line, "rounded", quote(rounded[0].text)), run.run_reasons)
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
    room = max(0, PLANE_MAX_FINDINGS - len(warnings))
    dropped = max(0, len(rows) - room)
    kept = rows[:room] + warnings
    kept.sort(key=lambda row: (row[0], row[1]))
    return [row[2] for row in kept], dropped


#: What a selection whose lines above were not sent does not know (``selection-unprimed``).
PLANE_IN_FORCE = "the distance mode, the units, a frame, a cycle, an arc direction and a compensation side"


def plane_main(script: str, params_class: Any, run_reasons: Dict[str, str]) -> int:
    """The ``main`` of rotate and mirror: ``script`` is the name in the messages, ``params_class``
    the form, ``run_reasons`` the texts of the run's own refusals."""
    setup = prepare(script, params_class)
    if isinstance(setup, int):
        return setup
    context, lines, text, profile, cp, params, codes = setup
    if not codes:
        gedit_nc.envelope(
            text,
            "Nothing was changed: this run had no code database, so it cannot tell a move from a "
            "cycle, a frame or a machine position. " + plane_machine_note(context),
            [],
        )
        return 0
    scope = scope_of(context)
    first, fragment, preceding = scope.first, scope.fragment, scope.preceding
    if fragment and not preceding:
        unprimed_envelope(text, first, script, plane_machine_note(context), PLANE_IN_FORCE, "changed")
        return 0

    run = PlaneRun(context, cp, params, run_reasons)
    run.walk(preceding, lines, first)
    written = run.apply(lines)
    if not run.refused() and (not run.exact or any(b.rounded for b in run.blocks)):
        run.check_arcs(preceding, written)
    refused = run.refused()
    findings, dropped = plane_findings(run, refused)
    gedit_nc.envelope(text if refused else "\n".join(written), plane_message(run, refused, dropped), findings)
    return 0
