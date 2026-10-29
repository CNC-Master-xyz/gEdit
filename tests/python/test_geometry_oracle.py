"""The differential oracle and the identity runs for ``translate.py``, ``rotate.py`` and
``mirror.py`` (Phase 4 plan section 5 P4a, P4.5; section 4 rule 7; exit criteria X19 to X21).

A transform is checked against code that did not compute it. ``extents.py`` is run on the
program and on the transformed program, and the two reports are compared: the ranges of the
result have to be the ranges of the original moved the way the transform says.

====================  =========================================================================
translate             every axis range shifted by (dX, dY, dZ); the axes it does not name stay
rotate 90/180/270     X and Y ranges turned (X and Y swap, with a sign), about the centre
mirror, x-axis/y-axis the Y (or X) ranges reflected about the line through the point
mirror, lathe Z       the Z ranges reflected about Z0, the Y ranges about Y0 (Q-B); X unchanged
rotate / mirror line  other angles: only that the new ranges lie inside the turned old ones
====================  =========================================================================

What is compared is what ``extents.py`` writes, rounded as it writes it (0.0001 mm). An axis the
extents could not resolve is **not comparable**: it has to be not resolved on both sides (the
source axis before, the target axis after) and its range is not compared. The comparison runs
over every row of the report (the program, each work offset, each tool); the machine positions
(``G53``, ``G28``) are left as written by every transform, so their rows must not change.
A lathe's X is a diameter in the extents column and a translate shifts the word as the machine
reads it, so the expected X shift is dX (diameter programming on) or 2 dX (off); a program that
switches the mode, or whose mode is not known, has no comparable X.

Four kinds of check, on every golden of ``tests/fixtures/scripts/{translate,rotate,mirror}/``
that has an ``expected.nc`` and on every owner-public program the transform does not refuse:

1. **the extents oracle** (above). On a golden it is run on ``input.nc`` and the golden's own
   ``expected.nc``, so it also holds the goldens to account; on an owner-public program it is run
   on the script's real output. A golden that is a *selection* is skipped (the lines above the
   selection are not transformed, so the ranges of the whole cannot be compared) and so is a
   rotation or mirror at a non-right angle (the ranges of a turned box are not the turned
   ranges): those only get the bounds check.
2. **identity, byte for byte**: shift 0, 0, 0; rotate by 0 and by 360; mirror twice (an axis,
   and the lathe Z mirror), in both cases only where nothing rounds.
3. **the round trip, by values**: shift by d and then by -d; four rotations by 90 degrees (and
   a mirror twice, which is also identity). Every word of the original has to come back with its
   value, as a number (``X.5`` and ``X0.50`` are alike); a word the transform *added* (a rotation
   writes ``X`` and ``Y`` on every moved block) may stay.
4. **a count**: per owner-public program, whether each transform refused or wrote, with the
   refusal reasons counted. ``RefusalCountTest`` prints it for the review; and each transform
   has a floor, ``written_floor``, on the number of the 20 programs it writes (at the default
   cap), so that a transform that came to refuse everything fails here.

**Speed.** The owner-public set holds programs of 44,000 and 99,000 lines; ``extents.py`` and a
transform each need about half a millisecond a line, and one program takes twenty or so runs.
With the 20 programs and about 20 runs each, a run of the whole file takes some minutes at background
priority (the start-up of a script dominates a short program). So each program is **cut to its first ``MAX_LINES`` lines** (1,500; ``GEDIT_ORACLE_LINES=n``
changes it, ``0`` runs the whole program, for the review's one-off run in the background). A
prefix is still a program, but the refusal counts are then counts for the prefix, and the printed
table says so. Run it with ``taskpolicy -b python3 -B -S -m unittest tests.python.test_geometry_oracle``.

**The scripts have to be there**: a test class that runs a transform fails, it does not skip, when
``translate.py``, ``rotate.py`` or ``mirror.py`` is missing. ``OracleSelfTest`` needs only
``extents.py``: it runs the oracle on small hand-written transforms of plain absolute ``G0``/
``G1`` lines and shows that a right one is accepted and a wrong one rejected.

Python 3.9, standard library only. The programs are the owner-public ones and synthetic goldens.
"""

from __future__ import annotations

import collections
import copy
import hashlib
import json
import math
import os
import re
import unittest
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from decimal import Decimal
from typing import Any, Callable, Dict, List, Optional, Tuple

from tests.python import helpers

#: Programs are cut to this many lines (see the module docstring); 0 means all of them.
DEFAULT_MAX_LINES = 1500
MAX_LINES = int(os.environ.get("GEDIT_ORACLE_LINES", str(DEFAULT_MAX_LINES)))

#: A run may take this long (``helpers.run_script`` allows 60 s, which a 100,000-line program
#: on a loaded machine does not keep to).
SCRIPT_TIMEOUT_SECONDS = 600

#: The rows of the extents report the oracle compares.
COMPARE_SCOPES = ("program", "offset", "tool", "machine")

#: The script file and the work package that writes it, for the skip message.
SCRIPT_FILES = {"translate": ("translate.py", "P4.3"), "rotate": ("rotate.py", "P4.4"), "mirror": ("mirror.py", "P4.4")}

#: The parameters the owner-public programs are transformed with. Whole numbers, so that no
#: word of any program has to round (a point-less word counts in increments of the machine).
SHIFT = {"dx": 10, "dy": -20, "dz": 5}
CENTRE = {"cx": 10, "cy": -5}
MILL_MIRRORS = ({"about": "x-axis", "px": 0, "py": 5}, {"about": "y-axis", "px": -10, "py": 0})
LATHE_MIRRORS = ({"about": "z", "z0": 0}, {"about": "z", "z0": 5})

#: ``extents.py`` writes its numbers rounded to 0.0001 (0.00001 inch); an exact transform has
#: to agree to one such unit (a tie that rounds away from zero can differ by one), and a
#: transform that rounds each word (Q4-4: three decimals in mm, four in inch) to the arc
#: tolerance of 0.002 mm (0.0001 inch).
UNIT = Decimal("0.0001")
ROUNDED_MM = Decimal("0.002")
ROUNDED_INCH = Decimal("0.0001")


_SAVED_TIMEOUT = helpers.RUN_TIMEOUT_SECONDS


def setUpModule() -> None:
    helpers.RUN_TIMEOUT_SECONDS = max(helpers.RUN_TIMEOUT_SECONDS, SCRIPT_TIMEOUT_SECONDS)


def tearDownModule() -> None:
    helpers.RUN_TIMEOUT_SECONDS = _SAVED_TIMEOUT


def require_script(name: str) -> None:
    """Fails the test class when the script is gone (``translate``, ``rotate``, ``mirror``): a
    deleted script must not turn its checks into skips."""
    helpers.require_script(SCRIPT_FILES[name][0])


# ---------------------------------------------------------------------------
# Running: the extents and the transforms
# ---------------------------------------------------------------------------


def document_context(context: Dict[str, Any], text: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """``context`` for a run over the whole of ``text`` with ``params``."""
    changed = copy.deepcopy(context)
    changed["params"] = dict(params or {})
    changed["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    return changed


def extents_of(text: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """The report of ``extents.py`` over the whole of ``text``."""
    out = helpers.run_script("extents.py", stdin=text, context=document_context(context, text))
    if not out.ok:
        raise AssertionError("extents.py failed: %s" % out.stderr[-1500:])
    return out.json()


@dataclass
class Run:
    """One run of a transform script, read from its envelope."""

    text: str
    message: str
    findings: List[Dict[str, Any]]
    problems: List[str] = dataclass_field(default_factory=list)

    @property
    def refused(self) -> bool:
        return any(f.get("severity") == "error" for f in self.findings)

    @property
    def reasons(self) -> "collections.Counter[str]":
        return collections.Counter(str(f.get("reason", "?")) for f in self.findings if f.get("severity") == "error")


def read_run(out: "helpers.RunOutput", text_in: str) -> Run:
    """A run's envelope. A crash is a failure, never a refusal; a refused run has to hand the input back."""
    if not out.ok:
        raise AssertionError("the script failed (exit %d): %s" % (out.returncode, out.stderr[-1500:]))
    result = out.json()
    run = Run(str(result.get("text", "")), str(result.get("message", "")), list(result.get("findings") or []))
    if run.refused and run.text != text_in:
        run.problems.append("a refused run changed the text (Q4-1: it hands the input back unchanged)")
    return run


def is_inch(text: str) -> bool:
    """Whether the program says inch (``G20``, Klartext ``INCH``), for the size of a tolerance."""
    return re.search(r"\bG20\b|\bINCH\b", text, re.IGNORECASE) is not None


# ---------------------------------------------------------------------------
# The expectation of a transform: what happens to the ranges
# ---------------------------------------------------------------------------

Mapping = Optional[Tuple[str, int, Decimal]]


def dec(value: Any) -> Decimal:
    """A form value as a decimal (a JSON ``1.25`` is read as written)."""
    return Decimal(str(value))


@dataclass
class Plan:
    """How the ranges of a program move: ``axes[target] = (source, sign, offset)`` means
    ``range(target) = sign * range(source) + offset``; an axis not listed is unchanged and
    ``None`` is not comparable. ``exact`` tells which tolerance applies. ``point`` (an
    inexact plan) maps a point of the XY plane for the bounds check."""

    name: str
    axes: Dict[str, Mapping] = dataclass_field(default_factory=dict)
    exact: bool = True
    point: Optional[Callable[[float, float], Tuple[float, float]]] = None
    diameter_x: bool = False  # translate on a turning profile: dX is the word's, the column is a diameter


def plan_translate(dx: Any = 0, dy: Any = 0, dz: Any = 0) -> Plan:
    return Plan(
        "translate by X%s Y%s Z%s" % (dx, dy, dz),
        {"X": ("X", 1, dec(dx)), "Y": ("Y", 1, dec(dy)), "Z": ("Z", 1, dec(dz))},
        diameter_x=True,
    )


def right_angle_step(degrees: Decimal) -> Optional[int]:
    """``degrees / 90`` modulo 4 when it is a whole number, else ``None``."""
    quotient = degrees / Decimal(90)
    if quotient != quotient.to_integral_value():
        return None
    return int(quotient) % 4


COS_SIN = [(1, 0), (0, 1), (-1, 0), (0, -1)]


def affine_plan(name: str, matrix: Tuple[int, int, int, int], cx: Decimal, cy: Decimal, exact: bool = True) -> Plan:
    """``p' = M (p - c) + c`` for a matrix ``M`` of 0 and +-1 (a quarter turn, a mirror about an axis)."""
    a, b, c, d = matrix  # x' = a x + b y + ..., y' = c x + d y + ...
    ox = cx - (a * cx + b * cy)
    oy = cy - (c * cx + d * cy)
    plan = Plan(name, exact=exact)
    plan.axes["X"] = ("X", a, ox) if a != 0 else ("Y", b, ox)
    plan.axes["Y"] = ("X", c, oy) if c != 0 else ("Y", d, oy)
    return plan


def plan_rotate(angle: Any, cx: Any = 0, cy: Any = 0) -> Plan:
    degrees = dec(angle)
    centre_x, centre_y = dec(cx), dec(cy)
    name = "rotate by %s about X%s Y%s" % (angle, cx, cy)
    step = right_angle_step(degrees)
    if step is not None:
        c, s = COS_SIN[step]
        return affine_plan(name, (c, -s, s, c), centre_x, centre_y)
    radians = math.radians(float(degrees))
    px, py = float(centre_x), float(centre_y)

    def point(x: float, y: float) -> Tuple[float, float]:
        return (
            px + math.cos(radians) * (x - px) - math.sin(radians) * (y - py),
            py + math.sin(radians) * (x - px) + math.cos(radians) * (y - py),
        )

    return Plan(name, {"X": None, "Y": None}, exact=False, point=point)


def plan_mirror(about: str = "y-axis", px: Any = 0, py: Any = 0, angle: Any = 0, z0: Any = 0) -> Plan:
    """The expectation of ``mirror.py`` for the form's ``about``, ``px``, ``py``, ``angle`` and ``z0``."""
    if about == "z":
        # Q-B (the owner's decision of 2026-10-16): Y changes sign too, about the turning axis.
        return Plan("mirror in Z about Z%s" % z0, {"Z": ("Z", -1, 2 * dec(z0)), "Y": ("Y", -1, Decimal(0))})
    centre_x, centre_y = dec(px), dec(py)
    name = "mirror %s through X%s Y%s" % (about, px, py)
    if about == "x-axis":
        return affine_plan(name, (1, 0, 0, -1), centre_x, centre_y)
    if about == "y-axis":
        return affine_plan(name, (-1, 0, 0, 1), centre_x, centre_y)
    # a line through the point at `angle`: the reflection matrix is [[cos 2t, sin 2t], [sin 2t, -cos 2t]]
    degrees = dec(angle)
    step = right_angle_step(degrees * 2)
    name = "mirror about the line at %s degrees through X%s Y%s" % (angle, px, py)
    if step is not None:
        c, s = COS_SIN[step]
        return affine_plan(name, (c, s, s, -c), centre_x, centre_y, exact=right_angle_step(degrees) is not None)
    radians = math.radians(float(degrees))
    fx, fy = float(centre_x), float(centre_y)

    def point(x: float, y: float) -> Tuple[float, float]:
        c2, s2 = math.cos(2 * radians), math.sin(2 * radians)
        return (fx + c2 * (x - fx) + s2 * (y - fy), fy + s2 * (x - fx) - c2 * (y - fy))

    return Plan(name, {"X": None, "Y": None}, exact=False, point=point)


def plan_of_case(script: str, params: Dict[str, Any]) -> Plan:
    """The plan of one golden: the script and the form values of its ``params.json``."""
    if script == "translate":
        return plan_translate(params.get("dx", 0), params.get("dy", 0), params.get("dz", 0))
    if script == "rotate":
        return plan_rotate(params["angle"], params.get("cx", 0), params.get("cy", 0))
    return plan_mirror(
        params.get("about", "y-axis"), params.get("px", 0), params.get("py", 0), params.get("angle", 0), params.get("z0", 0)
    )


def diameter_factor(message: str) -> Optional[int]:
    """How many times a word's shift shows in the X column: 1 for a milling X or diameter
    programming, 2 for radius programming, ``None`` when the program switches or the mode is not known."""
    if "X is a diameter: diameter programming is on" in message and "The program switches it" not in message:
        return 1
    if "diameter programming is off at the start" in message and "The program switches it" not in message:
        return 2
    if "X is a diameter" in message or "X is shown as a diameter" in message:
        return None
    return 1


# ---------------------------------------------------------------------------
# Comparing two extents reports
# ---------------------------------------------------------------------------


def number_of(text: Any) -> Optional[Decimal]:
    return Decimal(text) if isinstance(text, str) and text != "" else None


def grouped(report: Dict[str, Any]) -> Dict[Tuple[str, str], Dict[Any, Dict[str, Any]]]:
    """The rows of a report by ``(scope, where)`` and then by axis (a machine row by its address and place)."""
    groups: Dict[Tuple[str, str], Dict[Any, Dict[str, Any]]] = {}
    for row in report.get("rows", []):
        scope = str(row.get("scope", ""))
        if scope not in COMPARE_SCOPES:
            continue
        group = groups.setdefault((scope, str(row.get("where", ""))), {})
        key: Any = row.get("axisId")
        if scope == "machine":
            key = (row.get("axis"), row.get("axisId"), len(group))
        group[key] = row
    return groups


def compare_row(label: str, source: Dict[str, Any], target: Dict[str, Any], mapping: Tuple[str, int, Decimal], tol: Decimal) -> List[str]:
    """The ranges of ``target`` against those of ``source`` moved by ``mapping``."""
    _, sign, offset = mapping
    lo, hi = number_of(source.get("min")), number_of(source.get("max"))
    got_lo, got_hi = number_of(target.get("min")), number_of(target.get("max"))
    if lo is None or hi is None:
        return [] if got_lo is None and got_hi is None else ["%s: the result has a range where the original has none" % label]
    if got_lo is None or got_hi is None:
        return ["%s: the result has no range, the original has %s to %s" % (label, lo, hi)]
    want_lo, want_hi = sorted([sign * lo + offset, sign * hi + offset])
    problems = []
    if abs(got_lo - want_lo) > tol:
        problems.append("%s: minimum %s, expected %s" % (label, got_lo, want_lo))
    if abs(got_hi - want_hi) > tol:
        problems.append("%s: maximum %s, expected %s" % (label, got_hi, want_hi))
    return problems


def check_extents(before: Dict[str, Any], after: Dict[str, Any], plan: Plan, inch: bool = False) -> List[str]:
    """Every difference between the extents of the original (``before``) and of the transformed
    program (``after``) and what ``plan`` says they should be; ``[]`` when they agree."""
    if not plan.exact:
        return check_bounds(before, after, plan, inch)
    tol = UNIT
    axes = dict(plan.axes)
    if plan.diameter_x:
        factor = diameter_factor(str(before.get("message", "")))
        axes["X"] = None if factor is None or axes.get("X") is None else ("X", 1, axes["X"][2] * factor)  # type: ignore[index]
    old, new = grouped(before), grouped(after)
    problems: List[str] = []
    for place in sorted(set(old) | set(new)):
        where = "%s %s" % place
        if place not in old or place not in new:
            problems.append("%s: the rows are in the %s report only" % (where, "original" if place in old else "result"))
            continue
        source_rows, target_rows = old[place], new[place]
        for key in sorted(set(target_rows) | (set(source_rows) if place[0] == "machine" else set()), key=str):
            if place[0] == "machine":
                mapping: Mapping = (str(key), 1, Decimal(0))
                source_key = key
            else:
                mapping = axes.get(key, (key, 1, Decimal(0)))
                source_key = mapping[0] if mapping is not None else key
            label = "%s, %s" % (where, key if place[0] != "machine" else key[0])
            source, target = source_rows.get(source_key), target_rows.get(key)
            if source is None and target is None:
                continue
            if mapping is None:
                continue  # not comparable (the lathe X of a program that switches the mode)
            if source is None or target is None:
                problems.append("%s: the axis has a row in the %s report only" % (label, "original" if target is None else "result"))
                continue
            before_open, after_open = int(source.get("unresolved", 0) or 0) > 0, int(target.get("unresolved", 0) or 0) > 0
            if before_open != after_open:
                problems.append(
                    "%s: %s positions not resolved in the original, %s in the result"
                    % (label, source.get("unresolved", 0), target.get("unresolved", 0))
                )
                continue
            if before_open:
                continue  # not resolved on both sides: not comparable
            problems.extend(compare_row(label, source, target, mapping, tol))
    return problems


def check_bounds(before: Dict[str, Any], after: Dict[str, Any], plan: Plan, inch: bool) -> List[str]:
    """For a turn or a mirror at an angle that is not a right one: the program ranges of the other
    axes are unchanged and those of X and Y lie inside the box of the turned original box."""
    tol = ROUNDED_INCH if inch else ROUNDED_MM
    old = grouped(before).get(("program", "Program"), {})
    new = grouped(after).get(("program", "Program"), {})
    problems: List[str] = []
    for axis in sorted(set(old) | set(new), key=str):
        if axis in ("X", "Y"):
            continue
        source, target = old.get(axis), new.get(axis)
        if source is None or target is None:
            problems.append("%s: the axis has a row in the %s report only" % (axis, "original" if target is None else "result"))
        elif int(source.get("unresolved", 0) or 0) == 0 and int(target.get("unresolved", 0) or 0) == 0:
            problems.extend(compare_row(str(axis), source, target, (str(axis), 1, Decimal(0)), tol))
    box = [number_of(old.get(a, {}).get(k)) for a in ("X", "Y") for k in ("min", "max")]
    flags = [int(old.get(a, {}).get("unresolved", 0) or 0) > 0 for a in ("X", "Y")]
    new_flags = [int(new.get(a, {}).get("unresolved", 0) or 0) > 0 for a in ("X", "Y")]
    if any(flags) != any(new_flags):
        problems.append("X/Y: positions not resolved in the %s report only" % ("original" if any(flags) else "result"))
    if any(flags) or any(new_flags) or any(value is None for value in box) or plan.point is None:
        return problems
    x0, x1, y0, y1 = [float(value) for value in box]  # type: ignore[arg-type]
    corners = [plan.point(x, y) for x in (x0, x1) for y in (y0, y1)]
    xs, ys = [c[0] for c in corners], [c[1] for c in corners]
    margin = float(tol)
    for axis, lo, hi in (("X", min(xs), max(xs)), ("Y", min(ys), max(ys))):
        got_lo, got_hi = number_of(new.get(axis, {}).get("min")), number_of(new.get(axis, {}).get("max"))
        if got_lo is None or got_hi is None:
            problems.append("%s: the result has no range" % axis)
        elif float(got_lo) < lo - margin or float(got_hi) > hi + margin:
            problems.append("%s: %s to %s lies outside the turned original box %.4f to %.4f" % (axis, got_lo, got_hi, lo, hi))
    return problems


# ---------------------------------------------------------------------------
# Comparing two programs: bytes, and values
# ---------------------------------------------------------------------------

NUMBER = r"[-+]?(?:\d+\.?\d*|\.\d+)"
WORD = re.compile(r"([A-Za-z_]*=?(?:[A-Za-z]+\()?)(" + NUMBER + ")")
#: A decimal comma right after an address letter (Klartext programs from a CAM system write
#: ``X241,781``): one number, not ``X241`` and ``781``. A comma after anything else separates
#: (``CYCLE81(10,0,2)``). P4a Wave 1 integration: a rotation that adds ``X+241,781`` left a
#: stray ``,`` in the text around the numbers.
COMMA_DECIMAL = re.compile(r"(?<=[A-Za-z])([-+]?\d+),(\d+)")


def points(line: str) -> str:
    """``line`` with every decimal comma of an address word written as a point."""
    return COMMA_DECIMAL.sub(r"\1.\2", line)


def words_of(line: str) -> List[Tuple[str, Decimal]]:
    """The ``(label, value)`` of every number in ``line``: ``X-1.50`` is ``("X", -1.5)``, ``X=AC(5)`` is ``("X=AC(", 5)``."""
    return [(m.group(1), Decimal(m.group(2))) for m in WORD.finditer(points(line))]


def rest_of(line: str) -> str:
    """``line`` without its numbers, whitespace collapsed: what a value-for-value comparison must find alike."""
    return " ".join(WORD.sub("", points(line)).split())


def first_differences(want: str, got: str, limit: int = 3) -> List[str]:
    """The first lines where two programs differ, for a failure message."""
    a, b = want.split("\n"), got.split("\n")
    out = []
    if len(a) != len(b):
        out.append("%d lines, expected %d" % (len(b), len(a)))
    for number, (x, y) in enumerate(zip(a, b), start=1):
        if x != y:
            out.append("line %d: %r, expected %r" % (number, y, x))
            if len(out) >= limit:
                break
    return out


def value_differences(want: str, got: str, limit: int = 3) -> List[str]:
    """Where ``got`` does not give every word of ``want`` back with its value (compared as numbers).

    The words of a line of ``want`` have to occur in ``got`` in the same order with the same label and
    the same value; ``got`` may hold more words (the ones a rotation added), and everything that is
    not a number has to be alike."""
    a, b = want.split("\n"), got.split("\n")
    if len(a) != len(b):
        return ["%d lines, expected %d" % (len(b), len(a))]
    out = []
    for number, (x, y) in enumerate(zip(a, b), start=1):
        if x == y:
            continue
        have = words_of(y)
        position = 0
        lost = None
        for word in words_of(x):
            while position < len(have) and have[position] != word:
                position += 1
            if position >= len(have):
                lost = word
                break
            position += 1
        if lost is not None:
            out.append("line %d: %s%s is not back: %r, expected %r" % (number, lost[0], lost[1], y, x))
        elif rest_of(x) != rest_of(y):
            out.append("line %d: %r, expected %r (the text around the numbers differs)" % (number, y, x))
        if len(out) >= limit:
            break
    return out


# ---------------------------------------------------------------------------
# Subjects: a golden case or an owner-public program, and the checks on one
# ---------------------------------------------------------------------------


@dataclass
class Outcome:
    """What the checks found out about one transform of one subject."""

    status: str = "n/a"  # "transformed", "refused" or "n/a" (the transform does not apply to the profile)
    reasons: "collections.Counter[str]" = dataclass_field(default_factory=collections.Counter)
    problems: List[str] = dataclass_field(default_factory=list)
    notes: List[str] = dataclass_field(default_factory=list)
    findings: "collections.Counter[str]" = dataclass_field(default_factory=collections.Counter)


class Subject:
    """A text with the context it runs in. Runs and extents are remembered, so a check that needs a
    result another already produced does not run it again."""

    def __init__(self, name: str, text: str, context: Dict[str, Any]) -> None:
        self.name = name
        self.text = text
        self.context = context
        self._runs: Dict[Tuple[str, str, str], Run] = {}
        self._extents: Dict[str, Dict[str, Any]] = {}
        self.outcomes: Dict[str, Outcome] = {}

    @property
    def lathe(self) -> bool:
        return self.context.get("profile", {}).get("machineType") == "lathe"

    @property
    def selection(self) -> bool:
        return self.context.get("input", {}).get("scope") == "selection"

    def run(self, script: str, text: str, params: Dict[str, Any]) -> Run:
        key = (script, hashlib.sha1(text.encode("utf-8")).hexdigest(), json.dumps(params, sort_keys=True))
        if key not in self._runs:
            context = copy.deepcopy(self.context)
            context["params"] = dict(params)
            if not self.selection:
                context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
            out = helpers.run_script(SCRIPT_FILES[script][0], stdin=text, context=context)
            self._runs[key] = read_run(out, text)
        return self._runs[key]

    def extents(self, text: str) -> Dict[str, Any]:
        key = hashlib.sha1(text.encode("utf-8")).hexdigest()
        if key not in self._extents:
            self._extents[key] = extents_of(text, self.context)
        return self._extents[key]

    def oracle(self, plan: Plan, before: str, after: str) -> List[str]:
        return ["%s: %s" % (plan.name, p) for p in check_extents(self.extents(before), self.extents(after), plan, is_inch(before))]


def finish(outcome: Outcome, first: Run) -> None:
    outcome.reasons = first.reasons
    outcome.findings = collections.Counter(str(f.get("severity")) for f in first.findings)


def check_identity(subject: Subject, label: str, got: Run, outcome: Outcome) -> None:
    """``got`` has to be the subject's text, byte for byte."""
    outcome.problems.extend("%s: %s" % (label, p) for p in got.problems)
    if got.refused:
        outcome.problems.append("%s: refused, although the transform itself was not refused (%s)" % (label, dict(got.reasons)))
    elif got.text != subject.text:
        outcome.problems.append("%s: not the program back byte for byte: %s" % (label, "; ".join(first_differences(subject.text, got.text))))


def number_form(text: str) -> Tuple[bool, int, bool]:
    """How a number is written, its sign left out: whether it has digits before the point,
    how many after it, and whether it has a point (``-.5`` is ``(False, 1, True)``)."""
    body = text.lstrip("+-").replace(",", ".")
    whole, point, fraction = body.partition(".")
    return whole != "", len(fraction), point == "."


def check_twice(subject: Subject, label: str, first: Run, got: Run, outcome: Outcome) -> None:
    """Mirror twice: ``got`` has to be the subject's text byte for byte, except a word the first
    mirror had to write in a new form. A word keeps the form it is written in (AD-44; the
    first mirror writes ``X-.5`` about X12.5 as ``X25.5``, and ``Y0.`` about Y-3.75 as
    ``Y-7.5``), so the second one writes the value back in the form the first one left
    (``X-0.5``, ``Y0.0``). Such a word has to come back with its value and in exactly that
    form; everything else, byte for byte. (P4a integration: the oracle's earlier "byte for
    byte everywhere" cannot hold for these words, whatever the transform does.)"""
    outcome.problems.extend("%s: %s" % (label, p) for p in got.problems)
    if got.refused:
        outcome.problems.append("%s: refused, although the transform itself was not refused (%s)" % (label, dict(got.reasons)))
        return
    if got.text == subject.text:
        return
    a, m, b = subject.text.split("\n"), first.text.split("\n"), got.text.split("\n")
    if not len(a) == len(m) == len(b):
        outcome.problems.append("%s: %d lines, expected %d" % (label, len(b), len(a)))
        return
    bad = []
    for number, (x, y, z) in enumerate(zip(a, m, b), start=1):
        if x == z:
            continue
        wx, wy, wz = list(WORD.finditer(points(x))), list(WORD.finditer(points(y))), list(WORD.finditer(points(z)))
        explained = rest_of(x) == rest_of(z) and len(wx) == len(wy) == len(wz)
        if explained:
            for px, py, pz in zip(wx, wy, wz):
                if px.group(0) == pz.group(0):
                    continue
                same_value = px.group(1) == pz.group(1) and Decimal(px.group(2).replace(",", ".")) == Decimal(pz.group(2).replace(",", "."))
                # A '+' the second mirror wrote because the first one had to write a sign (the
                # Klartext style `plusSign: 'signed'`, plan §7 #308: `Y286` mirrored is `Y-276`,
                # and mirrored back `Y+286`) is a form the first mirror left, like the decimals.
                plus = pz.group(2).startswith("+") and not px.group(2).startswith("+") and py.group(2)[:1] in ("+", "-")
                changed = number_form(px.group(2)) != number_form(py.group(2)) or plus
                if not (same_value and number_form(pz.group(2)) == number_form(py.group(2)) and changed):
                    explained = False
                    break
        if not explained:
            bad.append("line %d: %r, expected %r" % (number, z, x))
            if len(bad) >= 3:
                break
    if bad:
        outcome.problems.append("%s: not the program back byte for byte: %s" % (label, "; ".join(bad)))


def check_back(subject: Subject, label: str, got: Run, outcome: Outcome) -> None:
    """``got`` has to give every word of the subject's text back with its value."""
    outcome.problems.extend("%s: %s" % (label, p) for p in got.problems)
    if got.refused:
        outcome.problems.append("%s: refused, although the transform itself was not refused (%s)" % (label, dict(got.reasons)))
    else:
        outcome.problems.extend("%s: %s" % (label, p) for p in value_differences(subject.text, got.text))


def check_translate(subject: Subject, shift: Dict[str, Any], oracle_after: Optional[str] = None) -> Outcome:
    """Translate: the extents oracle, shift 0, 0, 0, and the shift by d and then by -d."""
    outcome = Outcome()
    first = subject.run("translate", subject.text, shift)
    outcome.problems.extend(first.problems)
    if first.refused:
        outcome.status = "refused"
        finish(outcome, first)
        return outcome
    outcome.status = "transformed"
    finish(outcome, first)
    plan = plan_translate(shift.get("dx", 0), shift.get("dy", 0), shift.get("dz", 0))
    outcome.problems.extend(subject.oracle(plan, subject.text, first.text))
    if first.text == subject.text and any(shift.get(k, 0) != 0 for k in ("dx", "dy", "dz")):
        outcome.problems.append("a shift by %s changed nothing" % shift)
    check_identity(subject, "shift 0, 0, 0", subject.run("translate", subject.text, dict(shift, dx=0, dy=0, dz=0)), outcome)
    back = dict(shift, dx=-dec(shift.get("dx", 0)), dy=-dec(shift.get("dy", 0)), dz=-dec(shift.get("dz", 0)))
    back = {k: (float(v) if isinstance(v, Decimal) else v) for k, v in back.items()}
    check_back(subject, "shift by d and then by -d", subject.run("translate", first.text, back), outcome)
    return outcome


def check_rotate(subject: Subject, centre: Dict[str, Any], base: Optional[Dict[str, Any]] = None) -> Outcome:
    """Rotate: the extents oracle at 90, 180 and 270 degrees, rotation by 0 and 360 (byte for byte)
    and four rotations by 90 degrees (values back). Not for a turning profile (it refuses all of them)."""
    outcome = Outcome()
    if subject.lathe:
        return outcome
    params = dict(base or {}, **centre)
    quarter = dict(params, angle=90)
    first = subject.run("rotate", subject.text, quarter)
    outcome.problems.extend(first.problems)
    if first.refused:
        outcome.status = "refused"
        finish(outcome, first)
        return outcome
    outcome.status = "transformed"
    finish(outcome, first)
    runs = [first]
    for turns in (2, 3, 4):
        run = subject.run("rotate", runs[-1].text, quarter)
        outcome.problems.extend(run.problems)
        if run.refused:
            outcome.problems.append("rotation %d of 4 by 90 degrees was refused: %s" % (turns, dict(run.reasons)))
            return outcome
        runs.append(run)
    # The extents oracle on the chain: the text after 1, 2 and 3 quarter turns.
    for turns, run in enumerate(runs[:3], start=1):
        outcome.problems.extend(subject.oracle(plan_rotate(90 * turns, params.get("cx", 0), params.get("cy", 0)), subject.text, run.text))
    current = runs[-1]
    check_back(subject, "four rotations by 90 degrees", current, outcome)
    for angle in (0, 360):
        check_identity(subject, "rotate by %d" % angle, subject.run("rotate", subject.text, dict(params, angle=angle)), outcome)
    return outcome


def check_mirror(subject: Subject, variants: Tuple[Dict[str, Any], ...], twice: bool = True, only: Optional[str] = None) -> Outcome:
    """Mirror: the extents oracle and mirror twice (byte for byte) for each variant. A turning
    profile gets the Z mirror, a milling one the axis mirrors."""
    outcome = Outcome()
    wanted = [v for v in variants if (v.get("about") == "z") == subject.lathe]
    if only is not None:
        wanted = [v for v in wanted if v.get("about") == only]
    for params in wanted:
        first = subject.run("mirror", subject.text, params)
        outcome.problems.extend(first.problems)
        if first.refused:
            outcome.reasons.update(first.reasons)
            outcome.status = "refused" if outcome.status in ("n/a", "refused") else outcome.status
            continue
        if outcome.status in ("n/a", "refused"):
            outcome.status = "transformed" if outcome.status == "n/a" else "mixed"
            finish(outcome, first)
        plan = plan_mirror(params.get("about", "y-axis"), params.get("px", 0), params.get("py", 0), params.get("angle", 0), params.get("z0", 0))
        outcome.problems.extend(subject.oracle(plan, subject.text, first.text))
        if twice and plan.exact:
            second = subject.run("mirror", first.text, params)
            check_twice(subject, "mirror twice (%s)" % plan.name, first, second, outcome)
    return outcome


# ---------------------------------------------------------------------------
# The subjects of the real runs
# ---------------------------------------------------------------------------


def capped(text: str) -> str:
    """The first ``MAX_LINES`` lines of a program (all of it when ``MAX_LINES`` is 0)."""
    lines = text.split("\n")
    return text if MAX_LINES <= 0 or len(lines) <= MAX_LINES else "\n".join(lines[:MAX_LINES])


_OWNER: Dict[str, Subject] = {}


def owner_subjects() -> Dict[str, Subject]:
    """One subject per owner-public program, in the context of its folder's default profile."""
    if not _OWNER:
        for rel, profile_id, path in helpers.owner_public_programs():
            text = capped(helpers.decode_program(path.read_bytes()))
            _OWNER[rel] = Subject(rel, text, helpers.effective_context(profile_id))
    return _OWNER


def shift_of(subject: Subject) -> Dict[str, Any]:
    """The shift an owner-public program gets: a lathe moves in X and Z (Q4-2; Y is not part of it)."""
    return dict(SHIFT, dy=0) if subject.lathe else dict(SHIFT)


def assert_clean(test: unittest.TestCase, outcome: Outcome) -> None:
    """Fails with the first problems of ``outcome`` (a long list would bury the first one)."""
    if outcome.problems:
        more = len(outcome.problems) - 8
        test.fail("\n".join(outcome.problems[:8]) + (("\n... and %d more" % more) if more > 0 else ""))


def golden_subject(case: Any) -> Subject:
    context = helpers.geometry_context(case)
    scope = context.get("input")
    if isinstance(scope, dict) and scope.get("scope") == "selection":
        # Wave Y (FZ-5): a golden's selection ends the document, so no lines stand below it.
        scope.setdefault("followingLines", [])
    return Subject("%s/%s" % (case.script, case.name), case.input_text(), context)


# ---------------------------------------------------------------------------
# Tests: the oracle on a hand-written transform (needs only extents.py)
# ---------------------------------------------------------------------------

# Every word has a decimal point: without a machine, a point-less word is read differently by the
# presets of the profile (IS-B, IS-C, calculator) and the extents leave it not resolved.
MILL_PROGRAM = """(WRITTEN FOR GEDIT)
G21 G90 G17
G0 X0. Y0. Z10.
G1 Z-2. F100.
G1 X20. Y5.
G3 X-20. Y5. I-20. J0.
G1 X-5.25 Y12.
G1 X-5.25 Y-12.5
G0 Z10.
M30
"""

LATHE_PROGRAM = """(WRITTEN FOR GEDIT)
G21 G99
T0101
G0 X50. Z2.
G1 X20. Z-10. F0.2
G1 Z-30.
G0 X50.
"""

UNRESOLVED_PROGRAM = """(WRITTEN FOR GEDIT)
G21 G90 G17
G0 X0. Y0. Z10.
G1 X20. Y5. F100.
G1 Z#1
G1 X30. Y15.
"""


def shown(value: Decimal) -> str:
    text = format(value.normalize(), "f")
    text = "0" if text in ("-0", "") else text
    return text if "." in text else text + "."


def fake(text: str, move: Callable[[Dict[str, Decimal]], Dict[str, Decimal]], swap: Optional[Tuple[str, str]] = None) -> str:
    """A tiny transform of plain absolute ``G0``/``G1``/``G2``/``G3`` lines: ``move`` gets the numeric
    words of the line (``X``, ``Y``, ``Z``, ``I``, ``J``) and returns the new ones; ``swap`` exchanges two codes."""
    out = []
    for line in text.split("\n"):
        if re.match(r"G[0-3]\b", line):
            words = {m.group(1): Decimal(m.group(2)) for m in re.finditer(r"\b([XYZIJ])(" + NUMBER + ")", line)}
            new = move(words)
            if swap is not None:
                line = re.sub(r"^G([23])\b", lambda m: "G" + (swap[1] if m.group(1) == swap[0] else swap[0]), line)
            line = re.sub(r"\b([XYZIJ])(" + NUMBER + ")", lambda m: m.group(1) + shown(new.get(m.group(1), Decimal(m.group(2)))), line)
            # a word the move adds (a rotation writes X and Y on every moved block)
            for letter in "XY":
                if letter in new and letter not in words:
                    line += " %s%s" % (letter, shown(new[letter]))
        out.append(line)
    return "\n".join(out)


def fake_translate(text: str, dx: Any = 0, dy: Any = 0, dz: Any = 0) -> str:
    shifts = {"X": dec(dx), "Y": dec(dy), "Z": dec(dz)}
    return fake(text, lambda w: {k: v + shifts[k] if k in shifts else v for k, v in w.items()})


def fake_rotate_90(text: str, cx: Any = 0, cy: Any = 0, sign: int = 1) -> str:
    """A quarter turn (counter-clockwise for ``sign`` 1) about (cx, cy) of lines that write X and Y both."""
    px, py = dec(cx), dec(cy)

    def move(w: Dict[str, Decimal]) -> Dict[str, Decimal]:
        new = dict(w)
        if "X" in w and "Y" in w:
            x, y = w["X"] - px, w["Y"] - py
            new["X"], new["Y"] = px - sign * y, py + sign * x
        if "I" in w and "J" in w:
            new["I"], new["J"] = -sign * w["J"], sign * w["I"]
        return new

    return fake(text, move)


def fake_mirror_y_axis(text: str, px: Any = 0) -> str:
    """X' = 2 px - X; I changes sign and G2 and G3 swap."""
    centre = dec(px)
    return fake(
        text,
        lambda w: {k: (2 * centre - v if k == "X" else -v if k == "I" else v) for k, v in w.items()},
        swap=("2", "3"),
    )


def fake_mirror_z(text: str, z0: Any = 0) -> str:
    centre = dec(z0)
    return fake(text, lambda w: {k: (2 * centre - v if k == "Z" else -v if k == "Y" else v) for k, v in w.items()})


class OracleSelfTest(unittest.TestCase):
    """The oracle on transforms written here, so that it is known to accept a right one and to
    reject a wrong one before any real script exists."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.mill = helpers.effective_context("fanuc-gcode")
        cls.lathe = helpers.effective_context("fanuc-lathe")

    reports: Dict[Tuple[str, str], Dict[str, Any]] = {}

    def report(self, context: Dict[str, Any], text: str) -> Dict[str, Any]:
        key = (str(context["profile"].get("id")), text)
        if key not in self.reports:
            self.reports[key] = extents_of(text, context)
        return self.reports[key]

    def problems(self, context: Dict[str, Any], before: str, after: str, plan: Plan) -> List[str]:
        return check_extents(self.report(context, before), self.report(context, after), plan, is_inch(before))

    def test_a_right_translate_is_accepted(self) -> None:
        after = fake_translate(MILL_PROGRAM, 1.25, -2, 0.5)
        self.assertNotEqual(after, MILL_PROGRAM)
        self.assertEqual(self.problems(self.mill, MILL_PROGRAM, after, plan_translate(1.25, -2, 0.5)), [])

    def test_a_wrong_translate_is_rejected(self) -> None:
        plan = plan_translate(1.25, -2, 0.5)
        forgot_z = fake_translate(MILL_PROGRAM, 1.25, -2, 0)
        wrong_y = fake_translate(MILL_PROGRAM, 1.25, -1, 0.5)
        sign = fake_translate(MILL_PROGRAM, -1.25, -2, 0.5)
        for name, after in (("forgot Z", forgot_z), ("wrong Y", wrong_y), ("wrong sign", sign)):
            with self.subTest(fault=name):
                self.assertNotEqual(self.problems(self.mill, MILL_PROGRAM, after, plan), [])

    def test_the_oracle_sees_the_arc_bulge(self) -> None:
        # The arc G3 X-20. Y5. I-20. J0. is a half circle about (0, 5) and bulges to Y25, higher than
        # any other position; a transform that moved the end points and not the arc would be caught.
        def y_max(text: str) -> str:
            rows = extents_of(text, self.mill)["rows"]
            return [r for r in rows if r["scope"] == "program" and r["axisId"] == "Y"][0]["max"]

        self.assertEqual(y_max(MILL_PROGRAM), "25")
        self.assertEqual(y_max(MILL_PROGRAM.replace("G3 X-20. Y5. I-20. J0.", "G1 X-20. Y5.")), "12")
        after = fake_translate(MILL_PROGRAM, 0, 3, 0)
        self.assertEqual(self.problems(self.mill, MILL_PROGRAM, after, plan_translate(0, 3, 0)), [])
        no_arc = after.replace("G3 X-20. Y8. I-20. J0.", "G1 X-20. Y8.")
        self.assertNotEqual(no_arc, after)
        self.assertNotEqual(self.problems(self.mill, MILL_PROGRAM, no_arc, plan_translate(0, 3, 0)), [])

    def test_a_right_quarter_turn_is_accepted_and_a_wrong_one_rejected(self) -> None:
        for angle, steps in ((90, 1), (180, 2), (270, 3)):
            after = MILL_PROGRAM
            for _ in range(steps):
                after = fake_rotate_90(after, 10, -5)
            with self.subTest(angle=angle):
                self.assertEqual(self.problems(self.mill, MILL_PROGRAM, after, plan_rotate(angle, 10, -5)), [])
        wrong_way = fake_rotate_90(MILL_PROGRAM, 10, -5, sign=-1)
        self.assertNotEqual(self.problems(self.mill, MILL_PROGRAM, wrong_way, plan_rotate(90, 10, -5)), [])
        wrong_centre = fake_rotate_90(MILL_PROGRAM, 0, 0)
        self.assertNotEqual(self.problems(self.mill, MILL_PROGRAM, wrong_centre, plan_rotate(90, 10, -5)), [])
        not_turned = fake_translate(MILL_PROGRAM, 0, 0, 0)
        self.assertNotEqual(self.problems(self.mill, MILL_PROGRAM, not_turned, plan_rotate(90, 10, -5)), [])

    def test_a_rotation_at_another_angle_gets_only_the_bounds(self) -> None:
        plan = plan_rotate(30, 0, 0)
        self.assertFalse(plan.exact)
        # a 90 degree turn stays inside the box of a 30 degree turn of that box only by luck; what
        # is asked is that the check runs and that a result far outside it is rejected
        far = fake_translate(MILL_PROGRAM, 500, 0, 0)
        self.assertNotEqual(self.problems(self.mill, MILL_PROGRAM, far, plan), [])
        same = MILL_PROGRAM
        self.assertEqual(self.problems(self.mill, MILL_PROGRAM, same, plan_rotate(360, 0, 0)), [])

    def test_a_right_mirror_is_accepted_and_a_wrong_one_rejected(self) -> None:
        after = fake_mirror_y_axis(MILL_PROGRAM, -10)
        self.assertIn("G2 X", after)
        plan = plan_mirror("y-axis", -10, 0)
        self.assertEqual(self.problems(self.mill, MILL_PROGRAM, after, plan), [])
        self.assertNotEqual(self.problems(self.mill, MILL_PROGRAM, fake_mirror_y_axis(MILL_PROGRAM, 0), plan), [])
        self.assertNotEqual(self.problems(self.mill, MILL_PROGRAM, MILL_PROGRAM, plan), [])
        # a mirror that forgot the arc centre is caught through the bulge (the arc is a half circle)
        forgot_centre = fake(MILL_PROGRAM, lambda w: {k: (-20 - v if k == "X" else v) for k, v in w.items()}, swap=("2", "3"))
        self.assertNotEqual(self.problems(self.mill, MILL_PROGRAM, forgot_centre, plan_mirror("y-axis", -10, 0)), [])

    def test_the_lathe_z_mirror(self) -> None:
        after = fake_mirror_z(LATHE_PROGRAM, 5)
        self.assertEqual(self.problems(self.lathe, LATHE_PROGRAM, after, plan_mirror("z", z0=5)), [])
        self.assertNotEqual(self.problems(self.lathe, LATHE_PROGRAM, after, plan_mirror("z", z0=0)), [])
        x_moved = fake(after, lambda w: {k: (v + 1 if k == "X" else v) for k, v in w.items()})
        self.assertNotEqual(self.problems(self.lathe, LATHE_PROGRAM, x_moved, plan_mirror("z", z0=5)), [])
        # Q-B: a Y on the lathe changes sign about Y0; a mirror that left it is caught.
        with_y = LATHE_PROGRAM.replace("G0 X50. Z2.", "G0 X50. Y5. Z2.").replace("G1 Z-30.", "G1 Y-3. Z-30.")
        self.assertEqual(self.problems(self.lathe, with_y, fake_mirror_z(with_y, 5), plan_mirror("z", z0=5)), [])
        y_left = fake(with_y, lambda w: {k: (10 - v if k == "Z" else v) for k, v in w.items()})
        self.assertNotEqual(self.problems(self.lathe, with_y, y_left, plan_mirror("z", z0=5)), [])

    def test_a_lathe_x_shift_is_read_as_a_diameter(self) -> None:
        after = fake_translate(LATHE_PROGRAM, 3, 0, -1)
        self.assertEqual(self.problems(self.lathe, LATHE_PROGRAM, after, plan_translate(3, 0, -1)), [])
        as_radius = fake_translate(LATHE_PROGRAM, 1.5, 0, -1)
        self.assertNotEqual(self.problems(self.lathe, LATHE_PROGRAM, as_radius, plan_translate(3, 0, -1)), [])
        self.assertEqual(diameter_factor("X is a diameter: diameter programming is on (assumed from the profile)."), 1)
        self.assertEqual(diameter_factor("X is shown as a diameter: diameter programming is off at the start (the machine), so a radius value counts double."), 2)
        self.assertIsNone(diameter_factor("X is a diameter: diameter programming is on (x). The program switches it: DIAMOF (line 4)."))
        self.assertEqual(diameter_factor("No machine."), 1)

    def test_an_axis_not_resolved_is_not_compared_but_has_to_stay_so(self) -> None:
        plan = plan_translate(1, 2, 3)
        report = extents_of(UNRESOLVED_PROGRAM, self.mill)
        z = [r for r in report["rows"] if r["scope"] == "program" and r["axisId"] == "Z"][0]
        self.assertGreater(z["unresolved"], 0)
        after = fake_translate(UNRESOLVED_PROGRAM, 1, 2, 3)
        self.assertEqual(self.problems(self.mill, UNRESOLVED_PROGRAM, after, plan), [])
        # a transform that turned the unresolved position into a value is not the same program
        resolved = after.replace("G1 Z#1", "G1 Z4.")
        problems = self.problems(self.mill, UNRESOLVED_PROGRAM, resolved, plan)
        self.assertTrue(any("not resolved" in p for p in problems), problems)
        # and the resolved axes are still compared
        wrong = fake_translate(UNRESOLVED_PROGRAM, 1, 9, 3)
        self.assertNotEqual(self.problems(self.mill, UNRESOLVED_PROGRAM, wrong, plan), [])

    def test_machine_positions_must_stay(self) -> None:
        text = MILL_PROGRAM.replace("G0 Z10.\nM30", "G53 Z0.\nM30")
        after = fake_translate(text, 1, 2, 3)
        self.assertEqual(self.problems(self.mill, text, after, plan_translate(1, 2, 3)), [])
        moved = after.replace("G53 Z0.", "G53 Z3.")
        self.assertNotEqual(self.problems(self.mill, text, moved, plan_translate(1, 2, 3)), [])

    def test_identity_and_the_round_trip(self) -> None:
        self.assertEqual(first_differences(MILL_PROGRAM, MILL_PROGRAM), [])
        self.assertNotEqual(first_differences(MILL_PROGRAM, MILL_PROGRAM.replace("X20", "X20.0")), [])
        there = fake_translate(MILL_PROGRAM, 2.5, -1, 4)
        self.assertEqual(value_differences(MILL_PROGRAM, fake_translate(there, -2.5, 1, -4)), [])
        # a number is a number: X5 and X5.000 and X+5 are the same value
        self.assertEqual(value_differences("G1 X5 Y-.5", "G1 X5.000 Y-0.50"), [])
        self.assertEqual(value_differences("L X+10 Y+5", "L X10 Y5"), [])
        self.assertEqual(value_differences("G1 X=AC(5.5)", "G1 X=AC(5.50)"), [])
        # a drift of a thousandth, a changed code, a changed sign and a changed line count are caught
        self.assertNotEqual(value_differences(MILL_PROGRAM, fake_translate(there, -2.5, 1, -3.999)), [])
        self.assertNotEqual(value_differences("G1 X5", "G2 X5"), [])
        self.assertNotEqual(value_differences("G1 X5", "G1 X-5"), [])
        self.assertNotEqual(value_differences("G1 X5", "G1 X5\nG1 X5"), [])
        self.assertNotEqual(value_differences("L X+10 DR+", "L X10 DR-"), [])
        # a rotation may add a word, but not lose one
        self.assertEqual(value_differences("G1 X5", "G1 X5 Y0"), [])
        self.assertNotEqual(value_differences("G1 X5 Y1", "G1 X5"), [])
        # four quarter turns give the values back; one does not
        turned = MILL_PROGRAM
        for _ in range(4):
            turned = fake_rotate_90(turned, 10, -5)
        self.assertEqual(value_differences(MILL_PROGRAM, turned), [])
        self.assertNotEqual(value_differences(MILL_PROGRAM, fake_rotate_90(MILL_PROGRAM, 10, -5)), [])

    def test_mirror_twice_allows_only_the_form_the_first_mirror_left(self) -> None:
        # P4a integration: a word keeps the form it is written in, so `X-.5` mirrored about
        # X12.5 is `X25.5`, and mirrored back `X-0.5`; the value and that form are checked,
        # everything else is byte for byte.
        subject = Subject("self", "G1 X-.5 Y0.\nG1 X10.", {})
        def twice(first: str, second: str) -> List[str]:
            outcome = Outcome()
            check_twice(subject, "twice", Run(first, "", []), Run(second, "", []), outcome)
            return outcome.problems
        self.assertEqual(twice("G1 X25.5 Y0.\nG1 X15.", "G1 X-.5 Y0.\nG1 X10."), [])
        self.assertEqual(twice("G1 X25.5 Y-7.5\nG1 X15.", "G1 X-0.5 Y0.0\nG1 X10."), [])
        # a value that does not come back, a form the first mirror did not leave, a word that
        # changed form although the first mirror kept it, and a changed code are caught
        self.assertNotEqual(twice("G1 X25.5 Y0.\nG1 X15.", "G1 X-0.6 Y0.\nG1 X10."), [])
        self.assertNotEqual(twice("G1 X25.5 Y0.\nG1 X15.", "G1 X-0.50 Y0.\nG1 X10."), [])
        self.assertNotEqual(twice("G1 X25.5 Y0.\nG1 X15.", "G1 X-.5 Y0.\nG1 X10.0"), [])
        self.assertNotEqual(twice("G1 X25.5 Y0.\nG1 X15.", "G2 X-0.5 Y0.\nG1 X10."), [])

    def test_a_decimal_comma_and_the_sign_the_first_mirror_left(self) -> None:
        # P4a Wave 1 integration: Klartext programs written with a decimal comma, unsigned, which the
        # mirror writes with a sign once it had to write one (plan §7 #308).
        self.assertEqual(words_of("16 L X241,781 Y286 R0"), [("", Decimal(16)), ("X", Decimal("241.781")), ("Y", Decimal(286)), ("R", Decimal(0))])
        self.assertEqual(value_differences("22 L Y25,969", "22 L X+241,781 Y+25,969"), [])
        self.assertNotEqual(value_differences("22 L Y25,969", "22 L X+241,781 Y+25,968"), [])
        # a comma that separates the values of a cycle stays a separator
        self.assertEqual(words_of("CYCLE81(10,0,2)"), [("CYCLE", Decimal(81)), ("", Decimal(10)), ("", Decimal(0)), ("", Decimal(2))])
        self.assertEqual(value_differences("CYCLE81(10,0,2)", "CYCLE81(10.00,0.00,2)"), [])
        subject = Subject("self", "16 L X241,781 Y286 R0 FMAX", {})
        def twice(first: str, second: str) -> List[str]:
            outcome = Outcome()
            check_twice(subject, "twice", Run(first, "", []), Run(second, "", []), outcome)
            return outcome.problems
        self.assertEqual(twice("16 L X241,781 Y-276 R0 FMAX", "16 L X241,781 Y+286 R0 FMAX"), [])
        # a '+' on a word the first mirror left unsigned, and a value that does not come back, are caught
        self.assertNotEqual(twice("16 L X241,781 Y-276 R0 FMAX", "16 L X+241,781 Y+286 R0 FMAX"), [])
        self.assertNotEqual(twice("16 L X241,781 Y-276 R0 FMAX", "16 L X241,781 Y+285 R0 FMAX"), [])

    def test_the_plans(self) -> None:
        self.assertEqual(plan_rotate(90, 0, 0).axes, {"X": ("Y", -1, Decimal(0)), "Y": ("X", 1, Decimal(0))})
        self.assertEqual(plan_rotate(270).axes["X"][1], 1)  # type: ignore[index]
        self.assertEqual(plan_rotate(450).axes, plan_rotate(90).axes)
        self.assertEqual(plan_rotate(-90).axes, plan_rotate(270).axes)
        self.assertEqual(plan_rotate(360).axes, {"X": ("X", 1, Decimal(0)), "Y": ("Y", 1, Decimal(0))})
        self.assertEqual(plan_mirror("x-axis", 0, 5).axes["Y"], ("Y", -1, Decimal(10)))
        self.assertEqual(plan_mirror("y-axis", -10, 0).axes["X"], ("X", -1, Decimal(-20)))
        self.assertEqual(plan_mirror("line", 0, 0, 90).axes, plan_mirror("y-axis").axes)
        self.assertEqual(plan_mirror("line", 0, 0, 180).axes, plan_mirror("x-axis").axes)
        self.assertEqual(plan_mirror("line", 0, 0, 45).axes["X"], ("Y", 1, Decimal(0)))
        self.assertFalse(plan_mirror("line", 0, 0, 45).exact)
        self.assertFalse(plan_mirror("line", 0, 0, 30).exact)
        self.assertEqual(plan_mirror("z", z0=5).axes, {"Z": ("Z", -1, Decimal(10)), "Y": ("Y", -1, Decimal(0))})

    def test_a_refused_run_is_read_from_its_envelope(self) -> None:
        out = helpers.RunOutput(0, json.dumps({"text": "G1 X1", "findings": [{"line": 1, "severity": "error", "reason": "thread"}]}), "")
        run = read_run(out, "G1 X1")
        self.assertTrue(run.refused)
        self.assertEqual(dict(run.reasons), {"thread": 1})
        self.assertEqual(run.problems, [])
        changed = read_run(out, "G1 X2")
        self.assertTrue(changed.problems)
        warning = read_run(helpers.RunOutput(0, json.dumps({"text": "x", "findings": [{"severity": "warning"}]}), ""), "x")
        self.assertFalse(warning.refused)
        with self.assertRaises(AssertionError):
            read_run(helpers.RunOutput(1, "", "Traceback"), "x")


# ---------------------------------------------------------------------------
# Tests: the goldens and the owner-public programs, per script
# ---------------------------------------------------------------------------


class GoldenOracle:
    """Mixin: the checks on every golden of one script."""

    script = ""

    def cases(self) -> List[Any]:
        cases = [c for c in helpers.geometry_cases(self.script)]
        self.assertTrue(cases, "no golden cases for %s" % self.script)
        return cases

    def test_extents_of_every_golden(self) -> None:
        """``extents.py`` on ``input.nc`` and on the golden's ``expected.nc``."""
        checked = 0
        for case in self.cases():
            with self.subTest(case=case.name):
                if case.refused:
                    continue  # no expected.nc: the input comes back as it was
                subject = golden_subject(case)
                if subject.selection:
                    continue  # the lines above a selection are not transformed: the ranges of the whole cannot be compared
                plan = plan_of_case(self.script, case.params)
                self.assertEqual(subject.oracle(plan, case.input_text(), case.expected_text()), [])
                checked += 1
        self.assertGreater(checked, 0, "every golden is refused or a selection")


class OwnerPublicOracle:
    """Mixin: the checks on every owner-public program."""

    script = ""
    #: The least number of the 20 owner-public programs the transform has to write (refusing
    #: the rest). A refused run is clean by itself, so without a floor a transform that refused
    #: everything would pass. Measured on 2026-10-16 at the default cap of 1,500 lines: translate
    #: wrote 5, rotate 4 (7 programs are not for it: lathes), mirror 5. The floor is one below.
    #: A deliberate new refusal may lower it, in the commit that adds the refusal, never silently.
    written_floor = 0

    def checks(self, subject: Subject) -> Outcome:
        raise NotImplementedError

    def test_every_owner_public_program(self) -> None:
        written = 0
        for rel, subject in owner_subjects().items():
            with self.subTest(program=rel):
                outcome = self.checks(subject)
                subject.outcomes[self.script] = outcome
                assert_clean(self, outcome)
                if outcome.status in ("transformed", "mixed"):
                    written += 1
        if MAX_LINES == DEFAULT_MAX_LINES:  # a longer prefix refuses more, so the floor is for the default cap
            self.assertGreaterEqual(
                written, self.written_floor,
                "%s wrote %d of the owner-public programs, the floor is %d: a new refusal? lower the floor on purpose, with a reason"
                % (self.script, written, self.written_floor),
            )


class TranslateOracleTest(GoldenOracle, OwnerPublicOracle, unittest.TestCase):
    """X19: the shifted ranges, shift 0 byte for byte, and d then -d."""

    script = "translate"
    written_floor = 4

    @classmethod
    def setUpClass(cls) -> None:
        require_script("translate")

    def checks(self, subject: Subject) -> Outcome:
        return check_translate(subject, shift_of(subject))

    def test_identity_and_round_trip_of_every_golden(self) -> None:
        for case in self.cases():
            with self.subTest(case=case.name):
                if case.refused:
                    continue
                outcome = check_translate(golden_subject(case), dict(case.params))
                assert_clean(self, outcome)
                self.assertEqual(outcome.status, "transformed")


class RotateOracleTest(GoldenOracle, OwnerPublicOracle, unittest.TestCase):
    """X20: the turned ranges (90, 180, 270), rotate by 0 and 360 byte for byte, four quarter turns."""

    script = "rotate"
    written_floor = 3

    @classmethod
    def setUpClass(cls) -> None:
        require_script("rotate")

    def checks(self, subject: Subject) -> Outcome:
        return check_rotate(subject, CENTRE)

    def test_identity_and_round_trip_of_every_golden(self) -> None:
        for case in self.cases():
            with self.subTest(case=case.name):
                if case.refused:
                    continue
                centre = {"cx": case.params.get("cx", 0), "cy": case.params.get("cy", 0)}
                outcome = check_rotate(golden_subject(case), centre)
                assert_clean(self, outcome)


class MirrorOracleTest(GoldenOracle, OwnerPublicOracle, unittest.TestCase):
    """X21: the reflected ranges (axis mirrors, lathe Z mirror) and mirror twice byte for byte."""

    script = "mirror"
    written_floor = 4

    @classmethod
    def setUpClass(cls) -> None:
        require_script("mirror")

    def checks(self, subject: Subject) -> Outcome:
        return check_mirror(subject, MILL_MIRRORS + LATHE_MIRRORS)

    def test_twice_of_every_golden(self) -> None:
        for case in self.cases():
            with self.subTest(case=case.name):
                if case.refused:
                    continue
                outcome = check_mirror(golden_subject(case), (dict(case.params),))
                assert_clean(self, outcome)
                self.assertEqual(outcome.status, "transformed")


class RefusalCountTest(unittest.TestCase):
    """Prints, and does not assert, what each transform refuses on every owner-public program."""

    def test_print_the_refusal_counts(self) -> None:
        present = list(SCRIPT_FILES)
        for name in present:
            require_script(name)
        lines = ["", "P4.5 refusal counts: %s" % (("first %d lines of each program" % MAX_LINES) if MAX_LINES > 0 else "whole programs")]
        totals: Dict[str, "collections.Counter[str]"] = {name: collections.Counter() for name in present}
        reasons: Dict[str, "collections.Counter[str]"] = {name: collections.Counter() for name in present}
        for rel, subject in owner_subjects().items():
            parts = []
            for name in present:
                outcome = subject.outcomes.get(name)
                if outcome is None:
                    if name == "translate":
                        outcome = check_translate(subject, shift_of(subject))
                    elif name == "rotate":
                        outcome = check_rotate(subject, CENTRE)
                    else:
                        outcome = check_mirror(subject, MILL_MIRRORS + LATHE_MIRRORS, twice=False)
                    subject.outcomes[name] = outcome
                totals[name][outcome.status] += 1
                reasons[name].update(outcome.reasons)
                detail = ""
                if outcome.status in ("refused", "mixed") and outcome.reasons:
                    detail = " (%s)" % ", ".join("%s %d" % item for item in sorted(outcome.reasons.items()))
                parts.append("%s %s%s" % (name, outcome.status, detail))
            lines.append("%-48s %5d lines  %s" % (rel, len(subject.text.split("\n")), "; ".join(parts)))
        for name in present:
            lines.append(
                "%-9s %s; reasons: %s"
                % (
                    name,
                    ", ".join("%d %s" % (n, status) for status, n in sorted(totals[name].items())),
                    ", ".join("%s %d" % item for item in sorted(reasons[name].items())) or "none",
                )
            )
        print("\n".join(lines))


if __name__ == "__main__":
    unittest.main()
