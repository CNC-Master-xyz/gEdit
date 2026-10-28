"""The adversarial fuzz review of the P4a transforms (Phase 4 plan section 4 rule 7; exit
criteria X19 to X22; section 7 #310): ``translate.py``, ``rotate.py`` and ``mirror.py`` on
random programs of every built-in profile.

A seeded generator writes plausible programs for each built-in code set (Fanuc milling, the
Fanuc lathe in G-code system A and B, Klartext, the Okuma lathe, Sinumerik turning and milling)
and the three transforms are held to the properties the plan names:

==========================  ===================================================================
translate by 0, 0, 0        the program back byte for byte (where it is not refused)
translate by d, then -d     every word back with its value
rotate by 0 and by 360      the program back byte for byte (milling profiles)
rotate by 90, four times    every word back with its value; the extents of 1, 2 and 3 quarter
                            turns are the turned extents
mirror twice                byte for byte, except a word the first mirror had to write in a new
                            form (plan section 7 #310; ``test_geometry_oracle.check_twice``)
the extents oracle          the extents of the result are the extents of the original moved the
                            way the transform says (``test_geometry_oracle.check_extents``), on
                            every program the transform does not refuse; at an angle that is not
                            a right one, the bounds check
all or nothing              a refused run hands the input back unchanged, and every error names
                            a reason id of ``_nc_geom.REASONS`` (or a run reason) and a line of
                            the program; information and warnings carry their own ids
never a crash               every run ends with an envelope, and ``extents.py`` with a report
the path oracle             every block's end point and every arc's centre and direction of the
                            result (read by ``_nc_path.PathTracker``) are the original's, moved;
                            the ranges alone miss a point moved wrong inside them, or an arc that
                            turns the wrong way between the same end points
a turn or a mirror at       rotate by an angle and back, mirror about a line at an angle twice:
another angle               the path back within twice the rounding tolerance (Q4-4)
doing nothing refuses       a shift by 0 or a turn by 0 refuses no reason that the shift or the
nothing more                turn by 90 does not also give
a selection                 a random span of the program, primed with the lines above it, writes
                            the whole run's words (it may add the axes its first move inherits),
                            and refuses where the whole run refuses a block inside it
==========================  ===================================================================

Three things the plan's wording does not cover are allowed, each with its reason (findings
FZ-1 to FZ-3 and FZ-10 of the review): a Klartext ``PA`` comes back from four quarter turns up to whole
turns (plan §7 #306 keeps it in -360 to +360); mirror twice may lose the leading zeros of a
padded word (every rewrite drops them, ``format_number``) and a ``+`` the first mirror had to
replace by a ``-``, as #310 allows the decimals; and under a rotation the rows of a tool or a
work offset may grow by the position of a word the rotation adds (they list written axes only); under
a Sinumerik frame (``ATRANS`` and its kin) the zero increment word a rotation adds
(``G91 G1 X-33.1`` turned is ``X0.000 Y-33.1``) is one more position the extents cannot resolve,
though it moves nothing (FZ-10, the Sinumerik twin of FZ-3). Since the manual-check fix round
(D6-7) the shipped Sinumerik profiles refuse to turn or mirror such an increment, because with
the setting SD42440 at 1 it travels the change of the shift as well (``shift-increment``); the
reading stays for a machine whose increments do not (``syntax.incrementTravelsShift`` off).

**How the scripts are run.** In this process, not as a child process: ``main()`` of each
script is called with ``gedit_nc.load_context``, ``gedit_nc.read_input`` and the JSON writer
swapped for the run (a child process costs over a second at background priority; a run in
process a few milliseconds). Each run gets a fresh context dictionary over the same profile and
code database objects, which is what a script process sees. A violation found here is checked
again as a child process (``helpers.run_script``) before it goes into a finding.

**Counts and seeds.** The default run (the normal Python suite) writes ``DEFAULT_PROGRAMS``
programs per profile set and must stay well under 20 seconds. The review run is larger:

    GEDIT_FUZZ_PROGRAMS=400 GEDIT_FUZZ_SEED=20262017 GEDIT_FUZZ_REPORT=/tmp/fuzz.jsonl \\
        taskpolicy -b python3 -B -S -m unittest tests.python.test_geometry_fuzz.GeometryFuzzTest

(at background priority a program takes about a second; the seven sets can run as seven
processes, one ``-k`` each, e.g. ``-k test_klartext``).

``GEDIT_FUZZ_PROGRAMS`` is the number of programs per profile set, ``GEDIT_FUZZ_SEED`` the base
seed (program ``i`` of set ``s`` uses the seed ``base + 1000003 * index(s) + i``, so one program
is reproduced alone with ``GEDIT_FUZZ_ONLY=<set>:<i>``), ``GEDIT_FUZZ_REPORT=<path>`` writes
every violation as JSON lines for the review. ``GEDIT_FUZZ_OPEN=1`` also generates the forms
that the open findings below keep out of the random run (to see them again).

**Open findings.** A violation the review found and the transforms still show is an
``FZ-n`` of ``OPEN_FINDINGS``: its minimal repro is a test of ``KnownFindingTest`` marked
``expectedFailure``, and the generator leaves out the form that produces it, so the random run
stays green. The batch that fixes FZ-n removes the ``expectedFailure`` (the repro then passes)
and the entry of ``OPEN_FINDINGS`` (the generator writes the form again).

Python 3.9, standard library only. The programs are synthetic, written here.
"""

from __future__ import annotations

import collections
import contextlib
import copy
import importlib.util
import io
import json
import math
import os
import random
import re
import traceback
import unittest
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from decimal import Decimal
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from tests.python import helpers
from tests.python import test_geometry_oracle as oracle

#: Programs per profile set in the normal suite, and the base seed.
DEFAULT_PROGRAMS = 6
DEFAULT_SEED = 20261017
PROGRAMS = int(os.environ.get("GEDIT_FUZZ_PROGRAMS", str(DEFAULT_PROGRAMS)))
SEED = int(os.environ.get("GEDIT_FUZZ_SEED", str(DEFAULT_SEED)))
ONLY = os.environ.get("GEDIT_FUZZ_ONLY", "")
REPORT = os.environ.get("GEDIT_FUZZ_REPORT", "")
GENERATE_OPEN = os.environ.get("GEDIT_FUZZ_OPEN", "") not in ("", "0")

#: The findings of the review that are still open: id -> the generator feature that shows it
#: (left out of the random run while the finding is open; see the module docstring).
OPEN_FINDINGS: Dict[str, str] = {}


def feature_on(name: str) -> bool:
    """Whether the generator writes the form ``name`` (an open finding keeps it out)."""
    return GENERATE_OPEN or name not in OPEN_FINDINGS.values()


# ---------------------------------------------------------------------------
# Running the scripts in this process
# ---------------------------------------------------------------------------

SCRIPT_NAMES = ("translate", "rotate", "mirror", "extents")


@dataclass
class Outcome:
    """One run: the envelope (``payload``) or why there is none (``crash``)."""

    payload: Optional[Dict[str, Any]]
    crash: str = ""

    @property
    def text(self) -> str:
        return str((self.payload or {}).get("text", ""))

    @property
    def findings(self) -> List[Dict[str, Any]]:
        return list((self.payload or {}).get("findings") or [])

    @property
    def refused(self) -> bool:
        return any(f.get("severity") == "error" for f in self.findings)

    @property
    def reasons(self) -> "collections.Counter[str]":
        return collections.Counter(str(f.get("reason", "?")) for f in self.findings if f.get("severity") == "error")


class Scripts:
    """The four scripts, imported once, and a way to run one on a text with a context."""

    _instance: Optional["Scripts"] = None

    def __init__(self) -> None:
        self.nc = helpers.import_gedit_nc()
        self.modules: Dict[str, Any] = {}
        for name in SCRIPT_NAMES:
            helpers.require_script(name + ".py")
            spec = importlib.util.spec_from_file_location("gedit_fuzz_" + name, str(helpers.SCRIPTS_DIR / (name + ".py")))
            assert spec is not None and spec.loader is not None
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)  # type: ignore[union-attr]
            self.modules[name] = module
        import _nc_geom  # noqa: E402 (on sys.path once gedit_nc is)

        self.geom = _nc_geom
        self.run_reasons = set(getattr(self.modules["rotate"], "RUN_REASONS", {})) | set(getattr(self.modules["mirror"], "RUN_REASONS", {}))
        self.run_reasons |= {"no-database", "selection-unprimed", "selection-start"}
        #: The information rows a script writes itself (translate: a word added to a selection's
        #: first move, v1.2.0 D4).
        self.own_info = set(getattr(self.modules["translate"], "OWN_INFO", {}))

    @classmethod
    def get(cls) -> "Scripts":
        if cls._instance is None:
            cls._instance = Scripts()
        return cls._instance

    def run(
        self, name: str, text: str, context: Dict[str, Any], params: Optional[Dict[str, Any]] = None,
        preceding: Optional[List[str]] = None, following: Optional[List[str]] = None,
    ) -> Outcome:
        """``name``'s ``main()`` on ``text`` with ``params``: the whole document, or (with
        ``preceding``, the lines above it) a selection that starts below those lines; ``following``
        are the lines below it (``input.followingLines``, FZ-5), left out when ``None``."""
        run_context = dict(context)
        run_context["params"] = dict(params or {})
        run_context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
        if preceding is not None:
            start = len(preceding) + 1
            run_context["input"] = {"scope": "selection", "startLine": start, "endLine": start + len(text.split("\n")) - 1, "precedingLines": list(preceding)}
            if following is not None:
                run_context["input"]["followingLines"] = list(following)
        captured: List[Dict[str, Any]] = []
        nc = self.nc
        saved = (nc.load_context, nc.read_input, nc._write_json)
        nc.load_context = lambda: run_context
        nc.read_input = lambda: text.split("\n")
        nc._write_json = lambda payload: captured.append(json.loads(json.dumps(payload, ensure_ascii=False)))
        out, err = io.StringIO(), io.StringIO()
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = self.modules[name].main()
        except BaseException:  # noqa: B902 - a crash of any kind is what is looked for
            return Outcome(None, "%s raised:\n%s" % (name, traceback.format_exc()[-3000:]))
        finally:
            nc.load_context, nc.read_input, nc._write_json = saved
        if code not in (0, None):
            return Outcome(None, "%s returned %r: %s" % (name, code, err.getvalue()[-1500:]))
        if len(captured) != 1:
            return Outcome(None, "%s wrote %d results: %s" % (name, len(captured), err.getvalue()[-1500:]))
        return Outcome(captured[0])

    def run_child(self, name: str, text: str, context: Dict[str, Any], params: Optional[Dict[str, Any]] = None) -> Outcome:
        """The same run as a child process, the way the app runs it (to confirm a finding)."""
        run_context = copy.deepcopy(context)
        run_context["params"] = dict(params or {})
        run_context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
        out = helpers.run_script(name + ".py", stdin=text, context=run_context)
        if not out.ok:
            return Outcome(None, "exit %d: %s" % (out.returncode, out.stderr[-1500:]))
        return Outcome(out.json())


# ---------------------------------------------------------------------------
# The profile sets
# ---------------------------------------------------------------------------


@dataclass
class ProfileSet:
    """One built-in code set the generator writes for, and the contexts it runs in."""

    name: str
    kind: str  # "fanuc-mill", "fanuc-lathe-a", "fanuc-lathe-b", "klartext", "okuma", "sinumerik-turn", "sinumerik-mill"
    lathe: bool
    contexts: List[Tuple[str, Callable[[], Dict[str, Any]]]]


def golden_machine(script: str, case: str) -> Callable[[], Dict[str, Any]]:
    """The effective context of a golden's machine (``case.json`` with a ``machine`` member)."""
    return lambda: helpers.effective_context(golden=helpers.SCRIPT_FIXTURES_DIR / script / case / "case.json")


PROFILE_SETS: List[ProfileSet] = [
    ProfileSet(
        "fanuc-mill",
        "fanuc-mill",
        False,
        [("no machine", lambda: helpers.effective_context("fanuc-gcode")), ("IS-B", lambda: helpers.effective_context("fanuc-gcode", preset="is-b"))],
    ),
    ProfileSet(
        "fanuc-lathe-a",
        "fanuc-lathe-a",
        True,
        [("no machine", lambda: helpers.effective_context("fanuc-lathe")), ("system A", lambda: helpers.effective_context("fanuc-lathe", variant=("gcodeSystem", "A")))],
    ),
    ProfileSet("fanuc-lathe-b", "fanuc-lathe-b", True, [("system B", golden_machine("translate", "lathe-b-shift"))]),
    ProfileSet("klartext", "klartext", False, [("no machine", lambda: helpers.effective_context("heidenhain-klartext"))]),
    ProfileSet(
        "okuma",
        "okuma",
        True,
        [("calculator", golden_machine("translate", "okuma-lathe-shift")), ("1 um", lambda: helpers.effective_context("okuma-osp", preset="okuma-1um"))],
    ),
    ProfileSet("sinumerik-turn", "sinumerik-turn", True, [("no machine", lambda: helpers.effective_context("sinumerik"))]),
    ProfileSet("sinumerik-mill", "sinumerik-mill", False, [("no machine", lambda: helpers.effective_context("sinumerik-mill"))]),
]

_CONTEXTS: Dict[Tuple[str, str], Dict[str, Any]] = {}


def context_of(profile_set: ProfileSet, label: str) -> Dict[str, Any]:
    key = (profile_set.name, label)
    if key not in _CONTEXTS:
        _CONTEXTS[key] = dict(dict(profile_set.contexts)[label]())
    return _CONTEXTS[key]


# ---------------------------------------------------------------------------
# The generator
# ---------------------------------------------------------------------------

D0 = Decimal(0)


def q(value: float, places: int = 3) -> Decimal:
    """``value`` rounded to ``places`` decimals, as a decimal (``-0`` is ``0``)."""
    out = Decimal(repr(round(value, places))).quantize(Decimal(1).scaleb(-places))
    return out if out != 0 else D0


class Gen:
    """A program being written: the lines, the position the generator knows (geometric, a
    lathe's X as a radius), and the written forms chosen for this program.

    The generator does not have to be right about the NC program in every detail (the
    transforms decide what they accept); it has to write programs that a CAM system or a
    programmer could write, so that most of them are moved and the properties are tested."""

    def __init__(self, rng: random.Random, kind: str, inch: bool = False) -> None:
        self.rng = rng
        self.kind = kind
        self.inch = inch
        self.lines: List[str] = []
        self.pos: Dict[str, Optional[Decimal]] = {}
        self.features: "collections.Counter[str]" = collections.Counter()
        self.places = 4 if inch else 3
        self.scale = 0.04 if inch else 1.0
        # the written form of this program
        self.style = rng.choice(["point", "point", "zero", "lead"])  # 10. / 10.0 / .5 without the 0
        self.pack = rng.random() < 0.2  # G1X10.Y5. (not Klartext)
        self.numbering = rng.choice(["none", "none", "all", "some"])
        self.step = rng.choice([1, 2, 5, 10])
        self.block = rng.choice([0, 1, 10]) if kind != "klartext" else 0
        self.points = True  # a Fanuc point-less word depends on the machine
        self.pointless = False  # the context reads point-less words (IS-B, a calculator machine)
        #: A clean program writes no form that a transform refuses by design (a variable in a
        #: moved word, a frame, a call, a plane other than XY, a turned rotary axis ...), so
        #: that most programs are moved and the properties of a written run are tested.
        self.clean = rng.random() < 0.6
        #: Cycles at all (the lathe Z mirror refuses the turning cycles and threads by design).
        self.cycles = rng.random() < 0.6
        self.motion: Optional[str] = None
        self.wild = rng.random() < 0.25

    # -- numbers ---------------------------------------------------------------------------

    def coord(self, lo: float, hi: float) -> Decimal:
        places = self.rng.choice([0, 0, 1, 2, 3] if not self.inch else [0, 1, 2, 3, 4])
        return q(self.rng.uniform(lo, hi) * self.scale, places)

    def num(self, value: Decimal) -> str:
        """``value`` in the form this program writes numbers; a wild program writes some numbers
        in a rarer form of the same value (a plus sign, leading or trailing zeros, a decimal
        comma, a blank after the address)."""
        text = self.num_plain(value)
        if self.wild and self.rng.random() < 0.2:
            text = self.wilder(text)
        return text

    def wilder(self, text: str) -> str:
        sign = "-" if text.startswith("-") else ""
        body = text.lstrip("+-")
        choice = self.rng.random()
        if self.kind == "klartext":
            if "." in body and choice < 0.5:
                self.features["decimal-comma"] += 1
                return (text[0] if text[0] in "+-" else "") + body.replace(".", ",")
            if choice < 0.8 and not sign and text.startswith("+"):
                self.features["unsigned"] += 1
                return body
            return text
        if choice < 0.25 and not sign:
            self.features["plus-sign"] += 1
            return "+" + body
        if choice < 0.45 and body[:1].isdigit():
            self.features["leading-zero"] += 1
            return sign + "0" + body
        if choice < 0.7 and "." in body:
            self.features["trailing-zero"] += 1
            return text + "0"
        if choice < 0.8 and self.kind in ("fanuc-mill", "fanuc-lathe-a", "fanuc-lathe-b") and not self.pack:
            self.features["blank-after-address"] += 1
            return " " + text
        if choice < 0.9 and body.replace(".", "").strip("0") == "" and "." in body:
            self.features["minus-zero"] += 1
            return "-" + body
        return text

    def num_plain(self, value: Decimal) -> str:
        value = Decimal(value)
        if value == 0:
            value = D0
        if self.kind == "klartext":
            text = format(value.normalize(), "f") if value != value.to_integral_value() else str(int(value))
            if text.startswith("-"):
                return text
            return ("+" + text) if self.rng.random() < 0.9 else text
        text = format(value.normalize(), "f")
        if value == value.to_integral_value():
            text = str(int(value))
        has_point = "." in text
        if self.kind in ("fanuc-mill", "fanuc-lathe-a", "fanuc-lathe-b") or (self.kind == "okuma" and self.rng.random() < 0.7):
            if self.pointless and not has_point and self.rng.random() < 0.3:
                return text  # a point-less whole number, read in increments by the machine
            if not has_point:
                text = text + (".0" if self.style == "zero" else ".")
            elif self.style == "lead" and text.lstrip("-").startswith("0."):
                text = text.replace("0.", ".", 1)
            return text
        if self.rng.random() < 0.15 and not has_point:
            return text + ".0"
        return text

    # -- lines -----------------------------------------------------------------------------

    def words(self, *parts: str) -> str:
        parts = tuple(p for p in parts if p)
        if self.kind != "klartext" and len(parts) > 2 and self.rng.random() < 0.04:
            # the words of a block in another order (the controls read them in any order)
            shuffled = list(parts)
            self.rng.shuffle(shuffled)
            parts = tuple(shuffled)
            self.features["word-order"] += 1
        if self.pack and self.kind not in ("klartext",) and not any("=" in p or "(" in p for p in parts):
            return "".join(parts)
        return " ".join(parts)

    def track_motion(self, text: str) -> None:
        """The motion code in force after ``text`` (a cycle code leaves none the generator uses)."""
        body = text.split("(")[0].split(";")[0]
        cycles = r"G(?:7[0-9]|8[0-9]|32|76)" + (r"|G9[024]" if self.kind == "fanuc-lathe-a" else "")
        if re.search(r"(?:%s)(?![0-9.])" % cycles, body) or "CYCLE" in body:
            self.motion = None
        for match in re.finditer(r"G0?([0-3])(?![0-9.])", body):
            self.motion = "G" + match.group(1)

    def line_code(self) -> str:
        """G1, G0, or nothing where a straight move is in force."""
        return self.rng.choice(["G1", "G1", "G0"] + ([""] if self.motion in ("G0", "G1") else []))

    def arc_code(self) -> str:
        """G2 or G3, or nothing (the arc code in force) now and then."""
        if self.motion in ("G2", "G3") and self.rng.random() < 0.3:
            self.features["arc-modal"] += 1
            return ""
        return self.rng.choice(["G2", "G3"])

    def emit(self, text: str, number: bool = True) -> None:
        self.track_motion(text)
        if self.rng.random() < 0.05 and not text.startswith(("(", ";")) and not text.endswith("~"):
            text = text + " " + self.comment("NOTE %d" % self.rng.randint(1, 99))  # a comment behind the words
            self.features["trailing-comment"] += 1
        if self.kind == "klartext":
            self.lines.append("%d %s" % (len(self.lines), text) if number else text)
            return
        if number and (self.numbering == "all" or (self.numbering == "some" and self.rng.random() < 0.4)):
            self.block += self.step
            text = "N%d %s" % (self.block, text) if not self.pack else "N%d%s" % (self.block, text)
        self.lines.append(text)

    def comment(self, text: str) -> str:
        if self.kind in ("klartext", "sinumerik-turn", "sinumerik-mill"):
            return "; " + text
        return "(" + text + ")"

    def text(self) -> str:
        return "\n".join(self.lines) + ("\n" if self.rng.random() < 0.7 else "")

    def known(self, *axes: str) -> bool:
        return all(self.pos.get(a) is not None for a in axes)

    def forget(self, *axes: str) -> None:
        for axis in axes:
            self.pos[axis] = None

    def chance(self, p: float) -> bool:
        return self.rng.random() < p

    def risky(self, p: float = 1.0) -> bool:
        """Whether to write a form that is refused by design (never in a clean program)."""
        return not self.clean and self.rng.random() < p


def arc_end(rng: random.Random, start: Tuple[Decimal, Decimal], scale: float, places: int, big: bool = True) -> Tuple[Tuple[Decimal, Decimal], Tuple[Decimal, Decimal], float]:
    """A centre offset (from ``start``) and an end point on that circle: ``(offset, end, radius)``."""
    while True:
        oi = q(rng.uniform(-30, 30) * scale, rng.choice([0, 1, 2, places]))
        oj = q(rng.uniform(-30, 30) * scale, rng.choice([0, 1, 2, places]))
        r = math.hypot(float(oi), float(oj))
        if r > 1.0 * scale:
            break
    cx, cy = float(start[0] + oi), float(start[1] + oj)
    a0 = math.atan2(float(start[1]) - cy, float(start[0]) - cx)
    sweep = rng.uniform(0.2, 2 * math.pi - 0.2) if big else rng.uniform(0.2, math.pi - 0.2)
    a1 = a0 + sweep * rng.choice([1, -1])
    end = (q(cx + r * math.cos(a1), places), q(cy + r * math.sin(a1), places))
    return (oi, oj), end, r


def radius_arc(rng: random.Random, start: Tuple[Decimal, Decimal], scale: float, places: int) -> Tuple[Tuple[Decimal, Decimal], Decimal]:
    """An end point and a radius ``R`` for an arc from ``start`` (negative: over 180 degrees)."""
    while True:
        end = (q(float(start[0]) + rng.uniform(-40, 40) * scale, rng.choice([0, 1, 2, places])), q(float(start[1]) + rng.uniform(-40, 40) * scale, rng.choice([0, 1, 2, places])))
        chord = math.hypot(float(end[0] - start[0]), float(end[1] - start[1]))
        if chord > 1.0 * scale:
            break
    radius = q(chord / 2 * rng.uniform(1.05, 3.0), rng.choice([0, 1, 2, places]))
    while float(radius) * 2 < chord + 0.01 * scale:
        radius += Decimal(1)
    return end, radius if rng.random() < 0.7 else -radius


# -- Fanuc milling ---------------------------------------------------------------------------

MILL_PLANES = {"G17": ("X", "Y", "I", "J", "Z"), "G18": ("Z", "X", "K", "I", "Y"), "G19": ("Y", "Z", "J", "K", "X")}


def fanuc_mill(g: Gen) -> None:
    rng = g.rng
    g.pos = {"X": None, "Y": None, "Z": None}
    if g.chance(0.5):
        g.lines.append("%")
    if g.chance(0.6):
        g.lines.append("O%04d %s" % (rng.randint(1, 9999), g.comment("FUZZ")) if g.chance(0.5) else "O%04d" % rng.randint(1, 9999))
    g.emit(g.comment("WRITTEN BY THE GEOMETRY FUZZER"))
    start = ["G20" if g.inch else "G21", "G17", "G90"] + rng.sample(["G40", "G80", "G49", "G54", "G94"], rng.randint(0, 4))
    if g.risky(0.1):
        start.remove("G90")  # the distance mode only assumed (Q4-5)
        g.features["distance-assumed"] += 1
    rng.shuffle(start)
    g.emit(g.words(*start))
    g.mode, g.plane = "G90", "G17"
    if g.chance(0.6):
        g.emit(g.words("T%d" % rng.randint(1, 20), "M6"))
    x, y, z = g.coord(-80, 80), g.coord(-80, 80), g.coord(5, 50)
    if g.chance(0.5):
        g.emit(g.words("G0", "X" + g.num(x), "Y" + g.num(y), "S%d" % rng.randint(500, 9000), "M3"))
        g.emit(g.words("G43", "Z" + g.num(z), "H%d" % rng.randint(1, 20)) if g.chance(0.5) else g.words("Z" + g.num(z)))
    else:
        g.emit(g.words("G0", "X" + g.num(x), "Y" + g.num(y), "Z" + g.num(z)))
    g.pos.update(X=x, Y=y, Z=z)
    g.comp = False
    for _ in range(rng.randint(3, 22)):
        if not (g.chance(0.12) and fanuc_mill_extra(g)):
            fanuc_mill_segment(g)
    g.emit(g.words("G90" if g.mode != "G90" else "", "G0", "Z" + g.num(g.coord(20, 80))))
    if g.chance(0.3):
        g.emit(g.words("G91", "G28", "Z0." if g.points else "Z0"))
        g.features["machine-return"] += 1
    g.emit("M30")
    if g.lines[0] == "%":
        g.lines.append("%")


def mode_word(g: Gen, mode: str) -> str:
    """The distance code to write for ``mode`` (only when it changes, sometimes again anyway)."""
    if g.mode != mode or g.chance(0.15):
        g.mode = mode
        return mode
    return ""


def fanuc_mill_segment(g: Gen) -> None:
    rng = g.rng
    roll = rng.random()
    a, b, ci, cj, n = MILL_PLANES[g.plane]
    if not g.known("X", "Y", "Z"):
        # after a machine position or a cycle: back to a known point first
        x, y, z = g.coord(-80, 80), g.coord(-80, 80), g.coord(2, 30)
        g.emit(g.words(mode_word(g, "G90") or ("G90" if g.chance(0.3) else ""), "G0", "X" + g.num(x), "Y" + g.num(y), "Z" + g.num(z)))
        g.pos.update(X=x, Y=y, Z=z)
        return
    if roll < 0.28:  # a straight move, absolute or incremental
        code = g.line_code()
        axes = rng.sample(["X", "Y", "Z"], rng.randint(1, 3))
        incremental = g.chance(0.25)
        parts = [mode_word(g, "G91" if incremental else "G90"), code]
        for axis in sorted(axes):
            if incremental:
                d = g.coord(-30, 30)
                parts.append(axis + g.num(d))
                g.pos[axis] = g.pos[axis] + d  # type: ignore[operator]
            else:
                v = g.coord(-80, 80) if axis != "Z" else g.coord(-20, 30)
                parts.append(axis + g.num(v))
                g.pos[axis] = v
        if code == "G1" and g.chance(0.4):
            parts.append("F" + g.num(g.coord(50, 2000)))
        g.emit(g.words(*parts))
        g.features["line-inc" if incremental else "line-abs"] += 1
    elif roll < 0.50:  # an arc in the plane in force, by its centre or by R, maybe a helix
        incremental = g.chance(0.2)
        start = (g.pos[a], g.pos[b])
        code = g.arc_code()
        parts = [mode_word(g, "G91" if incremental else "G90"), code]
        if g.chance(0.6):
            full = g.chance(0.1)
            (oi, oj), end, _ = arc_end(rng, start, g.scale, g.places)  # type: ignore[arg-type]
            if full:
                end = start  # type: ignore[assignment]
            words = []
            for axis, value, base in ((a, end[0], start[0]), (b, end[1], start[1])):
                if full and g.chance(0.6):
                    continue
                words.append(axis + g.num(value - base if incremental else value))  # type: ignore[operator]
            centre = [ci + g.num(oi), cj + g.num(oj)]
            if oi == 0 and g.chance(0.5):
                centre = [cj + g.num(oj)]
            parts += sorted(words) + centre
            g.features["arc-full" if full else "arc-centre"] += 1
        else:
            end, radius = radius_arc(rng, start, g.scale, g.places)  # type: ignore[arg-type]
            parts += [a + g.num(end[0] - start[0] if incremental else end[0]), b + g.num(end[1] - start[1] if incremental else end[1]), "R" + g.num(radius)]  # type: ignore[operator]
            g.features["arc-radius"] += 1
        if g.chance(0.15):  # a helix
            d = g.coord(-5, 5)
            parts.insert(4, n + g.num(d if incremental else g.pos[n] + d))  # type: ignore[operator]
            g.pos[n] = g.pos[n] + d  # type: ignore[operator]
            g.features["helix"] += 1
        if g.chance(0.3):
            parts.append("F" + g.num(g.coord(50, 2000)))
        g.emit(g.words(*parts))
        g.pos[a], g.pos[b] = end
    elif roll < 0.58:  # compensation on or off with a move
        x, y = g.coord(-80, 80), g.coord(-80, 80)
        if g.comp:
            g.emit(g.words(mode_word(g, "G90"), "G40", "G1" if g.chance(0.5) else "G0", "X" + g.num(x), "Y" + g.num(y)))
            g.comp = False
            g.features["comp-off"] += 1
        else:
            side = rng.choice(["G41", "G42"])
            g.emit(g.words(mode_word(g, "G90"), side, "G1", "X" + g.num(x), "Y" + g.num(y), "D%d" % rng.randint(1, 30)))
            g.comp = True
            g.features["comp-on"] += 1
        g.pos.update(X=x, Y=y)
    elif roll < 0.68 and g.plane == "G17":  # a drilling cycle and its positions
        code = rng.choice(["G81", "G81", "G82", "G83", "G73", "G85", "G86", "G89"])
        if g.motion in ("G2", "G3"):
            if feature_on("cycle-after-arc"):
                g.features["cycle-after-arc"] += 1
            else:
                g.emit(g.words("G0", "Z" + g.num(g.pos["Z"])))  # type: ignore[arg-type]
        incremental = g.chance(0.15)
        ret = rng.choice(["G98", "G99", ""])
        x, y = g.coord(-80, 80), g.coord(-80, 80)
        if incremental:
            parts = [mode_word(g, "G91"), ret, code, "X" + g.num(x - g.pos["X"]), "Y" + g.num(y - g.pos["Y"]), "Z" + g.num(g.coord(-30, -2)), "R" + g.num(-g.coord(1, 20))]  # type: ignore[operator]
        else:
            parts = [mode_word(g, "G90"), ret, code, "X" + g.num(x), "Y" + g.num(y), "Z" + g.num(g.coord(-30, -1)), "R" + g.num(g.coord(1, 10))]
        if code in ("G83", "G73"):
            parts.append("Q" + g.num(g.coord(0.5, 5)))
        if code in ("G82", "G89"):
            parts.append("P%d" % rng.randint(100, 2000))
        parts.append("F" + g.num(g.coord(50, 500)))
        g.emit(g.words(*parts))
        for _ in range(rng.randint(0, 4)):
            if incremental:
                g.emit(g.words("X" + g.num(g.coord(-20, 20)), "Y" + g.num(g.coord(-20, 20)) if g.chance(0.5) else ""))
            else:
                g.emit(g.words("X" + g.num(g.coord(-80, 80)), "Y" + g.num(g.coord(-80, 80)) if g.chance(0.6) else ""))
        g.emit("G80")
        g.forget("X", "Y", "Z")
        g.features["drill-inc" if incremental else "drill"] += 1
    elif roll < 0.72 and g.risky():  # another plane for a while (rotate and mirror refuse its arcs)
        plane = rng.choice(["G17", "G18", "G19"])
        if plane != g.plane:
            g.emit(plane)
            g.plane = plane
            g.features["plane-" + plane] += 1
    elif roll < 0.77:  # a comment, a dwell, a spindle or coolant word
        g.emit(rng.choice([g.comment("CONTOUR %d" % rng.randint(1, 99)), "M8", "M9", "G4 P%d" % rng.randint(10, 2000), "S%d M3" % rng.randint(500, 9000), "M1"]))
    elif roll < 0.79:  # a block skip
        x = g.coord(-80, 80)
        g.lines.append("/" + g.words(mode_word(g, "G90"), "G1", "X" + g.num(x)))
        g.motion = "G1"
        g.forget("X")
        g.features["block-skip"] += 1
    elif roll < 0.82 and g.risky():  # a variable or an expression (refused where it is in a moved word)
        number = rng.choice([1, 24, 100, 500])
        g.emit("#%d=%s" % (number, g.num(g.coord(-50, 50))))
        if g.chance(0.6):
            g.emit(g.words(mode_word(g, "G90"), "G1", rng.choice(["X#%d" % number, "Y[#%d+%s]" % (number, g.num(g.coord(1, 9)))])))
            g.forget("X", "Y")
            g.features["expression"] += 1
        g.features["variable"] += 1
    elif roll < 0.85:  # a machine position or a return
        choice = rng.random()
        if choice < 0.4:
            g.emit(g.words("G53", "G0" if g.chance(0.5) else "", "Z" + g.num(D0)))
            g.forget("Z")
            g.features["g53"] += 1
        elif choice < 0.8:
            g.emit(g.words(mode_word(g, "G91"), "G28", "Z" + g.num(D0)))
            g.forget("Z")
            g.features["g28-inc"] += 1
        elif g.risky():
            g.emit(g.words(mode_word(g, "G90"), "G28", "X" + g.num(g.pos["X"]), "Y" + g.num(g.pos["Y"])))  # type: ignore[arg-type]
            g.forget("X", "Y")
            g.features["g28-abs"] += 1
    elif roll < 0.87:  # a work offset
        g.emit(rng.choice(["G54", "G55", "G56", "G57", "G54.1 P%d" % rng.randint(1, 48)]))
        g.forget("X", "Y", "Z")
        g.features["work-offset"] += 1
    elif roll < 0.88 and g.risky():  # a frame or a shift (refused)
        g.emit(rng.choice(["G68 X0. Y0. R30.", "G51.1 X0.", "G52 X10. Y5.", "G92 X0. Y0."]))
        g.emit(rng.choice(["G69", "G50.1", "G52 X0. Y0.", "G1 X1."]))
        g.forget("X", "Y")
        g.features["frame"] += 1
    elif roll < 0.89 and g.risky():  # a call (refused)
        g.emit(rng.choice(["M98 P%d" % rng.randint(1000, 9999), "G65 P9010 A1. B2."]))
        g.features["call"] += 1
    elif roll < 0.91 and feature_on("rotary-mid-program"):  # a rotary axis
        g.emit(g.words("G0", "A" + g.num(g.coord(-90, 90) if g.risky() else D0)))
        g.features["rotary"] += 1
    else:  # a feed move in the plane with both axes
        x, y = g.coord(-80, 80), g.coord(-80, 80)
        g.emit(g.words(mode_word(g, "G90"), "G1", "X" + g.num(x), "Y" + g.num(y), "F" + g.num(g.coord(50, 2000)) if g.chance(0.3) else ""))
        g.pos.update(X=x, Y=y)
        g.features["line-abs"] += 1


# -- Fanuc lathe, G-code system A and B -------------------------------------------------------


def lathe_x(g: Gen, lo: float = 2, hi: float = 60) -> Decimal:
    """A radius whose diameter has at most the program's decimals."""
    return q(g.rng.uniform(lo, hi), g.rng.choice([0, 1, 2, 3])) / 2 if g.chance(0.5) else q(g.rng.uniform(lo, hi), g.rng.choice([0, 1, 2]))


def lathe_arc(g: Gen) -> Tuple[Tuple[Decimal, Decimal], Tuple[Decimal, Decimal], float]:
    """An arc in the ZX plane from the position: centre offset (K, I as a radius) and end (z, x)."""
    start = (g.pos["Z"], g.pos["X"])
    for _ in range(50):
        (ok, oi), end, r = arc_end(g.rng, start, 0.5, 3, big=False)  # type: ignore[arg-type]
        # the end diameter written with at most 3 decimals: the radius to an even thousandth
        end = (end[0], q(float(end[1]) * 2, 3) / 2)
        if 1 < float(end[1]) < 80:
            return (ok, oi), end, r
    return (D0, Decimal(-1)), (start[0] - 1, start[1]), 1.0  # type: ignore[operator]


def fanuc_lathe(g: Gen) -> None:
    rng = g.rng
    system_b = g.kind == "fanuc-lathe-b"
    g.pos = {"X": None, "Z": None}
    g.mode = "G90"
    if g.chance(0.6):
        g.lines.append("%")
    g.lines.append("O%04d" % rng.randint(1, 9999))
    g.emit(g.comment("WRITTEN BY THE GEOMETRY FUZZER"))
    start = rng.sample(["G18", "G21", "G40", "G99", "G97"], rng.randint(2, 5))
    if system_b:
        start.append("G90")
    rng.shuffle(start)
    g.emit(g.words(*start))
    g.emit("T%02d%02d" % ((t := rng.randint(1, 12)), t))
    if g.chance(0.6):
        g.emit("G50 S%d" % rng.randint(1500, 4000) if not system_b else "G92 S%d" % rng.randint(1500, 4000))
    g.emit(g.words("G96" if g.chance(0.6) else "G97", "S%d" % rng.randint(100, 2500), "M3" if g.chance(0.7) else "M4"))
    x, z = lathe_x(g, 40, 120), g.coord(1, 10)
    g.emit(g.words("G0", "X" + g.num(2 * x), "Z" + g.num(z)))
    g.pos.update(X=x, Z=z)
    g.comp = False
    for _ in range(rng.randint(3, 18)):
        if not (g.chance(0.1) and fanuc_lathe_extra(g, system_b)):
            fanuc_lathe_segment(g, system_b)
    if g.comp:
        g.emit(g.words("G40", "G0", "X" + g.num(2 * lathe_x(g, 80, 120))))
    g.emit(g.words("G0", "X" + g.num(2 * lathe_x(g, 80, 150)), "Z" + g.num(g.coord(20, 100))))
    if g.chance(0.5):
        g.emit(g.words("G28", "U0." if not g.pointless else "U0", "W0." if not g.pointless else "W0"))
        g.features["g28-uw"] += 1
    g.emit("M30")
    if g.lines[0] == "%":
        g.lines.append("%")


def fanuc_lathe_segment(g: Gen, system_b: bool) -> None:
    rng = g.rng
    if not g.known("X", "Z"):
        x, z = lathe_x(g, 30, 100), g.coord(1, 10)
        g.emit(g.words(mode_word(g, "G90") if system_b else "", "G0", "X" + g.num(2 * x), "Z" + g.num(z)))
        g.pos.update(X=x, Z=z)
        return
    roll = rng.random()
    if roll < 0.30:  # a straight move: X Z, U W, or a mix
        code = g.line_code()
        axes = rng.sample(["X", "Z"], rng.randint(1, 2))
        incremental_mode = system_b and g.chance(0.2)
        parts = [mode_word(g, "G91" if incremental_mode else "G90") if system_b else "", code]
        for axis in sorted(axes):
            inc = incremental_mode or g.chance(0.3)
            if axis == "X":
                if inc:
                    d = q(rng.uniform(-10, 10), rng.choice([0, 1, 2, 3])) / 2
                    if not 1 < float(g.pos["X"] + d) < 100:  # type: ignore[operator]
                        d = -d
                    parts.append(("X" if incremental_mode else "U") + g.num(2 * d))
                    g.pos["X"] = g.pos["X"] + d  # type: ignore[operator]
                else:
                    v = lathe_x(g)
                    parts.append("X" + g.num(2 * v))
                    g.pos["X"] = v
            else:
                if inc:
                    d = g.coord(-20, 10)
                    parts.append(("Z" if incremental_mode else "W") + g.num(d))
                    g.pos["Z"] = g.pos["Z"] + d  # type: ignore[operator]
                else:
                    v = g.coord(-80, 5)
                    parts.append("Z" + g.num(v))
                    g.pos["Z"] = v
        if code == "G1" and g.chance(0.4):
            parts.append("F" + g.num(g.coord(0.05, 0.4)))
        g.emit(g.words(*parts))
        g.features["line"] += 1
    elif roll < 0.48:  # an arc by its centre or by R
        code = g.arc_code()
        inc = g.chance(0.25)
        start = (g.pos["Z"], g.pos["X"])
        if g.chance(0.5):
            (ok, oi), end, _ = lathe_arc(g)
            centre = ["I" + g.num(oi), "K" + g.num(ok)]
            rng.shuffle(centre)
            g.features["arc-centre"] += 1
        else:
            for _ in range(50):
                end, radius = radius_arc(rng, start, 0.4, 3)  # type: ignore[arg-type]
                end = (end[0], q(float(end[1]) * 2, 3) / 2)
                if 1 < float(end[1]) < 80 and float(abs(radius)) * 2 > math.hypot(float(end[0] - start[0]), float(end[1] - start[1])) + 0.01:  # type: ignore[operator]
                    break
            else:
                return
            centre = ["R" + g.num(radius)]
            g.features["arc-radius"] += 1
        xs = ("U" + g.num(2 * (end[1] - start[1]))) if inc else ("X" + g.num(2 * end[1]))  # type: ignore[operator]
        zs = ("W" + g.num(end[0] - start[0])) if inc else ("Z" + g.num(end[0]))  # type: ignore[operator]
        parts = [mode_word(g, "G90") if system_b else "", code, xs, zs] + centre
        if g.chance(0.3):
            parts.append("F" + g.num(g.coord(0.05, 0.3)))
        g.emit(g.words(*parts))
        g.pos["Z"], g.pos["X"] = end
    elif roll < 0.56:  # the tool nose radius compensation
        x, z = lathe_x(g), g.coord(-60, 3)
        if g.comp:
            g.emit(g.words(mode_word(g, "G90") if system_b else "", "G40", rng.choice(["G0", "G1"]), "X" + g.num(2 * x), "Z" + g.num(z)))
            g.comp = False
            g.features["comp-off"] += 1
        else:
            g.emit(g.words(mode_word(g, "G90") if system_b else "", rng.choice(["G41", "G42"]), "G1", "X" + g.num(2 * x), "Z" + g.num(z), "F" + g.num(g.coord(0.05, 0.3)) if g.chance(0.5) else ""))
            g.comp = True
            g.features["comp-on"] += 1
        g.pos.update(X=x, Z=z)
    elif roll < 0.66 and g.cycles and not g.comp:  # a single-pass turning or facing cycle
        code = rng.choice(["G90", "G94"]) if not system_b else rng.choice(["G77", "G79"])
        x, z = lathe_x(g, 5, 60), g.coord(-60, -1)
        parts = [mode_word(g, "G90") if system_b else "", code, "X" + g.num(2 * x), "Z" + g.num(z)]
        if g.chance(0.3):
            parts.append("R" + g.num(g.coord(-3, -0.5)))
            g.features["cycle-taper"] += 1
        parts.append("F" + g.num(g.coord(0.1, 0.4)))
        g.emit(g.words(*parts))
        for _ in range(rng.randint(0, 3)):
            g.emit(g.words("X" + g.num(2 * lathe_x(g, 5, 60))) if code in ("G90", "G77") else g.words("Z" + g.num(g.coord(-60, -1))))
        x, z = lathe_x(g, 60, 100), g.coord(2, 10)
        g.emit(g.words("G0", "X" + g.num(2 * x), "Z" + g.num(z)))
        g.pos.update(X=x, Z=z)
        g.features["cycle-pass"] += 1
    elif roll < 0.72 and g.cycles and not g.comp:  # a thread
        choice = rng.random()
        x, z = lathe_x(g, 10, 40), g.coord(-40, -5)
        if choice < 0.4:
            g.emit(g.words("G92" if not system_b else "G78", "X" + g.num(2 * x), "Z" + g.num(z), "F" + g.num(g.coord(0.5, 3))))
            g.emit(g.words("X" + g.num(2 * x - Decimal("0.2"))))
        elif choice < 0.7:
            g.emit(g.words("G76", "P%06d" % rng.choice([10060, 20060, 11060]), "Q%d" % rng.randint(50, 200), "R" + g.num(Decimal("0.05"))))
            g.emit(g.words("G76", "X" + g.num(2 * x), "Z" + g.num(z), "P%d" % rng.randint(600, 2000), "Q%d" % rng.randint(200, 600), "F" + g.num(g.coord(0.5, 3))))
        else:
            g.emit(g.words("G32", "Z" + g.num(z), "F" + g.num(g.coord(0.5, 3))))
            g.pos["Z"] = z
        x, z = lathe_x(g, 60, 100), g.coord(2, 10)
        g.emit(g.words("G0", "X" + g.num(2 * x), "Z" + g.num(z)))
        g.pos.update(X=x, Z=z)
        g.features["thread"] += 1
    elif roll < 0.78 and g.cycles and not g.comp:  # a roughing cycle over a contour, and the finishing pass
        n1 = rng.choice([100, 500, 9000]) + rng.randint(0, 50)
        n2 = n1 + rng.randint(5, 40)
        if g.chance(0.5):
            g.emit(g.words("G71", "U" + g.num(g.coord(1, 3)), "R" + g.num(g.coord(0.2, 1))))
        g.emit(g.words("G71", "P%d" % n1, "Q%d" % n2, "U" + g.num(g.coord(0.1, 0.6)), "W" + g.num(g.coord(0.05, 0.3)), "F" + g.num(g.coord(0.1, 0.4))))
        x = lathe_x(g, 5, 30)
        g.lines.append(g.words("N%d" % n1, "G0" if g.chance(0.5) else "G1", "X" + g.num(2 * x)))
        z = Decimal(0)
        for _ in range(rng.randint(1, 4)):
            x, z = x + abs(lathe_x(g, 1, 10)), z - abs(g.coord(2, 15))
            g.emit(g.words("G1", "X" + g.num(2 * x), "Z" + g.num(z)) if g.chance(0.6) else g.words("Z" + g.num(z)))
        g.lines.append(g.words("N%d" % n2, "X" + g.num(2 * (x + 3))))
        g.emit(g.words("G70", "P%d" % n1, "Q%d" % n2))
        g.forget("X", "Z")
        g.features["roughing"] += 1
    elif roll < 0.84:  # a comment, spindle, coolant, a tool change
        g.emit(rng.choice([g.comment("FACE %d" % rng.randint(1, 9)), "M8", "M9", "G97 S%d M3" % rng.randint(200, 3000), "G4 U0.5", "M1", "T%02d%02d" % ((t := rng.randint(1, 12)), t)]))
    elif roll < 0.86 and g.risky() and feature_on("rotary-mid-program"):  # a C axis away from 0
        g.emit(g.words("G0", "C" + g.num(g.coord(10, 270))))
        g.features["rotary"] += 1
    elif roll < 0.88 and g.risky():  # a variable in a moved word
        g.emit("#%d=%s" % ((n := rng.choice([1, 100, 500])), g.num(g.coord(10, 60))))
        g.emit(g.words("G1", "X#%d" % n))
        g.forget("X")
        g.features["expression"] += 1
    elif roll < 0.90 and g.risky():  # a drilling cycle on the lathe (no roles yet)
        g.emit(g.words("G83", "Z" + g.num(g.coord(-30, -5)), "R" + g.num(g.coord(-3, -1)), "Q%d" % rng.randint(1000, 5000), "F" + g.num(g.coord(0.05, 0.2))))
        g.emit("G80")
        g.forget("X", "Z")
        g.features["drill"] += 1
    elif roll < 0.92 and g.risky():
        g.emit(rng.choice(["M98 P%04d" % rng.randint(1, 9999), "G50 X%s Z%s" % (g.num(Decimal(200)), g.num(Decimal(100)))]))
        g.forget("X", "Z")
        g.features["call-or-setting"] += 1
    else:  # a feed move in both axes
        x, z = lathe_x(g), g.coord(-60, 2)
        g.emit(g.words(mode_word(g, "G90") if system_b else "", "G1", "X" + g.num(2 * x), "Z" + g.num(z)))
        g.pos.update(X=x, Z=z)
        g.features["line"] += 1


# -- Okuma lathe -----------------------------------------------------------------------------


def okuma(g: Gen) -> None:
    rng = g.rng
    g.pos = {"X": None, "Z": None}
    g.mode = "G90"
    g.lines.append("$O%04d.MIN%%" % rng.randint(1, 9999) if g.chance(0.5) else "O%04d" % rng.randint(1, 9999))
    g.emit(g.comment("WRITTEN BY THE GEOMETRY FUZZER"))
    start = ["G90"] + rng.sample(["G95", "G18", "G40", "G97"], rng.randint(0, 3))
    rng.shuffle(start)
    g.emit(g.words(*start))
    if g.chance(0.5):
        g.emit("G50 S%d" % rng.randint(1500, 4000))
    g.emit("T%02d%02d%02d" % ((t := rng.randint(1, 12)), t, t))
    g.emit(g.words("G96" if g.chance(0.6) else "G97", "S%d" % rng.randint(100, 2500), "M3" if g.chance(0.7) else "M4"))
    x, z = lathe_x(g, 40, 120), g.coord(1, 10)
    g.emit(g.words("G0", "X" + g.num(2 * x), "Z" + g.num(z)))
    g.pos.update(X=x, Z=z)
    g.comp = False
    for _ in range(rng.randint(3, 18)):
        okuma_segment(g)
    g.emit(g.words(mode_word(g, "G90"), "G0", "X" + g.num(2 * lathe_x(g, 80, 150)), "Z" + g.num(g.coord(20, 100))))
    g.emit("M2" if g.chance(0.5) else "M30")


def okuma_segment(g: Gen) -> None:
    rng = g.rng
    if not g.known("X", "Z"):
        x, z = lathe_x(g, 30, 100), g.coord(1, 10)
        g.emit(g.words(mode_word(g, "G90") or ("G90" if g.chance(0.3) else ""), "G0", "X" + g.num(2 * x), "Z" + g.num(z)))
        g.pos.update(X=x, Z=z)
        return
    roll = rng.random()
    if roll < 0.35:
        inc = g.chance(0.25)
        code = g.line_code()
        axes = sorted(rng.sample(["X", "Z"], rng.randint(1, 2)))
        parts = [mode_word(g, "G91" if inc else "G90"), code]
        for axis in axes:
            if axis == "X":
                v = lathe_x(g)
                parts.append("X" + g.num(2 * (v - g.pos["X"]) if inc else 2 * v))  # type: ignore[operator]
                g.pos["X"] = v
            else:
                v = g.coord(-80, 5)
                parts.append("Z" + g.num(v - g.pos["Z"] if inc else v))  # type: ignore[operator]
                g.pos["Z"] = v
        if code == "G1" and g.chance(0.4):
            parts.append("F" + g.num(g.coord(0.05, 0.4)))
        g.emit(g.words(*parts))
        g.features["line-inc" if inc else "line"] += 1
    elif roll < 0.55:
        inc = g.chance(0.2)
        start = (g.pos["Z"], g.pos["X"])
        (ok, oi), end, _ = lathe_arc(g)
        parts = [mode_word(g, "G91" if inc else "G90"), g.arc_code()]
        parts.append("X" + g.num(2 * (end[1] - start[1]) if inc else 2 * end[1]))  # type: ignore[operator]
        parts.append("Z" + g.num(end[0] - start[0] if inc else end[0]))  # type: ignore[operator]
        parts += ["I" + g.num(oi), "K" + g.num(ok)]
        if g.risky(0.3):
            parts = parts[:4] + ["L" + g.num(q(math.hypot(float(oi), float(ok)), 3))]
            g.features["arc-l"] += 1
        g.emit(g.words(*parts))
        g.pos["Z"], g.pos["X"] = end
        g.features["arc-centre"] += 1
    elif roll < 0.65:
        x, z = lathe_x(g), g.coord(-60, 3)
        if g.comp:
            g.emit(g.words(mode_word(g, "G90"), "G40", "G0", "X" + g.num(2 * x), "Z" + g.num(z)))
        else:
            g.emit(g.words(mode_word(g, "G90"), rng.choice(["G41", "G42"]), "G1", "X" + g.num(2 * x), "Z" + g.num(z)))
        g.comp = not g.comp
        g.pos.update(X=x, Z=z)
        g.features["comp"] += 1
    elif roll < 0.72:
        g.emit(rng.choice([g.comment("STEP %d" % rng.randint(1, 9)), "M8", "M9", "G97 S%d M3" % rng.randint(200, 3000), "M1"]))
    elif roll < 0.76 and g.risky():
        g.emit("VC%d=%s" % ((n := rng.randint(1, 50)), g.num(g.coord(10, 60))))
        g.emit(g.words("G1", "X=VC%d" % n))
        g.forget("X")
        g.features["expression"] += 1
    elif roll < 0.79 and g.risky():
        g.emit(rng.choice(["CALL O%04d" % rng.randint(1, 9999), "G50 X200. Z100."]))
        g.forget("X", "Z")
        g.features["call-or-setting"] += 1
    else:
        x, z = lathe_x(g), g.coord(-60, 2)
        g.emit(g.words(mode_word(g, "G90"), "G1", "X" + g.num(2 * x), "Z" + g.num(z), "F" + g.num(g.coord(0.05, 0.4)) if g.chance(0.3) else ""))
        g.pos.update(X=x, Z=z)
        g.features["line"] += 1


# -- Sinumerik turning and milling ------------------------------------------------------------


def sinumerik_turn(g: Gen) -> None:
    rng = g.rng
    g.pos = {"X": None, "Z": None}
    g.mode = "G90"
    g.diam = "DIAMON"
    if g.chance(0.3):
        g.lines.append("%%_N_FUZZ%d_MPF" % rng.randint(1, 99))
    g.emit(g.comment("WRITTEN BY THE GEOMETRY FUZZER"))
    start = ["G18", "G90"] + rng.sample(["G71", "G95", "G40", "G54"], rng.randint(0, 4))
    rng.shuffle(start)
    g.emit(g.words(*start))
    if g.chance(0.4):
        g.emit("DIAMON")
    g.emit(g.words("T%d" % rng.randint(1, 12), "D1"))
    g.emit(g.words("G96" if g.chance(0.6) else "G97", "S%d" % rng.randint(100, 2500), "LIMS=%d" % rng.randint(1500, 4000) if g.chance(0.4) else "", "M4" if g.chance(0.5) else "M3"))
    x, z = lathe_x(g, 40, 120), g.coord(1, 10)
    g.emit(g.words("G0", "X" + g.num(sx(g, x)), "Z" + g.num(z)))
    g.pos.update(X=x, Z=z)
    g.comp = False
    for _ in range(rng.randint(3, 18)):
        sinumerik_turn_segment(g)
    g.emit(g.words(mode_word(g, "G90"), "G0", "X" + g.num(sx(g, lathe_x(g, 80, 150))), "Z" + g.num(g.coord(20, 100))))
    g.emit("M30")


def sx(g: Gen, x: Decimal, incremental: bool = False) -> Decimal:
    """The written X of a radius ``x`` under the diameter mode in force (DIAM90: a diameter when absolute)."""
    if g.diam == "DIAMOF" or (g.diam == "DIAM90" and incremental):
        return x
    return 2 * x


def sinumerik_turn_segment(g: Gen) -> None:
    rng = g.rng
    if not g.known("X", "Z"):
        x, z = lathe_x(g, 30, 100), g.coord(1, 10)
        g.emit(g.words(mode_word(g, "G90") or ("G90" if g.chance(0.3) else ""), "G0", "X" + g.num(sx(g, x)), "Z" + g.num(z)))
        g.pos.update(X=x, Z=z)
        return
    roll = rng.random()
    if roll < 0.3:
        inc = g.chance(0.25)
        code = g.line_code()
        parts = [mode_word(g, "G91" if inc else "G90"), code]
        for axis in sorted(rng.sample(["X", "Z"], rng.randint(1, 2))):
            function = "" if not g.chance(0.2) else ("IC" if not inc else "AC")
            word_inc = inc if not function else function == "IC"
            if axis == "X":
                v = lathe_x(g)
                value = sx(g, v - g.pos["X"], True) if word_inc else sx(g, v)  # type: ignore[operator]
                parts.append("X=%s(%s)" % (function, g.num(value)) if function else "X" + g.num(value))
                g.pos["X"] = v
            else:
                v = g.coord(-80, 5)
                value = v - g.pos["Z"] if word_inc else v  # type: ignore[operator]
                parts.append("Z=%s(%s)" % (function, g.num(value)) if function else "Z" + g.num(value))
                g.pos["Z"] = v
        if code == "G1" and g.chance(0.4):
            parts.append("F" + g.num(g.coord(0.05, 0.4)))
        g.emit(g.words(*parts))
        g.features["line"] += 1
    elif roll < 0.5:
        inc = g.chance(0.2)
        start = (g.pos["Z"], g.pos["X"])
        code = g.arc_code()
        parts = [mode_word(g, "G91" if inc else "G90"), code]
        form = rng.random()
        if form < 0.4:
            (ok, oi), end, _ = lathe_arc(g)
            centre = ["I" + g.num(oi), "K" + g.num(ok)]
            g.features["arc-centre"] += 1
        elif form < 0.6:
            (ok, oi), end, _ = lathe_arc(g)
            cx = start[1] + oi  # type: ignore[operator]
            centre = ["I=AC(%s)" % g.num(cx if g.diam == "DIAMOF" else 2 * cx), "K=AC(%s)" % g.num(start[0] + ok)]  # type: ignore[operator]
            g.features["arc-centre-ac"] += 1
        else:
            for _ in range(50):
                end, radius = radius_arc(rng, start, 0.4, 3)  # type: ignore[arg-type]
                end = (end[0], q(float(end[1]) * 2, 3) / 2)
                if 1 < float(end[1]) < 80:
                    break
            else:
                return
            centre = ["CR=" + g.num(radius)]
            g.features["arc-cr"] += 1
        parts.append("X" + g.num(sx(g, end[1] - start[1], True) if inc else sx(g, end[1])))  # type: ignore[operator]
        parts.append("Z" + g.num(end[0] - start[0] if inc else end[0]))  # type: ignore[operator]
        g.emit(g.words(*(parts + centre)))
        g.pos["Z"], g.pos["X"] = end
    elif roll < 0.58:
        x, z = lathe_x(g), g.coord(-60, 3)
        if g.comp:
            g.emit(g.words(mode_word(g, "G90"), "G40", "G0", "X" + g.num(sx(g, x)), "Z" + g.num(z)))
        else:
            g.emit(g.words(mode_word(g, "G90"), rng.choice(["G41", "G42"]), "G1", "X" + g.num(sx(g, x)), "Z" + g.num(z)))
        g.comp = not g.comp
        g.pos.update(X=x, Z=z)
        g.features["comp"] += 1
    elif roll < 0.64:
        mode = rng.choice(["DIAMON", "DIAMOF", "DIAM90"])
        g.emit(mode)
        g.diam = mode
        g.features["diam-" + mode] += 1
    elif roll < 0.70:
        g.emit(rng.choice([g.comment("STEP %d" % rng.randint(1, 9)), "M8", "M9", "G97 S%d M3" % rng.randint(200, 3000), "G4 F0.5", "M1"]))
    elif roll < 0.73 and g.cycles and g.risky():
        g.emit('CYCLE95("KONTUR%d",2,0,0.2,0.1,0.3,0.2,0.1,1,0,0,0.5)' % rng.randint(1, 9))
        g.forget("X", "Z")
        g.features["cycle95"] += 1
    elif roll < 0.76 and g.risky():
        g.emit("R%d=%s" % ((n := rng.randint(1, 50)), g.num(g.coord(10, 60))))
        g.emit(g.words("G1", "X=R%d" % n))
        g.forget("X")
        g.features["expression"] += 1
    elif roll < 0.78 and g.risky():
        g.emit(rng.choice(["TRANS Z-10", "L100", "SUB%d" % rng.randint(1, 9)]))
        g.emit("TRANS")
        g.forget("X", "Z")
        g.features["frame-or-call"] += 1
    else:
        x, z = lathe_x(g), g.coord(-60, 2)
        g.emit(g.words(mode_word(g, "G90"), "G1", "X" + g.num(sx(g, x)), "Z" + g.num(z)))
        g.pos.update(X=x, Z=z)
        g.features["line"] += 1


SINUMERIK_DRILLS = ("CYCLE81", "CYCLE82", "CYCLE83", "CYCLE85", "CYCLE89")


def sinumerik_drill(g: Gen, code: str) -> str:
    rtp, rfp = g.coord(5, 50), g.coord(-5, 5)
    sdis, dp = g.coord(1, 5), g.coord(-30, -2)
    args = [g.num(rtp), g.num(rfp), g.num(sdis), g.num(rfp + dp) if g.chance(0.7) else "", "" ]
    if args[3] == "":
        args[4] = g.num(abs(dp))
    if code in ("CYCLE82", "CYCLE85", "CYCLE89"):
        args.append(g.num(g.coord(0.1, 2)))
    if code == "CYCLE83":
        args += [g.num(rfp + dp / 2), "", g.num(g.coord(0.5, 3)), "", g.num(g.coord(0.1, 1)), "1", "0"]
    while args and args[-1] == "" and g.chance(0.5):
        args.pop()
    return "%s(%s)" % (code, ",".join(args))


def sinumerik_mill(g: Gen) -> None:
    rng = g.rng
    g.pos = {"X": None, "Y": None, "Z": None}
    g.mode, g.plane = "G90", "G17"
    if g.chance(0.3):
        g.lines.append("%%_N_FUZZ%d_MPF" % rng.randint(1, 99))
    g.emit(g.comment("WRITTEN BY THE GEOMETRY FUZZER"))
    start = ["G17", "G90", "G70" if g.inch else "G71"] + rng.sample(["G40", "G54", "G94", "G64"], rng.randint(0, 4))
    rng.shuffle(start)
    g.emit(g.words(*start))
    g.emit(g.words("T%d" % rng.randint(1, 20), "D1"))
    if g.chance(0.6):
        g.emit("M6")
    x, y, z = g.coord(-80, 80), g.coord(-80, 80), g.coord(5, 50)
    g.emit(g.words("G0", "X" + g.num(x), "Y" + g.num(y), "Z" + g.num(z), "S%d" % rng.randint(500, 9000) if g.chance(0.5) else "", "M3" if g.chance(0.5) else ""))
    g.pos.update(X=x, Y=y, Z=z)
    g.comp = False
    for _ in range(rng.randint(3, 22)):
        if not (g.chance(0.12) and sinumerik_mill_extra(g)):
            sinumerik_mill_segment(g)
    g.emit(g.words(mode_word(g, "G90"), "G0", "Z" + g.num(g.coord(20, 80))))
    g.emit("M30")


def sinumerik_mill_segment(g: Gen) -> None:
    rng = g.rng
    a, b, ci, cj, n = MILL_PLANES[g.plane]
    if not g.known("X", "Y", "Z"):
        x, y, z = g.coord(-80, 80), g.coord(-80, 80), g.coord(2, 30)
        g.emit(g.words(mode_word(g, "G90") or ("G90" if g.chance(0.3) else ""), "G0", "X" + g.num(x), "Y" + g.num(y), "Z" + g.num(z)))
        g.pos.update(X=x, Y=y, Z=z)
        return
    roll = rng.random()
    if roll < 0.28:
        inc = g.chance(0.25)
        code = g.line_code()
        parts = [mode_word(g, "G91" if inc else "G90"), code]
        for axis in sorted(rng.sample(["X", "Y", "Z"], rng.randint(1, 3))):
            function = "" if not g.chance(0.2) else ("IC" if not inc else "AC")
            word_inc = inc if not function else function == "IC"
            v = g.coord(-80, 80) if axis != "Z" else g.coord(-20, 30)
            value = v - g.pos[axis] if word_inc else v  # type: ignore[operator]
            parts.append("%s=%s(%s)" % (axis, function, g.num(value)) if function else axis + g.num(value))
            g.pos[axis] = v
        if code == "G1" and g.chance(0.4):
            parts.append("F" + g.num(g.coord(50, 2000)))
        g.emit(g.words(*parts))
        g.features["line"] += 1
    elif roll < 0.50:
        inc = g.chance(0.2)
        start = (g.pos[a], g.pos[b])
        parts = [mode_word(g, "G91" if inc else "G90"), g.arc_code()]
        form = rng.random()
        if form < 0.4:
            (oi, oj), end, _ = arc_end(rng, start, g.scale, g.places)  # type: ignore[arg-type]
            centre = [ci + g.num(oi), cj + g.num(oj)]
            g.features["arc-centre"] += 1
        elif form < 0.6:
            (oi, oj), end, _ = arc_end(rng, start, g.scale, g.places)  # type: ignore[arg-type]
            centre = ["%s=AC(%s)" % (ci, g.num(start[0] + oi)), "%s=AC(%s)" % (cj, g.num(start[1] + oj))]  # type: ignore[operator]
            g.features["arc-centre-ac"] += 1
        elif form < 0.75:
            (oi, oj), end, _ = arc_end(rng, start, g.scale, g.places)  # type: ignore[arg-type]
            sweep = math.degrees(math.atan2(float(end[1] - start[1] - oj), float(end[0] - start[0] - oi)) - math.atan2(float(-oj), float(-oi)))  # type: ignore[operator]
            centre = [ci + g.num(oi), cj + g.num(oj)]
            g.features["arc-centre"] += 1
        else:
            end, radius = radius_arc(rng, start, g.scale, g.places)  # type: ignore[arg-type]
            centre = ["CR=" + g.num(radius)]
            g.features["arc-cr"] += 1
        parts += [a + g.num(end[0] - start[0] if inc else end[0]), b + g.num(end[1] - start[1] if inc else end[1])]  # type: ignore[operator]
        if g.chance(0.15):
            d = g.coord(-5, 5)
            parts.append(n + g.num(d if inc else g.pos[n] + d))  # type: ignore[operator]
            g.pos[n] = g.pos[n] + d  # type: ignore[operator]
            g.features["helix"] += 1
        g.emit(g.words(*(parts + centre)))
        g.pos[a], g.pos[b] = end
    elif roll < 0.58:
        x, y = g.coord(-80, 80), g.coord(-80, 80)
        if g.comp:
            g.emit(g.words(mode_word(g, "G90"), "G40", "G1", "X" + g.num(x), "Y" + g.num(y)))
        else:
            g.emit(g.words(mode_word(g, "G90"), rng.choice(["G41", "G42"]), "G1", "X" + g.num(x), "Y" + g.num(y)))
        g.comp = not g.comp
        g.pos.update(X=x, Y=y)
        g.features["comp"] += 1
    elif roll < 0.68 and g.plane == "G17" and not g.comp:
        code = rng.choice(SINUMERIK_DRILLS)
        if g.chance(0.6):
            g.emit("MCALL " + sinumerik_drill(g, code))
            for _ in range(rng.randint(1, 4)):
                # the positions move with the motion code in force: G0 or G1, never an arc
                code_word = rng.choice(["G0", "G1"]) if g.motion not in ("G0", "G1") else ""
                g.emit(g.words(mode_word(g, "G90"), code_word, "X" + g.num(g.coord(-80, 80)), "Y" + g.num(g.coord(-80, 80)) if g.chance(0.6) else ""))
            g.emit("MCALL")
            g.features["mcall"] += 1
        else:
            g.emit(sinumerik_drill(g, code))
            g.features["cycle-call"] += 1
        g.forget("X", "Y", "Z")
    elif roll < 0.72 and g.risky():
        plane = rng.choice(["G17", "G18", "G19"])
        if plane != g.plane:
            g.emit(plane)
            g.plane = plane
            g.features["plane-" + plane] += 1
    elif roll < 0.77:
        g.emit(rng.choice([g.comment("CONTOUR %d" % rng.randint(1, 99)), "M8", "M9", "G4 F1", "S%d M3" % rng.randint(500, 9000), "M1"]))
    elif roll < 0.80:
        g.emit(rng.choice(["G0 SUPA Z0", "G53 G0 Z0", "G0 Z0 SUPA"]))
        g.forget("Z")
        g.features["machine"] += 1
    elif roll < 0.83 and g.risky():
        g.emit("R%d=%s" % ((k := rng.randint(1, 50)), g.num(g.coord(-50, 50))))
        g.emit(g.words("G1", rng.choice(["X=R%d" % k, "Y=R%d+2" % k])))
        g.forget("X", "Y")
        g.features["expression"] += 1
    elif roll < 0.85 and g.risky():
        g.emit(rng.choice(["TRANS X10 Y5", "ROT RPL=30", "MIRROR X0", "AROT Z45"]))
        g.emit(g.words("G1", "X" + g.num(g.coord(-50, 50))))
        g.emit(rng.choice(["TRANS", "ROT"]))
        g.forget("X", "Y")
        g.features["frame"] += 1
    elif roll < 0.86 and g.risky():
        g.emit(rng.choice(["L%d" % rng.randint(1, 999), "CONTOUR%d" % rng.randint(1, 9), "CALL \"SUB\""]))
        g.features["call"] += 1
    else:
        x, y = g.coord(-80, 80), g.coord(-80, 80)
        g.emit(g.words(mode_word(g, "G90"), "G1", "X" + g.num(x), "Y" + g.num(y), "F" + g.num(g.coord(50, 2000)) if g.chance(0.3) else ""))
        g.pos.update(X=x, Y=y)
        g.features["line"] += 1


# -- Klartext --------------------------------------------------------------------------------

KLARTEXT_CYCLES = {
    200: ["Q200", "Q201", "Q206", "Q202", "Q210", "Q203", "Q204", "Q211", "Q395"],
    201: ["Q200", "Q201", "Q206", "Q211", "Q208", "Q203", "Q204"],
    203: ["Q200", "Q201", "Q206", "Q202", "Q210", "Q203", "Q204", "Q212", "Q213", "Q205", "Q211", "Q208", "Q256", "Q395"],
    207: ["Q200", "Q201", "Q239", "Q203", "Q204"],
}


def klartext(g: Gen) -> None:
    rng = g.rng
    g.pos = {"X": None, "Y": None, "Z": None}
    g.pole: Optional[Tuple[Decimal, Decimal]] = None
    name = "FUZZ%d" % rng.randint(1, 999)
    unit = "INCH" if g.inch else "MM"
    g.emit("BEGIN PGM %s %s" % (name, unit))
    g.emit("; WRITTEN BY THE GEOMETRY FUZZER")
    if g.chance(0.5):
        g.emit("BLK FORM 0.1 Z X%s Y%s Z%s" % (g.num(D0), g.num(D0), g.num(Decimal(-40))))
        g.emit("BLK FORM 0.2 X%s Y%s Z%s" % (g.num(Decimal(100)), g.num(Decimal(100)), g.num(D0)))
        g.features["blk-form"] += 1
    g.emit("TOOL CALL %d Z S%d%s" % (rng.randint(1, 30), rng.randint(500, 9000), (" F%d" % rng.randint(100, 2000)) if g.chance(0.4) else ""))
    g.emit("L Z%s R0 FMAX M3" % g.num(g.coord(20, 100)))
    x, y, z = g.coord(-80, 80), g.coord(-80, 80), g.coord(2, 10)
    g.emit("L X%s Y%s R0 FMAX" % (g.num(x), g.num(y)))
    g.emit("L Z%s R0 FMAX" % g.num(z))
    g.pos.update(X=x, Y=y, Z=z)
    g.comp = "R0"
    for _ in range(rng.randint(3, 20)):
        if not (g.chance(0.15) and klartext_extra(g)):
            klartext_segment(g)
    g.emit("L Z%s R0 FMAX M30" % g.num(g.coord(50, 100)))
    g.emit("END PGM %s %s" % (name, unit))


def klartext_feed(g: Gen) -> str:
    """A feed word, rapid, or none (the feed in force)."""
    return g.rng.choice(["", "", " F%d" % g.rng.randint(50, 3000), " FMAX", ""])


def klartext_segment(g: Gen) -> None:
    rng = g.rng
    if not g.known("X", "Y", "Z"):
        x, y, z = g.coord(-80, 80), g.coord(-80, 80), g.coord(2, 30)
        g.emit("L X%s Y%s Z%s R0 FMAX" % (g.num(x), g.num(y), g.num(z)))
        g.comp = "R0"
        g.pos.update(X=x, Y=y, Z=z)
        return
    roll = rng.random()
    if roll < 0.28:  # L, absolute and incremental words
        words = []
        for axis in sorted(rng.sample(["X", "Y", "Z"], rng.randint(1, 3))):
            v = g.coord(-80, 80) if axis != "Z" else g.coord(-20, 20)
            if g.chance(0.25):
                words.append("I%s%s" % (axis, g.num(v - g.pos[axis])))  # type: ignore[operator]
                g.features["l-inc"] += 1
            else:
                words.append("%s%s" % (axis, g.num(v)))
            g.pos[axis] = v
        comp = ""
        if g.chance(0.3):
            comp = rng.choice(["R0", "RL", "RR"])
            g.comp = comp
        g.emit("L %s%s%s%s" % (" ".join(words), (" " + comp) if comp else "", klartext_feed(g), " M8" if g.chance(0.05) else ""))
        g.features["l"] += 1
    elif roll < 0.42:  # CC and C about it
        start = (g.pos["X"], g.pos["Y"])
        (oi, oj), end, _ = arc_end(rng, start, g.scale, g.places)  # type: ignore[arg-type]
        centre = (start[0] + oi, start[1] + oj)  # type: ignore[operator]
        if g.chance(0.2):
            g.emit("CC IX%s IY%s" % (g.num(oi), g.num(oj)))
            g.features["cc-inc"] += 1
        else:
            g.emit("CC X%s Y%s" % (g.num(centre[0]), g.num(centre[1])))
        g.pole = centre
        words = ["X" + g.num(end[0]), "Y" + g.num(end[1])]
        if g.chance(0.15):
            words = ["IX" + g.num(end[0] - start[0]), "IY" + g.num(end[1] - start[1])]  # type: ignore[operator]
        g.emit("C %s %s%s" % (" ".join(words), rng.choice(["DR+", "DR-"]), klartext_feed(g)))
        g.pos["X"], g.pos["Y"] = end
        g.features["c"] += 1
    elif roll < 0.52:  # CR
        start = (g.pos["X"], g.pos["Y"])
        end, radius = radius_arc(rng, start, g.scale, g.places)  # type: ignore[arg-type]
        g.emit("CR X%s Y%s R%s %s%s" % (g.num(end[0]), g.num(end[1]), g.num(radius), rng.choice(["DR+", "DR-"]), klartext_feed(g)))
        g.pos["X"], g.pos["Y"] = end
        g.features["cr"] += 1
    elif roll < 0.60 and g.pole is not None:  # polar moves about the pole
        pole = g.pole
        if g.chance(0.5):
            radius = abs(g.coord(2, 40))
            angle = q(rng.uniform(-180, 360), rng.choice([0, 1, 3]))
            g.emit("LP PR%s PA%s%s" % (g.num(radius), g.num(angle), klartext_feed(g)))
            rad = math.radians(float(angle))
            g.pos["X"], g.pos["Y"] = q(float(pole[0]) + float(radius) * math.cos(rad), 4), q(float(pole[1]) + float(radius) * math.sin(rad), 4)
            g.features["lp"] += 1
        else:
            r = math.hypot(float(g.pos["X"] - pole[0]), float(g.pos["Y"] - pole[1]))  # type: ignore[operator]
            a0 = math.atan2(float(g.pos["Y"] - pole[1]), float(g.pos["X"] - pole[0]))  # type: ignore[operator]
            if g.chance(0.5):
                delta = q(rng.uniform(-300, 300), rng.choice([0, 1, 3]))
                g.emit("CP IPA%s %s%s" % (g.num(delta), "DR+" if delta > 0 else "DR-", klartext_feed(g)))
                a1 = a0 + math.radians(float(delta))
            else:
                angle = q(rng.uniform(-180, 180), rng.choice([0, 1, 3]))
                g.emit("CP PA%s %s%s" % (g.num(angle), rng.choice(["DR+", "DR-"]), klartext_feed(g)))
                a1 = math.radians(float(angle))
            g.pos["X"], g.pos["Y"] = q(float(pole[0]) + r * math.cos(a1), 4), q(float(pole[1]) + r * math.sin(a1), 4)
            g.features["cp"] += 1
        g.forget("X", "Y")  # the generator does not carry the many decimals of a polar point on
    elif roll < 0.64:  # a rounding or a chamfer between two lines
        x, y = g.coord(-80, 80), g.coord(-80, 80)
        g.emit("RND R%s" % g.num(abs(g.coord(0.5, 3))) if g.chance(0.5) else "CHF %s" % g.num(abs(g.coord(0.5, 3))))
        g.emit("L X%s Y%s" % (g.num(x), g.num(y)))
        g.pos.update(X=x, Y=y)
        g.features["rnd-chf"] += 1
    elif roll < 0.67 and g.risky():  # CT (rotate and mirror refuse it)
        x, y = g.coord(-80, 80), g.coord(-80, 80)
        g.emit("CT X%s Y%s" % (g.num(x), g.num(y)))
        g.pos.update(X=x, Y=y)
        g.features["ct"] += 1
    elif roll < 0.77 and g.comp == "R0":  # a drilling cycle and its calls
        number = rng.choice(sorted(KLARTEXT_CYCLES))
        params = KLARTEXT_CYCLES[number]
        g.emit("CYCL DEF %d %s ~" % (number, rng.choice(["DRILLING", "BOHREN", "CENTERING", "REAMING"])))
        for i, qp in enumerate(params):
            value = {"Q200": g.coord(1, 5), "Q201": -abs(g.coord(2, 30)), "Q203": g.coord(-10, 10), "Q204": g.coord(10, 80)}.get(qp, abs(g.coord(0, 200)))
            g.lines.append("  %s=%s ;%s%s" % (qp, g.num(value), "PARAM", " ~" if i < len(params) - 1 else ""))
        for _ in range(rng.randint(1, 4)):
            x, y = g.coord(-80, 80), g.coord(-80, 80)
            how = rng.random()
            if how < 0.4:
                g.emit("L X%s Y%s R0 FMAX M99" % (g.num(x), g.num(y)))
            elif how < 0.7:
                z = (" Z" + g.num(g.coord(-5, 5))) if g.chance(0.4) else ""
                g.emit("CYCL CALL POS X%s Y%s%s FMAX" % (g.num(x), g.num(y), z))
                g.features["call-pos"] += 1
            else:
                g.emit("L X%s Y%s R0 FMAX" % (g.num(x), g.num(y)))
                g.emit("CYCL CALL")
        g.forget("X", "Y", "Z")
        g.features["cycle"] += 1
    elif roll < 0.82:
        g.emit(rng.choice(["; CONTOUR %d" % rng.randint(1, 99), "M8", "M9", "STOP", "TOOL CALL %d Z S%d" % (rng.randint(1, 30), rng.randint(500, 9000)), "L Z%s R0 FMAX M91" % g.num(D0)]))
        if g.lines[-1].endswith("M91"):
            g.forget("Z")
    elif roll < 0.85 and g.risky():
        g.emit("FN 0: Q%d = %s" % ((n := rng.randint(1, 99)), g.num(g.coord(-50, 50))))
        g.emit("L X+Q%d" % n if g.chance(0.5) else "L Y-Q%d" % n)
        g.forget("X", "Y")
        g.features["expression"] += 1
    elif roll < 0.87 and g.risky():
        g.emit(rng.choice(["CALL LBL %d" % rng.randint(1, 99), "CYCL DEF 7.0 DATUM SHIFT", "CYCL DEF 10.0 ROTATION", "FL X+20 Y+30 AN+45"]))
        g.forget("X", "Y")
        g.features["call-frame-fk"] += 1
    else:
        x, y = g.coord(-80, 80), g.coord(-80, 80)
        g.emit("L X%s Y%s%s" % (g.num(x), g.num(y), klartext_feed(g)))
        g.pos.update(X=x, Y=y)
        g.features["l"] += 1


# -- rarer forms, per code set ----------------------------------------------------------------


def fanuc_mill_extra(g: Gen) -> bool:
    """Rarer Fanuc milling forms; ``False`` when none fits here."""
    rng = g.rng
    if not g.known("X", "Y", "Z") or g.plane != "G17":
        return False
    roll = rng.random()
    if roll < 0.25:  # resets that refuse nothing (plan §7 #299)
        g.emit(rng.choice(["G69", "G50.1", "G15", g.words("G52", "X" + g.num(D0), "Y" + g.num(D0)), "G40", "G80", "G49"]))
        g.features["reset"] += 1
    elif roll < 0.45:  # the plane written in the arc block, a centre word of 0 left out
        start = (g.pos["X"], g.pos["Y"])
        (oi, oj), end, _ = arc_end(rng, start, g.scale, g.places)  # type: ignore[arg-type]
        g.emit(g.words(mode_word(g, "G90"), "G17", rng.choice(["G2", "G3"]), "X" + g.num(end[0]), "Y" + g.num(end[1]), "I" + g.num(oi), "J" + g.num(oj)))
        g.pos["X"], g.pos["Y"] = end
        g.features["plane-in-arc"] += 1
    elif roll < 0.6:  # an arc that ends where it starts on one axis: that axis left out
        x0, y0 = g.pos["X"], g.pos["Y"]
        r = abs(g.coord(2, 20))
        if g.chance(0.5):
            g.emit(g.words(mode_word(g, "G90"), rng.choice(["G2", "G3"]), "X" + g.num(x0 + 2 * r), "I" + g.num(r)))  # type: ignore[operator]
            g.pos["X"] = x0 + 2 * r  # type: ignore[operator]
        else:
            g.emit(g.words(mode_word(g, "G90"), rng.choice(["G2", "G3"]), "Y" + g.num(y0 - 2 * r), "J" + g.num(-r)))  # type: ignore[operator]
            g.pos["Y"] = y0 - 2 * r  # type: ignore[operator]
        g.features["arc-one-axis"] += 1
    elif roll < 0.75 and g.wild:  # a blank line, a tab, a comment between the words
        x = g.coord(-80, 80)
        g.lines.append(rng.choice(["", "   ", "G1\tX%s\tY%s" % (g.num(x), g.num(g.pos["Y"])), "G1 X%s (MID) Y%s" % (g.num(x), g.num(g.pos["Y"]))]))  # type: ignore[arg-type]
        if g.lines[-1].strip():
            g.pos["X"] = x
            g.motion = "G1"
        g.features["blank-tab-comment"] += 1
    elif roll < 0.85 and g.risky():  # a loop (refused where it changes what the run reads)
        g.emit("#1=0")
        g.emit("WHILE [#1 LT 2] DO1")
        g.emit(g.words(mode_word(g, "G91"), "G1", "X" + g.num(g.coord(1, 5))))
        g.emit("#1=#1+1")
        g.emit("END1")
        g.forget("X")
        g.features["loop"] += 1
    else:  # a work offset written again (the same one)
        g.emit("G54")
        g.features["work-offset-same"] += 1
    return True


def fanuc_lathe_extra(g: Gen, system_b: bool) -> bool:
    rng = g.rng
    if not g.known("X", "Z") or g.comp:
        return False
    roll = rng.random()
    if roll < 0.4:  # a chamfer or a corner rounding at the end of a move (,C ,R)
        x, z = lathe_x(g, 5, 60), g.coord(-60, -1)
        g.emit(g.words(mode_word(g, "G90") if system_b else "", "G1", "X" + g.num(2 * x), "Z" + g.num(z), rng.choice([",C", ",R"]) + g.num(abs(g.coord(0.2, 2)))))
        x2 = lathe_x(g, 5, 60)
        g.emit(g.words("X" + g.num(2 * x2)))
        g.pos.update(X=x2, Z=z)
        g.features["corner"] += 1
    elif roll < 0.7:  # a dwell, a spindle limit, the tool nose radius off
        g.emit(rng.choice(["G4 X0.5", "G4 P500", "G50 S2000" if not system_b else "G92 S2000", "G40", "G97 S500"]))
    else:  # the face cut to the centre (X0) and back
        z = g.coord(-5, 2)
        g.emit(g.words(mode_word(g, "G90") if system_b else "", "G1", "Z" + g.num(z)))
        g.emit(g.words("X" + g.num(D0)))
        x = lathe_x(g, 30, 80)
        g.emit(g.words("G0", "X" + g.num(2 * x), "W" + g.num(Decimal(1))))
        g.pos.update(X=x, Z=z + 1)
        g.features["face-to-centre"] += 1
    return True


def sinumerik_mill_extra(g: Gen) -> bool:
    rng = g.rng
    if not g.known("X", "Y", "Z") or g.plane != "G17":
        return False
    roll = rng.random()
    start = (g.pos["X"], g.pos["Y"])
    if roll < 0.2:  # resets that refuse nothing
        g.emit(rng.choice(["TRANS", "ROT", "MIRROR", "SCALE", "ATRANS X0 Y0", "G40"]))
        g.features["reset"] += 1
    elif roll < 0.4:  # a helix of whole turns
        (oi, oj), _, _ = arc_end(rng, start, g.scale, g.places)  # type: ignore[arg-type]
        d = -abs(g.coord(1, 5))
        g.emit(g.words(mode_word(g, "G90"), rng.choice(["G2", "G3"]), "X" + g.num(start[0]), "Y" + g.num(start[1]), "Z" + g.num(g.pos["Z"] + d), "I" + g.num(oi), "J" + g.num(oj), "TURN=%d" % rng.randint(1, 3)))  # type: ignore[operator]
        g.pos["Z"] = g.pos["Z"] + d  # type: ignore[operator]
        g.features["turn"] += 1
    elif roll < 0.55:  # an arc by its centre and its angle (the end is not known: refused or not resolved)
        (oi, oj), _, _ = arc_end(rng, start, g.scale, g.places)  # type: ignore[arg-type]
        g.emit(g.words(rng.choice(["G2", "G3"]), "I" + g.num(oi), "J" + g.num(oj), "AR=%s" % g.num(q(rng.uniform(10, 300), 1))))
        g.forget("X", "Y")
        g.features["arc-ar"] += 1
    elif roll < 0.7:  # a corner rounding or a chamfer on a move
        x, y = g.coord(-80, 80), g.coord(-80, 80)
        g.emit(g.words(mode_word(g, "G90"), "G1", "X" + g.num(x), "Y" + g.num(y), rng.choice(["RND=", "CHR="]) + g.num(abs(g.coord(0.5, 3)))))
        g.pos.update(X=x, Y=y)
        g.features["rnd-chr"] += 1
    elif roll < 0.8 and g.risky():  # a tangential arc or one through a point (rotate and mirror refuse)
        x, y = g.coord(-80, 80), g.coord(-80, 80)
        if g.chance(0.5):
            g.emit(g.words("CT", "X" + g.num(x), "Y" + g.num(y)))
        else:
            g.emit(g.words("CIP", "X" + g.num(x), "Y" + g.num(y), "I1=" + g.num(g.coord(-80, 80)), "J1=" + g.num(g.coord(-80, 80))))
        g.pos.update(X=x, Y=y)
        g.features["ct-cip"] += 1
    elif roll < 0.9 and g.wild:
        g.lines.append(rng.choice(["", "  ", "G1\tX%s\tY%s" % (g.num(g.pos["X"]), g.num(g.pos["Y"]))]))  # type: ignore[arg-type]
        if g.lines[-1].strip():
            g.motion = "G1"
        g.features["blank-tab"] += 1
    else:
        g.emit(g.words("G0", "X" + g.num(g.pos["X"]), "Y" + g.num(g.pos["Y"])))  # type: ignore[arg-type]
    return True


def klartext_extra(g: Gen) -> bool:
    rng = g.rng
    if not g.known("X", "Y", "Z"):
        return False
    roll = rng.random()
    x0, y0 = g.pos["X"], g.pos["Y"]
    if roll < 0.2:  # C with one coordinate: the end has the start's other coordinate
        cx = x0 + g.coord(2, 20)  # type: ignore[operator]
        g.emit("CC X%s Y%s" % (g.num(cx), g.num(y0)))  # type: ignore[arg-type]
        g.pole = (cx, y0)  # type: ignore[assignment]
        g.emit("C X%s %s" % (g.num(2 * cx - x0), rng.choice(["DR+", "DR-"])))  # type: ignore[operator]
        g.pos["X"] = 2 * cx - x0  # type: ignore[operator]
        g.features["c-one-axis"] += 1
    elif roll < 0.35 and g.pole is not None:  # a polar helix and an incremental polar line
        if g.chance(0.5):
            d = -abs(g.coord(1, 4))
            g.emit("CP IPA%s IZ%s %s" % (g.num(Decimal(rng.choice([360, 720, -360, 180]))), g.num(d), rng.choice(["DR+", "DR-"])))
            g.features["cp-helix"] += 1
        else:
            g.emit("LP IPA%s" % g.num(q(rng.uniform(-90, 90), 1)))
            g.features["lp-ipa"] += 1
        g.forget("X", "Y", "Z")
    elif roll < 0.5:  # approach and depart the contour
        x, y = g.coord(-80, 80), g.coord(-80, 80)
        side = rng.choice(["RL", "RR"])
        form = rng.random()
        if form < 0.35:
            g.emit("APPR LT X%s Y%s LEN%s %s F%d" % (g.num(x), g.num(y), g.num(abs(g.coord(5, 20))), side, rng.randint(100, 900)))
        elif form < 0.7:
            g.emit("APPR LCT X%s Y%s R%s %s F%d" % (g.num(x), g.num(y), g.num(abs(g.coord(2, 10))), side, rng.randint(100, 900)))
        else:
            g.emit("APPR CT X%s Y%s CCA%s R%s %s F%d" % (g.num(x), g.num(y), g.num(Decimal(rng.choice([90, 180]))), g.num(abs(g.coord(2, 10))), side, rng.randint(100, 900)))
        x2, y2 = g.coord(-80, 80), g.coord(-80, 80)
        g.emit("L X%s Y%s" % (g.num(x2), g.num(y2)))
        dep = rng.random()
        if dep < 0.5:
            g.emit("DEP LT LEN%s F%d" % (g.num(abs(g.coord(5, 20))), rng.randint(100, 900)))
            g.forget("X", "Y")
        else:
            x3, y3 = g.coord(-80, 80), g.coord(-80, 80)
            g.emit("DEP LCT X%s Y%s R%s F%d" % (g.num(x3), g.num(y3), g.num(abs(g.coord(2, 10))), rng.randint(100, 900)))
            g.pos.update(X=x3, Y=y3)
        g.comp = "R0"
        g.features["appr-dep"] += 1
    elif roll < 0.65 and g.comp == "R0":  # a cycle called at every position (M89) until M99
        g.emit("CYCL DEF 200 DRILLING ~")
        for i, qp in enumerate(KLARTEXT_CYCLES[200]):
            value = {"Q200": g.coord(1, 5), "Q201": -abs(g.coord(2, 30)), "Q203": g.coord(-10, 10), "Q204": g.coord(10, 80)}.get(qp, abs(g.coord(0, 200)))
            g.lines.append("  %s=%s ;%s%s" % (qp, g.num(value), "PARAM", " ~" if i < 8 else ""))
        g.emit("L X%s Y%s R0 FMAX M89" % (g.num(g.coord(-80, 80)), g.num(g.coord(-80, 80))))
        for _ in range(rng.randint(0, 3)):
            g.emit("L X%s Y%s R0 FMAX" % (g.num(g.coord(-80, 80)), g.num(g.coord(-80, 80))))
        g.emit("L X%s Y%s R0 FMAX M99" % (g.num(g.coord(-80, 80)), g.num(g.coord(-80, 80))))
        g.forget("X", "Y", "Z")
        g.features["m89"] += 1
    elif roll < 0.8:  # resets that refuse nothing
        choice = rng.random()
        if choice < 0.4:
            g.emit("CYCL DEF 7.0 DATUM SHIFT")
            g.emit("CYCL DEF 7.1 X%s" % g.num(D0))
            g.emit("CYCL DEF 7.2 Y%s" % g.num(D0))
        elif choice < 0.7:
            g.emit("CYCL DEF 10.0 ROTATION")
            g.emit("CYCL DEF 10.1 ROT%s" % g.num(D0))
        else:
            g.emit("PLANE RESET STAY")
        g.features["reset"] += 1
    else:  # a line that writes nothing new (the same point again)
        g.emit("L X%s Y%s" % (g.num(x0), g.num(y0)))  # type: ignore[arg-type]
    return True


# ---------------------------------------------------------------------------
# The properties
# ---------------------------------------------------------------------------


@dataclass
class Violation:
    """One property that did not hold on one program."""

    prop: str  # crash, partial-write, reason, identity, round-trip, oracle, twice, refusal
    op: str  # what was run, with its parameters
    detail: str
    program: str = ""
    params: Dict[str, Any] = dataclass_field(default_factory=dict)
    where: str = ""  # set, index, context

    def short(self) -> str:
        return "[%s] %s %s: %s" % (self.where, self.prop, self.op, self.detail[:600])


#: The absolute polar angle (Klartext ``PA``): a rotation adds the angle and keeps the result
#: in -360 to +360 (plan §7 #306), so four quarter turns bring ``PA-42`` back as ``PA+318``,
#: the same direction. The round trip compares it up to whole turns (finding FZ-1).
TURN_WORDS = ("PA",)


def same_value(label: str, a: Decimal, b: Decimal) -> bool:
    if a == b:
        return True
    return label in TURN_WORDS and (a - b) % 360 == 0


def value_differences(want: str, got: str, limit: int = 3) -> List[str]:
    """``test_geometry_oracle.value_differences``, with a word that ``got`` adds removed whole
    before the text around the numbers is compared (a rotation adds ``Y=IC(0.0)`` beside an
    ``X=IC(...)``, whose ``=IC(`` is text the oracle's version would count as changed), and a
    polar angle compared up to whole turns (``TURN_WORDS``)."""
    a, b = want.split("\n"), got.split("\n")
    if len(a) != len(b):
        return ["%d lines, expected %d" % (len(b), len(a))]
    out = []
    for number, (x, y) in enumerate(zip(a, b), start=1):
        if x == y:
            continue
        x, y = BLANK.sub("", x), BLANK.sub("", y)  # `X 18.` is `X18.` (a word added after such a one takes its blank)
        have = list(oracle.WORD.finditer(oracle.points(y)))
        position, lost, used = 0, None, set()
        for word in oracle.words_of(x):
            while position < len(have) and not (have[position].group(1) == word[0] and same_value(word[0], Decimal(have[position].group(2)), word[1])):
                position += 1
            if position >= len(have):
                lost = word
                break
            used.add(position)
            position += 1
        if lost is not None:
            out.append("line %d: %s%s is not back: %r, expected %r" % (number, lost[0], lost[1], y, x))
        else:
            text = oracle.points(y)
            for index in sorted(set(range(len(have))) - used, reverse=True):
                match = have[index]
                end = match.end()
                if "(" in match.group(1):
                    if text[end:end + 1] != ")":
                        continue  # not a whole word: left, so the text around the numbers differs
                    end += 1
                text = text[: match.start()] + text[end:]
            if oracle.rest_of(x) != oracle.rest_of(text):
                out.append("line %d: %r, expected %r (the text around the numbers differs)" % (number, y, x))
        if len(out) >= limit:
            break
    return out


BLANK = re.compile(r"(?<=[A-Za-z]) +(?=[-+.\d])")
PADDED = re.compile(r"[-+]?0\d")


def twice_problems(original: str, first: str, second: str) -> List[str]:
    """Mirror twice (``test_geometry_oracle.check_twice``, plan §7 #310 and #358): byte for byte,
    except a word the first mirror had to write in a new form. One more such form: a ``+`` the
    first mirror replaced by the ``-`` of a negative result is not written again by the second
    (``X+69.8`` about X-11 is ``X-91.8``, and back ``X69.8``): the sign is a form the first
    mirror had to change, like the decimals of #310."""
    a, m, b = original.split("\n"), first.split("\n"), second.split("\n")
    if not len(a) == len(m) == len(b):
        return ["%d lines, expected %d" % (len(b), len(a))]
    bad = []
    for number, (x, y, z) in enumerate(zip(a, m, b), start=1):
        if x == z:
            continue
        wx, wy, wz = (list(oracle.WORD.finditer(oracle.points(t))) for t in (x, y, z))
        explained = oracle.rest_of(x) == oracle.rest_of(z) and len(wx) == len(wy) == len(wz)
        if explained:
            for px, py, pz in zip(wx, wy, wz):
                if px.group(0) == pz.group(0):
                    continue
                vx, vy, vz = (g.group(2) for g in (px, py, pz))
                same_value = px.group(1) == pz.group(1) and Decimal(vx) == Decimal(vz)
                plus = vz.startswith("+") and not vx.startswith("+") and vy[:1] in ("+", "-")
                lost_plus = vx.startswith("+") and vy.startswith("-") and not vz[:1] in ("+", "-")
                # leading zeros of the integer part: every rewrite drops them (``format_number``:
                # ``007`` is written ``7``), so a padded word the first mirror wrote comes back unpadded
                padded = PADDED.match(vx) is not None and PADDED.match(vy) is None
                changed = oracle.number_form(vx) != oracle.number_form(vy) or plus or lost_plus or padded
                if not (same_value and oracle.number_form(vz) == oracle.number_form(vy) and changed):
                    explained = False
                    break
        if not explained:
            bad.append("line %d: %r, expected %r" % (number, z, x))
            if len(bad) >= 3:
                break
    return ["not the program back byte for byte: " + "; ".join(bad)] if bad else []


def plain(value: Decimal) -> Any:
    """A form value as the app sends it (a JSON number)."""
    return int(value) if value == value.to_integral_value() else float(value)


# ---------------------------------------------------------------------------
# The path oracle: every block's end point and every arc, not only the ranges
# ---------------------------------------------------------------------------

#: The extents oracle compares the ranges only: a point moved wrong inside the range, or an arc
#: turning the wrong way between the same end points, keeps the ranges. The path oracle walks the
#: original and the result with the tracker (``_nc_path.PathTracker``, which the transforms
#: share, but whose job is reading a program, not writing one) and compares the end point of
#: every block and the centre and direction of every arc with the original's, moved.

@dataclass
class PathPlan:
    """How a transform moves a point: ``point(axes) -> axes`` on column values (a lathe's X a
    diameter), ``geo`` the same on the coordinates of an arc (a lathe's X a radius), whether arcs
    turn the other way, and the tolerance."""

    point: Callable[[Dict[str, Decimal]], Dict[str, Decimal]]
    geo: Callable[[Dict[str, Decimal]], Dict[str, Decimal]]
    swap: bool
    tol: Decimal
    exact: bool
    axes: Tuple[str, ...]
    separable: bool = False  # each axis moves alone (translate, the lathe Z mirror)


def affine(cos: float, sin: float, cx: Decimal, cy: Decimal, mirror: bool, exact_matrix: Optional[Tuple[int, int, int, int]]) -> Callable[[Dict[str, Decimal]], Dict[str, Decimal]]:
    """A rotation (``mirror`` False) or a reflection about the line at the angle whose cos/sin of
    twice the angle are given, about (cx, cy), on X and Y; exact with an integer matrix."""

    def move(p: Dict[str, Decimal]) -> Dict[str, Decimal]:
        out = dict(p)
        if "X" in p and "Y" in p:
            x, y = p["X"] - cx, p["Y"] - cy
            if exact_matrix is not None:
                a, b, c, d = exact_matrix
                out["X"], out["Y"] = cx + a * x + b * y, cy + c * x + d * y
            elif mirror:
                out["X"] = cx + Decimal(repr(cos * float(x) + sin * float(y)))
                out["Y"] = cy + Decimal(repr(sin * float(x) - cos * float(y)))
            else:
                out["X"] = cx + Decimal(repr(cos * float(x) - sin * float(y)))
                out["Y"] = cy + Decimal(repr(sin * float(x) + cos * float(y)))
        return out

    return move


def path_plan(op: str, params: Dict[str, Any], lathe: bool, inch: bool, x_factor: Optional[int]) -> PathPlan:
    """The plan of ``op`` (``translate``, ``rotate``, ``mirror``) with the form values ``params``."""
    rounded = ROUNDED_INCH if inch else ROUNDED_MM
    if op == "translate":
        d = {axis: Decimal(str(params.get("d" + axis.lower(), 0))) for axis in ("X", "Y", "Z")}
        col = dict(d)
        geo_d = dict(d)
        if lathe:
            col["X"] = d["X"] * (x_factor or 1)
            geo_d["X"] = col["X"] / 2
        return PathPlan(
            lambda p: {k: v + col.get(k, D0) for k, v in p.items()},
            lambda p: {k: v + geo_d.get(k, D0) for k, v in p.items()},
            False, UNIT, True, ("X", "Y", "Z") if x_factor is not None or not lathe else ("Y", "Z"), True,
        )
    if op == "rotate":
        degrees = Decimal(str(params["angle"]))
        cx, cy = Decimal(str(params.get("cx", 0))), Decimal(str(params.get("cy", 0)))
        step = oracle.right_angle_step(degrees)
        matrix = None
        if step is not None:
            c, s = oracle.COS_SIN[step]
            matrix = (c, -s, s, c)
        r = math.radians(float(degrees))
        move = affine(math.cos(r), math.sin(r), cx, cy, False, matrix)
        return PathPlan(move, move, False, UNIT if matrix else rounded, matrix is not None, ("X", "Y", "Z"))
    about = params.get("about")
    if about == "z":
        z0 = Decimal(str(params.get("z0", 0)))

        def flip(p: Dict[str, Decimal]) -> Dict[str, Decimal]:
            out = dict(p)
            if "Z" in p:
                out["Z"] = 2 * z0 - p["Z"]
            if "Y" in p:
                out["Y"] = -p["Y"]
            return out

        return PathPlan(flip, flip, True, UNIT, True, ("X", "Y", "Z"), True)
    degrees = {"x-axis": Decimal(0), "y-axis": Decimal(90)}.get(about, Decimal(str(params.get("angle", 0))))
    cx, cy = Decimal(str(params.get("px", 0))), Decimal(str(params.get("py", 0)))
    step = oracle.right_angle_step(degrees * 2)
    matrix = None
    if step is not None and oracle.right_angle_step(degrees) is not None:
        c, s = oracle.COS_SIN[step]
        matrix = (c, s, s, -c)
    r = math.radians(2 * float(degrees))
    move = affine(math.cos(r), math.sin(r), cx, cy, True, matrix)
    return PathPlan(move, move, True, UNIT if matrix else rounded, matrix is not None, ("X", "Y", "Z"))


ROUNDED_MM = Decimal("0.002")
ROUNDED_INCH = Decimal("0.0001")
UNIT = Decimal("0.0001")

_COMPILED: Dict[int, Any] = {}


def walk_path(scripts: Scripts, text: str, context: Dict[str, Any]) -> List[Any]:
    """The tracker's ``Step`` of every line of ``text`` (``None`` where the walk raised)."""
    import _nc_path  # noqa: E402

    profile = context["profile"]
    cp = _COMPILED.get(id(profile))
    if cp is None:
        cp = _COMPILED[id(profile)] = (scripts.nc.compile_profile(profile), profile)
    tracker = _nc_path.PathTracker(context, cp[0], reach=False)
    state = None
    steps = []
    lines = text.split("\n")
    if len(lines) > 1 and lines[-1] == "":
        lines = lines[:-1]
    for number, line in enumerate(lines, 1):
        state, step = tracker.line(line, number, state, True)
        steps.append(step)
    return steps


def path_differences(before: List[Any], after: List[Any], plan: PathPlan, limit: int = 4) -> List[str]:
    """Where the result's path is not the original's, moved by ``plan``."""
    out: List[str] = []
    if len(before) != len(after):
        return ["%d lines, expected %d" % (len(after), len(before))]
    for number, (a, b) in enumerate(zip(before, after), start=1):
        pa = {k: v for k, v in (a.after or {}).items() if k in plan.axes}
        pb = {k: v for k, v in (b.after or {}).items() if k in plan.axes}
        known = {k: v for k, v in pa.items() if v is not None}
        if not plan.separable and not set(known) >= {"X", "Y"}:
            # a turn or a mirror in XY needs both X and Y: with one not known, the other axes only
            known = {k: v for k, v in known.items() if k not in ("X", "Y")}
        want = plan.point(known)
        for axis in sorted(set(pa) | set(pb)):
            got = pb.get(axis)
            if axis in want:
                if got is None:
                    out.append("line %d: %s not known in the result, expected %s" % (number, axis, want[axis]))
                elif abs(got - want[axis]) > plan.tol:
                    out.append("line %d: %s ends at %s, expected %s" % (number, axis, got, want[axis]))
        if a.arc is not None:
            if b.arc is None:
                out.append("line %d: the arc is not an arc the tracker resolves in the result" % number)
            else:
                direction = a.arc.direction if not plan.swap else {"cw": "ccw", "ccw": "cw"}.get(a.arc.direction)
                if b.arc.direction != direction:
                    out.append("line %d: the arc turns %s, expected %s" % (number, b.arc.direction, direction))
                if plan.exact or a.arc.form != "radius":
                    centre = plan.geo(dict(zip(a.arc.plane, a.arc.centre)))
                    for axis, value in zip(b.arc.plane, b.arc.centre):
                        if axis in centre and abs(value - centre[axis]) > plan.tol * (1 if plan.exact else 2):
                            out.append("line %d: the arc centre %s is %s, expected %s" % (number, axis, value, centre[axis]))
        elif b.arc is not None:
            out.append("line %d: the result has an arc where the original has none" % number)
        if len(out) >= limit:
            break
    return out[:limit]


def added_row(problem: str, report: Dict[str, Any]) -> bool:
    """A row of the result that a rotation's added word makes (finding FZ-3): ``L IY1.9`` turned
    is ``L IX-1.9 IY+0``, so under the tool of that block Y now has a row of one position. The
    rows of a tool or an offset list the axes written under it, so a word the rotation adds
    with a zero increment adds a row that is a single point: not a range that moved."""
    match = re.match(r"(\w+) (.+), (\w+): the axis has a row in the result report only$", problem)
    if not match:
        return False
    scope, where, axis = match.groups()
    for row in report.get("rows", []):
        if row.get("scope") == scope and str(row.get("where")) == where and row.get("axisId") == axis:
            return row.get("min") == row.get("max")
    return False


FRAME_WORD = re.compile(r"(?<![A-Z0-9_$])(?:A?TRANS|A?ROT|A?SCALE|A?MIRROR)(?![A-Z0-9_$])")
NOT_RESOLVED = re.compile(r"^(\w+) (.+), (\w+): 0 positions not resolved in the original, (\d+) in the result$")


def word_value(line: str, address: str) -> Optional[Decimal]:
    """The number written after ``address`` in the block ``line`` (comment cut off), or ``None``
    when the block has no such word or the word is not a plain number."""
    code = line.split(";", 1)[0]
    match = re.search(r"(?<![A-Za-z0-9_$.])%s\s*([-+]?(?:\d+\.?\d*|\.\d+))(?![A-Za-z0-9_$.])" % re.escape(address), code)
    return Decimal(match.group(1)) if match else None


def added_zero_word(problem: str, before_text: str, after_text: str, before_report: Dict[str, Any], after_report: Dict[str, Any], plan: "oracle.Plan") -> bool:
    """A position that a rotation's added zero word makes under a Sinumerik frame (finding FZ-10,
    the twin of FZ-3): after ``ATRANS X0 Y0``, ``G91 G1 X-33.1`` turned by 90 is ``G91 G1 X0.000
    Y-33.1``, and the extents cannot resolve an increment after a frame, so the axis of the zero
    word has one position not resolved in the result and none in the original. Only that case is
    accepted: the lines are the same in number, a frame word stands above, the result has a word
    of the axis with the value zero where the original had no word of the axis it comes from, at
    least as many of them as positions not resolved, and the range of the row is otherwise the
    moved range of the original."""
    match = NOT_RESOLVED.match(problem)
    if match is None:
        return False
    scope, where, axis, count = match.group(1), match.group(2), match.group(3), int(match.group(4))
    mapping = dict(plan.axes).get(axis, (axis, 1, Decimal(0)))
    if mapping is None:
        return False
    source_axis = mapping[0]
    before, after = before_text.split("\n"), after_text.split("\n")
    if len(before) != len(after):
        return False
    added, frame = 0, False
    for old, new in zip(before, after):
        if frame and word_value(old, source_axis) is None and word_value(new, axis) == 0:
            added += 1
        if FRAME_WORD.search(old.split(";", 1)[0]):
            frame = True
    if added == 0 or added < count:
        return False
    old_rows, new_rows = oracle.grouped(before_report).get((scope, where), {}), oracle.grouped(after_report).get((scope, where), {})
    source, target = old_rows.get(source_axis), new_rows.get(axis)
    if source is None or target is None or int(source.get("unresolved", 0) or 0) != 0:
        return False
    return oracle.compare_row("%s %s, %s" % (scope, where, axis), source, target, mapping, oracle.UNIT) == []


WIDENED = re.compile(r"^(?:tool|offset) .*: (minimum|maximum) (\S+), expected (\S+)$")


def widened(problem: str) -> bool:
    """A range of a tool or an offset that a rotation widened with the position an added word
    writes (finding FZ-3): under ``TOOL CALL 10``, ``L IY+140.8`` moves along Y from an X written
    under the tool before, so the original's row of X does not hold that X; turned, the block
    writes both words and the row of Y holds it. Such a range may only grow."""
    parts = [p.strip() for p in problem.split(";")]
    for part in parts:
        match = WIDENED.match(part)
        if match is None:
            return False
        side, got, want = match.group(1), Decimal(match.group(2)), Decimal(match.group(3))
        if (side == "minimum" and got > want) or (side == "maximum" and got < want):
            return False
    return True


class Checker:
    """Runs the transforms on one program in one context and collects every violation."""

    def __init__(self, scripts: Scripts, text: str, context: Dict[str, Any], lathe: bool, where: str = "", seed: int = 0) -> None:
        self.seed = seed
        self.scripts = scripts
        self.text = text
        self.context = context
        self.lathe = lathe
        self.where = where
        self.lines = len(text.split("\n"))
        self.violations: List[Violation] = []
        self._extents: Dict[str, Optional[Dict[str, Any]]] = {}
        self.statuses: Dict[str, str] = {}
        self.reasons: "collections.Counter[str]" = collections.Counter()

    # -- plumbing ----------------------------------------------------------------------------

    def fail(self, prop: str, op: str, detail: str, params: Optional[Dict[str, Any]] = None, program: Optional[str] = None) -> None:
        self.violations.append(Violation(prop, op, detail, self.text if program is None else program, dict(params or {}), self.where))

    def extents(self, text: str) -> Optional[Dict[str, Any]]:
        if text not in self._extents:
            out = self.scripts.run("extents", text, self.context)
            if out.crash:
                self.fail("crash", "extents", out.crash, program=text)
            self._extents[text] = out.payload
        return self._extents[text]

    def run(self, script: str, text: str, params: Dict[str, Any], op: str) -> Outcome:
        """One run, with the checks every run has to pass (no crash, all or nothing, the ids)."""
        out = self.scripts.run(script, text, self.context, params)
        label = "%s %s" % (script, json.dumps(params, sort_keys=True))
        if out.crash:
            self.fail("crash", label, out.crash, params, text)
            return out
        lines = len(text.split("\n"))
        if out.refused and out.text != text:
            self.fail("partial-write", label, "a refused run changed the text: " + "; ".join(oracle.first_differences(text, out.text)), params, text)
        reasons = self.scripts.geom.REASONS
        for finding in out.findings:
            severity, reason, line = finding.get("severity"), finding.get("reason"), finding.get("line")
            if not isinstance(line, int) or isinstance(line, bool) or not 1 <= line <= lines:
                self.fail("reason", label, "a finding without a line of the program: %r" % (finding,), params, text)
            if severity == "error":
                if reason in reasons:
                    if op not in reasons[reason][0]:
                        self.fail("reason", label, "%s is not a reason of %s: %r" % (reason, op, finding), params, text)
                elif reason not in self.scripts.run_reasons:
                    self.fail("reason", label, "an error with no reason id of plan §6.1: %r" % (finding,), params, text)
            elif severity == "info":
                if reason not in self.scripts.geom.INFO and not (op == "translate" and reason in self.scripts.own_info):
                    self.fail("reason", label, "information with no id of INFO: %r" % (finding,), params, text)
            elif severity == "warning":
                if reason not in self.scripts.geom.WARNINGS:
                    self.fail("reason", label, "a warning with no id of WARNINGS: %r" % (finding,), params, text)
                if out.refused:
                    self.fail("reason", label, "a refused run lists a warning: %r" % (finding,), params, text)
            else:
                self.fail("reason", label, "a finding of no known severity: %r" % (finding,), params, text)
            if not str(finding.get("message", "")).strip():
                self.fail("reason", label, "a finding without a message: %r" % (finding,), params, text)
        return out

    def oracle(self, plan: "oracle.Plan", after: str, label: str, params: Dict[str, Any], op: str = "", path_params: Optional[Dict[str, Any]] = None) -> None:
        before_report, after_report = self.extents(self.text), self.extents(after)
        if before_report is None or after_report is None:
            return
        problems = oracle.check_extents(before_report, after_report, plan, oracle.is_inch(self.text))
        if op == "rotate":
            problems = [
                p for p in problems
                if not added_row(p, after_report) and not widened(p) and not added_zero_word(p, self.text, after, before_report, after_report, plan)
            ]
        if problems:
            self.fail("oracle", label, "; ".join(problems[:4]), params)
        if op:
            self.path(op, path_params if path_params is not None else params, after, label, params, before_report)

    def path(self, op: str, form: Dict[str, Any], after: str, label: str, params: Dict[str, Any], before_report: Dict[str, Any]) -> None:
        """The path oracle (above) on the result ``after`` of ``op`` with the form values ``form``."""
        try:
            before = self._steps if getattr(self, "_steps", None) is not None else walk_path(self.scripts, self.text, self.context)
            self._steps = before
            result = walk_path(self.scripts, after, self.context)
        except Exception:  # noqa: BLE001 - the tracker raising is a crash of the reading side
            self.fail("crash", "the path tracker", traceback.format_exc()[-2000:], params, after)
            return
        factor = oracle.diameter_factor(str(before_report.get("message", ""))) if self.lathe else 1
        plan = path_plan(op, form, self.lathe, oracle.is_inch(self.text), factor)
        problems = path_differences(before, result, plan)
        if problems:
            self.fail("path", label, "; ".join(problems), params)

    def path_back(self, out: Outcome, label: str, params: Dict[str, Any], first: str) -> None:
        """A rounded transform and its inverse: the path back within twice the rounding tolerance."""
        if out.crash:
            return
        if out.refused:
            self.fail("round-trip", label, "the way back was refused: %s" % dict(out.reasons), params, first)
            return
        try:
            before = walk_path(self.scripts, self.text, self.context)
            result = walk_path(self.scripts, out.text, self.context)
        except Exception:  # noqa: BLE001
            self.fail("crash", "the path tracker", traceback.format_exc()[-2000:], params, out.text)
            return
        tol = 2 * (ROUNDED_INCH if oracle.is_inch(self.text) else ROUNDED_MM)
        plan = PathPlan(lambda p: dict(p), lambda p: dict(p), False, tol, False, ("X", "Y", "Z"), True)
        problems = path_differences(before, result, plan)
        if problems:
            self.fail("round-trip", label, "; ".join(problems), params)

    def identity(self, out: Outcome, label: str, params: Dict[str, Any]) -> None:
        if out.crash or out.refused:
            return
        if out.text != self.text:
            self.fail("identity", label, "not the program back byte for byte: " + "; ".join(oracle.first_differences(self.text, out.text)), params)

    def back(self, out: Outcome, label: str, params: Dict[str, Any], first: str) -> None:
        if out.crash:
            return
        if out.refused:
            self.fail("round-trip", label, "the way back was refused: %s" % dict(out.reasons), params, first)
            return
        problems = value_differences(self.text, out.text)
        if problems:
            self.fail("round-trip", label, "; ".join(problems), params)

    def consistent(self, zero: Outcome, moved: Outcome, label: str, params: Dict[str, Any]) -> None:
        """A run that changes nothing (shift 0, turn by 0) may refuse less than one that moves
        (a variable, a resolution, an assumed mode or an intermediate point matter only where a
        word changes), never more: every reason of the first has to be a reason of the second."""
        if zero.crash or moved.crash or not zero.refused:
            return
        if not moved.refused:
            self.fail("refusal", label, "refused when it changes nothing (%s), written when it moves" % dict(zero.reasons), params)
            return
        extra = sorted(set(zero.reasons) - set(moved.reasons))
        if extra:
            self.fail("refusal", label, "refused for %s when it changes nothing, not when it moves" % extra, params)

    def status(self, name: str, out: Outcome) -> None:
        if out.crash:
            self.statuses[name] = "crash"
        else:
            self.statuses[name] = "refused" if out.refused else "written"
            self.reasons.update("%s:%s" % (name, r) for r in out.reasons)

    # -- a selection --------------------------------------------------------------------------

    def selection(self, script: str, params: Dict[str, Any], op: str, whole: Outcome, rng: random.Random) -> None:
        """A selection of the program, primed with the lines above it: where both runs write,
        the selection's lines are the whole run's lines; where the whole run refuses a block
        inside the selection, the selection refuses too."""
        lines = self.text.split("\n")
        if lines and lines[-1] == "":
            lines = lines[:-1]
        if len(lines) < 3 or whole.crash:
            return
        start = rng.randint(1, len(lines) - 1)
        end = rng.randint(start, min(len(lines), start + rng.randint(1, 12)))
        part = "\n".join(lines[start - 1:end])
        label = "%s on lines %d to %d %s" % (script, start, end, json.dumps(params, sort_keys=True))
        out = self.scripts.run(script, part, self.context, params, preceding=lines[: start - 1], following=lines[end:])
        if out.crash:
            self.fail("crash", label, out.crash, params)
            return
        if out.refused and out.text != part:
            self.fail("partial-write", label, "a refused selection changed the text", params)
        for finding in out.findings:
            line = finding.get("line")
            if not isinstance(line, int) or not start <= line <= end:
                self.fail("reason", label, "a finding outside the selection: %r" % (finding,), params)
                break
        if out.refused:
            return
        if whole.refused:
            inside = sorted({f.get("line") for f in whole.findings if f.get("severity") == "error" and isinstance(f.get("line"), int) and start <= f["line"] <= end})
            if inside:
                reasons = sorted({str(f.get("reason")) for f in whole.findings if f.get("severity") == "error" and f.get("line") in inside})
                self.fail("selection", label, "the whole run refuses lines %s inside the selection (%s), the selection was written" % (inside, reasons), params)
            return
        want = "\n".join(whole.text.split("\n")[start - 1:end])
        # The first move of a selection writes the axes the whole run leaves modal (its start
        # is not moved with it), so the selection may add words; it may not change one.
        problems = value_differences(want, out.text)
        if problems:
            self.fail("selection", label, "not the whole run's lines: " + "; ".join(problems), params)

    # -- the three transforms ----------------------------------------------------------------

    def translate(self, shift: Dict[str, Decimal]) -> None:
        params = {k: plain(v) for k, v in shift.items()}
        zero = {"dx": 0, "dy": 0, "dz": 0}
        moved = self.run("translate", self.text, params, "translate")
        self.status("translate", moved)
        nothing = self.run("translate", self.text, zero, "translate")
        self.identity(nothing, "translate by 0, 0, 0", zero)
        self.consistent(nothing, moved, "translate by 0 and by d", params)
        self.selection("translate", params, "translate", moved, random.Random(self.seed))
        if moved.crash or moved.refused:
            return
        self.oracle(oracle.plan_translate(params["dx"], params["dy"], params["dz"]), moved.text, "translate %s" % params, params, "translate")
        minus = {k: plain(-v) for k, v in shift.items()}
        back = self.run("translate", moved.text, minus, "translate")
        self.back(back, "translate by d, then by -d", params, moved.text)

    def rotate(self, centre: Tuple[Decimal, Decimal], other: Decimal) -> None:
        base = {"cx": plain(centre[0]), "cy": plain(centre[1])}
        quarter = dict(base, angle=90)
        first = self.run("rotate", self.text, quarter, "rotate")
        self.status("rotate", first)
        if not self.lathe:
            self.selection("rotate", quarter, "rotate", first, random.Random(self.seed + 1))
        for angle in (0, 360):
            params = dict(base, angle=angle)
            out = self.run("rotate", self.text, params, "rotate")
            self.identity(out, "rotate by %d" % angle, params)
            self.consistent(out, first, "rotate by %d and by 90" % angle, params)
        if self.lathe:
            if not first.crash and not first.refused:
                self.fail("refusal", "rotate on a lathe", "a turning program was rotated", quarter)
            return
        if not first.crash and not first.refused:
            runs = [first]
            for turn in (2, 3, 4):
                out = self.run("rotate", runs[-1].text, quarter, "rotate")
                if out.crash:
                    return
                if out.refused:
                    self.fail("round-trip", "rotate by 90, turn %d of 4" % turn, "refused: %s" % dict(out.reasons), quarter, runs[-1].text)
                    return
                runs.append(out)
            for turns, run in enumerate(runs[:3], start=1):
                self.oracle(oracle.plan_rotate(90 * turns, base["cx"], base["cy"]), run.text, "rotate by 90, %d times" % turns, quarter, "rotate", dict(base, angle=90 * turns))
            self.back(runs[-1], "rotate by 90 four times", quarter, runs[2].text)
            half = dict(base, angle=180)
            out = self.run("rotate", self.text, half, "rotate")
            if not out.crash and not out.refused:
                self.oracle(oracle.plan_rotate(180, base["cx"], base["cy"]), out.text, "rotate by 180", half, "rotate")
                # a half turn writes only the words of a block that moves in one axis; two
                # quarter turns write both, so every word of the half turn has to be in them
                problems = value_differences(out.text, runs[1].text)
                if out.text != runs[1].text and problems:
                    self.fail("round-trip", "rotate by 180 against 90 twice", "; ".join(problems), half)
            elif out.refused:
                self.fail("refusal", "rotate by 180", "refused (%s) where 90 was written" % dict(out.reasons), half)
        params = dict(base, angle=plain(other))
        out = self.run("rotate", self.text, params, "rotate")
        if not out.crash and not out.refused:
            self.oracle(oracle.plan_rotate(params["angle"], base["cx"], base["cy"]), out.text, "rotate by %s" % params["angle"], params, "rotate")
            back = self.run("rotate", out.text, dict(base, angle=plain(-other)), "rotate")
            if not back.refused:
                self.path_back(back, "rotate by %s and back" % params["angle"], params, out.text)

    def mirror(self, point: Tuple[Decimal, Decimal], z0: Decimal, angle: Decimal) -> None:
        if self.lathe:
            variants = [{"about": "z", "z0": plain(z0)}, {"about": "z", "z0": 0}]
            out = self.run("mirror", self.text, {"about": "y-axis"}, "mirror")
            if not out.crash and not out.refused:
                self.fail("refusal", "mirror in X on a lathe", "a turning program was mirrored in X", {"about": "y-axis"})
        else:
            px, py = plain(point[0]), plain(point[1])
            variants = [
                {"about": "y-axis", "px": px, "py": py},
                {"about": "x-axis", "px": px, "py": py},
                {"about": "line", "px": px, "py": py, "angle": 90},
            ]
            out = self.run("mirror", self.text, {"about": "z"}, "lathe-z-mirror")
            if not out.crash and not out.refused:
                self.fail("refusal", "mirror in Z on a milling program", "a milling program was mirrored in Z", {"about": "z"})
        outs = []
        for params in variants:
            op = "lathe-z-mirror" if params["about"] == "z" else "mirror"
            first = self.run("mirror", self.text, params, op)
            outs.append(first)
            if params is variants[0]:
                self.status("mirror", first)
                self.selection("mirror", params, op, first, random.Random(self.seed + 2))
            if first.crash or first.refused:
                continue
            plan = oracle.plan_mirror(params["about"], params.get("px", 0), params.get("py", 0), params.get("angle", 0), params.get("z0", 0))
            self.oracle(plan, first.text, "mirror %s" % params, params, "mirror")
            second = self.run("mirror", first.text, params, op)
            if second.crash:
                continue
            if second.refused:
                self.fail("twice", "mirror twice %s" % params, "the second mirror was refused: %s" % dict(second.reasons), params, first.text)
            for problem in twice_problems(self.text, first.text, second.text) if not second.refused else []:
                self.fail("twice", "mirror twice %s" % params, problem, params)
        if not self.lathe:
            # the line at 90 degrees through the point is the mirror in X through it
            a, c = outs[0], outs[2]
            if not a.crash and not c.crash:
                if a.refused != c.refused:
                    self.fail("refusal", "mirror in X and about the line at 90", "one refused, one written: %s / %s" % (dict(a.reasons), dict(c.reasons)), variants[2])
                elif not a.refused and a.text != c.text:
                    self.fail("identity", "mirror in X and about the line at 90", "; ".join(oracle.first_differences(a.text, c.text)), variants[2])
            params = {"about": "line", "px": plain(point[0]), "py": plain(point[1]), "angle": plain(angle)}
            out = self.run("mirror", self.text, params, "mirror")
            if not out.crash and not out.refused:
                plan = oracle.plan_mirror("line", params["px"], params["py"], params["angle"])
                self.oracle(plan, out.text, "mirror %s" % params, params, "mirror")
                back = self.run("mirror", out.text, params, "mirror")
                if not back.refused:
                    self.path_back(back, "mirror about the line at %s twice" % params["angle"], params, out.text)


# ---------------------------------------------------------------------------
# One program: generate, run, check
# ---------------------------------------------------------------------------

GENERATORS: Dict[str, Callable[[Gen], None]] = {"fanuc-mill": fanuc_mill, "fanuc-lathe-a": fanuc_lathe, "fanuc-lathe-b": fanuc_lathe, "okuma": okuma, "sinumerik-turn": sinumerik_turn, "sinumerik-mill": sinumerik_mill, "klartext": klartext}


def seed_of(set_index: int, index: int, base: int = SEED) -> int:
    return base + 1000003 * set_index + index


@dataclass
class Program:
    """A generated program, the context it runs in, and the transform parameters drawn for it."""

    profile_set: ProfileSet
    index: int
    seed: int
    context_label: str
    text: str
    features: "collections.Counter[str]"
    shift: Dict[str, Decimal]
    centre: Tuple[Decimal, Decimal]
    angle: Decimal
    point: Tuple[Decimal, Decimal]
    z0: Decimal
    line_angle: Decimal


def generate(profile_set: ProfileSet, set_index: int, index: int, base: int = SEED) -> Program:
    seed = seed_of(set_index, index, base)
    rng = random.Random(seed)
    label = rng.choice([c[0] for c in profile_set.contexts])
    inch = profile_set.kind in ("fanuc-mill", "sinumerik-mill") and rng.random() < 0.1
    g = Gen(rng, profile_set.kind, inch=inch)
    g.pointless = label in ("IS-B",) or profile_set.kind in ("okuma",)
    GENERATORS[profile_set.kind](g)
    params_rng = random.Random(seed ^ 0x5F3759DF)

    def amount(lo: float, hi: float) -> Decimal:
        return q(params_rng.uniform(lo, hi), params_rng.choice([0, 0, 1, 2, 3]))

    shift = {"dx": amount(-50, 50), "dy": amount(-50, 50) if not profile_set.lathe else D0, "dz": amount(-20, 20)}
    for key in shift:
        if params_rng.random() < 0.2:
            shift[key] = D0
    angle = Decimal(params_rng.choice(["30", "45", "17.5", "-60", "123.456", "200"]))
    line_angle = Decimal(params_rng.choice(["45", "30", "135", "-22.5", "60"]))
    return Program(
        profile_set, index, seed, label, g.text(), g.features, shift,
        (amount(-20, 20), amount(-20, 20)), angle, (amount(-20, 20), amount(-20, 20)), amount(-30, 30), line_angle,
    )


def check_program(scripts: Scripts, program: Program, ops: Sequence[str] = ("translate", "rotate", "mirror")) -> Checker:
    where = "%s:%d (%s, seed %d)" % (program.profile_set.name, program.index, program.context_label, program.seed)
    checker = Checker(scripts, program.text, context_of(program.profile_set, program.context_label), program.profile_set.lathe, where, program.seed)
    if "translate" in ops:
        checker.translate(program.shift)
    if "rotate" in ops:
        checker.rotate(program.centre, program.angle)
    if "mirror" in ops:
        checker.mirror(program.point, program.z0, program.line_angle)
    return checker


# ---------------------------------------------------------------------------
# Minimising a repro (for the review)
# ---------------------------------------------------------------------------


def minimise(text: str, still_fails: Callable[[str], bool], keep: int = 0) -> str:
    """The smallest program (by lines, greedily) for which ``still_fails`` holds: chunks of lines
    are dropped while the failure stays, from halves down to single lines. The first ``keep``
    lines stay (a Klartext ``BEGIN PGM``). Klartext block numbers are written again from 0."""
    lines = text.split("\n")
    head, body = lines[:keep], lines[keep:]

    def joined(part: List[str]) -> str:
        out = head + part
        if out and out[0].startswith("0 BEGIN PGM"):
            renumbered, n = [], 0
            for line in out:
                word = line.split(" ", 1)
                if word[0].isdigit() and len(word) == 2:
                    renumbered.append("%d %s" % (n, word[1]))
                    n += 1
                else:
                    renumbered.append(line)
            out = renumbered
        return "\n".join(out)

    size = max(1, len(body) // 2)
    while size >= 1:
        index, changed = 0, False
        while index < len(body):
            trial = body[:index] + body[index + size:]
            if trial != body and still_fails(joined(trial)):
                body, changed = trial, True
            else:
                index += size
        if not changed:
            size //= 2
    return joined(body)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

_REPORT_LINES: List[str] = []


def run_set(test: unittest.TestCase, name: str) -> None:
    """``PROGRAMS`` programs of the profile set ``name``; fails with the first violations."""
    scripts = Scripts.get()
    index = [s.name for s in PROFILE_SETS].index(name)
    profile_set = PROFILE_SETS[index]
    only = ONLY.split(":") if ONLY else None
    written: "collections.Counter[str]" = collections.Counter()
    found: List[Violation] = []
    numbers = range(PROGRAMS) if only is None or only[0] != name else [int(only[1])]
    if only is not None and only[0] != name:
        numbers = range(0)
    for number in numbers:
        program = generate(profile_set, index, number)
        checker = check_program(scripts, program)
        for transform, status in checker.statuses.items():
            written[transform + ":" + status] += 1
        for violation in checker.violations:
            violation.params.setdefault("_seed", program.seed)
            found.append(violation)
            if REPORT:
                record = dict(violation.__dict__)
                record["features"] = dict(program.features)
                _REPORT_LINES.append(json.dumps(record, sort_keys=True, default=str))
    if REPORT:
        with open(REPORT, "a", encoding="utf-8") as handle:
            for line in _REPORT_LINES:
                handle.write(line + "\n")
            handle.write(json.dumps({"set": name, "programs": len(numbers), "statuses": dict(written)}) + "\n")
        _REPORT_LINES.clear()
    if found:
        test.fail("%d violations in %s:\n%s" % (len(found), name, "\n".join(v.short() + "\n" + v.program[:1200] for v in found[:3])))
    if only is None and PROGRAMS >= DEFAULT_PROGRAMS:
        # a generator that came to write only refused programs would test nothing
        test.assertGreater(written["translate:written"], 0, "no program of %s was moved: %s" % (name, dict(written)))


class GeometryFuzzTest(unittest.TestCase):
    """The properties of the module docstring on random programs of each profile set."""

    def test_fanuc_mill(self) -> None:
        run_set(self, "fanuc-mill")

    def test_fanuc_lathe_system_a(self) -> None:
        run_set(self, "fanuc-lathe-a")

    def test_fanuc_lathe_system_b(self) -> None:
        run_set(self, "fanuc-lathe-b")

    def test_klartext(self) -> None:
        run_set(self, "klartext")

    def test_okuma_lathe(self) -> None:
        run_set(self, "okuma")

    def test_sinumerik_turning(self) -> None:
        run_set(self, "sinumerik-turn")

    def test_sinumerik_milling(self) -> None:
        run_set(self, "sinumerik-mill")


class GeneratorSelfTest(unittest.TestCase):
    """The generator and the checks themselves: reproducible, covering, and able to fail."""

    def test_a_seed_gives_the_same_program(self) -> None:
        for index, profile_set in enumerate(PROFILE_SETS):
            with self.subTest(profile=profile_set.name):
                a, b = generate(profile_set, index, 3), generate(profile_set, index, 3)
                self.assertEqual(a.text, b.text)
                self.assertEqual((a.shift, a.centre, a.point), (b.shift, b.centre, b.point))
                self.assertNotEqual(a.text, generate(profile_set, index, 4).text)

    def test_the_generator_writes_the_forms(self) -> None:
        """Over 100 programs per set, the forms of the coverage table appear."""
        wanted = {
            "fanuc-mill": {"line-abs", "line-inc", "arc-centre", "arc-radius", "arc-full", "arc-modal", "helix", "comp-on", "drill", "drill-inc", "expression", "plane-G18", "g53", "g28-inc", "work-offset", "frame", "call", "reset", "plane-in-arc", "arc-one-axis", "loop", "word-order", "trailing-comment", "plus-sign", "leading-zero", "trailing-zero", "blank-after-address"},
            "fanuc-lathe-a": {"line", "arc-centre", "arc-radius", "comp-on", "cycle-pass", "cycle-taper", "thread", "roughing", "corner", "face-to-centre", "g28-uw"},
            "fanuc-lathe-b": {"line", "arc-centre", "arc-radius", "comp-on", "cycle-pass", "thread", "roughing"},
            "klartext": {"l", "l-inc", "c", "cc-inc", "cr", "lp", "cp", "rnd-chf", "cycle", "call-pos", "blk-form", "ct", "expression", "c-one-axis", "cp-helix", "lp-ipa", "appr-dep", "m89", "reset", "decimal-comma", "unsigned"},
            "okuma": {"line", "line-inc", "arc-centre", "comp", "arc-l", "expression"},
            "sinumerik-turn": {"line", "arc-centre", "arc-centre-ac", "arc-cr", "comp", "diam-DIAMOF", "diam-DIAM90", "expression"},
            "sinumerik-mill": {"line", "arc-centre", "arc-centre-ac", "arc-cr", "helix", "comp", "mcall", "cycle-call", "machine", "frame", "expression", "reset", "turn", "arc-ar", "rnd-chr", "ct-cip"},
        }
        for index, profile_set in enumerate(PROFILE_SETS):
            seen: "collections.Counter[str]" = collections.Counter()
            for number in range(100):
                seen.update(generate(profile_set, index, number, base=DEFAULT_SEED).features)
            with self.subTest(profile=profile_set.name):
                self.assertEqual(sorted(wanted[profile_set.name] - set(seen)), [])

    def test_a_wrong_transform_is_caught(self) -> None:
        """A translate that forgets the Z shift, run through the same checks, fails the oracle and
        the round trip; one that writes part of a refused run fails all or nothing."""
        scripts = Scripts.get()
        text = "G21 G17 G90\nG0 X0. Y0. Z10.\nG1 Z-2. F100.\nG1 X20. Y5.\nG3 X-20. Y5. I-20. J0.\nG0 Z10.\nM30\n"
        context = context_of(PROFILE_SETS[0], "no machine")

        class Wrong(Scripts):
            def __init__(self, real: Scripts, fault: str) -> None:
                self.__dict__.update(real.__dict__)
                self.fault = fault

            def run(self, name: str, text: str, context: Dict[str, Any], params: Optional[Dict[str, Any]] = None, preceding: Optional[List[str]] = None) -> Outcome:
                params = dict(params or {})
                if name == "translate" and self.fault == "forgot-z":
                    params["dz"] = 0
                out = Scripts.run(self, name, text, context, params, preceding)
                if name == "mirror" and self.fault == "no-swap" and out.payload is not None and not out.refused:
                    out.payload["text"] = out.text.replace("G2 ", "G#").replace("G3 ", "G2 ").replace("G#", "G3 ")
                if name == "translate" and self.fault == "partial" and out.payload is not None:
                    out.payload["text"] = text.replace("X20.", "X21.")
                    out.payload["findings"] = [{"line": 1, "severity": "error", "message": "x: y.", "reason": "frame"}]
                return out

        shift = {"dx": Decimal("1.5"), "dy": D0, "dz": Decimal(2)}
        right = Checker(scripts, text, context, False)
        right.translate(shift)
        self.assertEqual([v.short() for v in right.violations], [])
        forgot = Checker(Wrong(scripts, "forgot-z"), text, context, False)
        forgot.translate(shift)
        self.assertIn("oracle", {v.prop for v in forgot.violations})
        partial = Checker(Wrong(scripts, "partial"), text, context, False)
        partial.translate(shift)
        self.assertIn("partial-write", {v.prop for v in partial.violations})
        # a mirror that does not swap G2 and G3 keeps every range (the arc is a half circle
        # whose bulge mirrors onto itself in Y); the path oracle sees the direction
        swap = Checker(Wrong(scripts, "no-swap"), text, context, False)
        swap.mirror((D0, D0), D0, Decimal(30))
        self.assertIn("path", {v.prop for v in swap.violations})

    def test_in_process_is_the_app_run(self) -> None:
        """One program run in this process and as a child process gives the same envelope."""
        scripts = Scripts.get()
        program = generate(PROFILE_SETS[0], 0, 1)
        context = context_of(PROFILE_SETS[0], program.context_label)
        params = {k: plain(v) for k, v in program.shift.items()}
        mine = scripts.run("translate", program.text, context, params)
        child = scripts.run_child("translate", program.text, context, params)
        self.assertEqual(mine.payload, child.payload)

    def test_minimise(self) -> None:
        text = "\n".join("G1 X%d." % i for i in range(40))
        small = minimise(text, lambda t: "X17." in t and "X3." in t)
        self.assertEqual(small, "G1 X3.\nG1 X17.")

    def test_value_differences(self) -> None:
        self.assertEqual(value_differences("G1 X=IC(-35.9) Z2.607", "G1 X=IC(-35.9) Y=IC(0.0) Z2.607"), [])
        self.assertEqual(value_differences("13 CP PA-42 DR-", "13 CP PA+318 DR-"), [])
        self.assertNotEqual(value_differences("13 CP PA-42 DR-", "13 CP PA+317 DR-"), [])
        self.assertNotEqual(value_differences("G1 X-42", "G1 X318"), [])
        self.assertNotEqual(value_differences("G1 X5 Y1", "G1 X5"), [])


# ---------------------------------------------------------------------------
# The findings of the review (FZ-n): minimal repros, expected to fail until fixed
# ---------------------------------------------------------------------------


class KnownFindingTest(unittest.TestCase):
    """One minimal repro per finding of the fuzz review (the report of BL-NC-fuzz). Each holds
    the behaviour the plan asks for; an open one fails today, and the batch that fixes FZ-n
    removes its ``expectedFailure`` (and the generator gate in ``OPEN_FINDINGS``, where it has
    one). Fixed in v1.2.0 (NCF-A, NCF-B; flipped at integration, NCF-C): FZ-4, FZ-6, FZ-7, FZ-9;
    in Wave Y (BL-NC-geometry): FZ-5, FZ-8. None is open."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.scripts = Scripts.get()

    def context(self, name: str, label: str = "") -> Dict[str, Any]:
        profile_set = [p for p in PROFILE_SETS if p.name == name][0]
        return context_of(profile_set, label or profile_set.contexts[0][0])

    def assertWritten(self, out: Outcome) -> None:
        self.assertEqual(out.crash, "")
        self.assertFalse(out.refused, [(f.get("line"), f.get("reason"), f.get("message")) for f in out.findings if f.get("severity") == "error"])

    def test_fz4_a_drilling_cycle_after_an_arc_is_no_arc(self) -> None:
        """FZ-4: a Fanuc drilling cycle in force after G2/G3 positions at rapid, but the tracker
        reads the cycle block under the motion code G3 as an arc whose radius is the R plane: the
        extents of this program reach X25 (the true X range ends at 20), and a transform reads
        the same arc (arc check, the oracle)."""
        text = "G21 G17 G90\nG0 X0. Y0. Z10.\nG3 X20. Y0. I10. J0. F100.\nG81 X20. Y10. Z-5. R5. F100.\nG80\nM30\n"
        context = self.context("fanuc-mill", "no machine")
        steps = walk_path(self.scripts, text, context)
        report = self.scripts.run("extents", text, context).payload or {}
        x = [r for r in report.get("rows", []) if r.get("scope") == "program" and r.get("axisId") == "X"][0]
        self.assertEqual((steps[3].arc, x.get("max")), (None, "20"))

    def test_fz5_a_selection_refuses_what_the_whole_run_refuses(self) -> None:
        """FZ-5: the whole run refuses the Y moves before the program first turns A (lines 3 and
        4, ``rotary-turned``); the same lines as a selection were moved, because the rotary word
        is below the selection. Fixed in Wave Y (plan section 7 #503): the selection gets the
        lines below it (``input.followingLines``), and without them refuses such a move."""
        lines = ["G21 G17 G90", "G0 X0. Y0. Z5.", "G1 Y10. F100.", "G1 Y20.", "G0 A10.", "G0 A0.", "M30"]
        context = self.context("fanuc-mill", "no machine")
        whole = self.scripts.run("translate", "\n".join(lines), context, {"dy": 1})
        self.assertEqual(sorted({f["line"] for f in whole.findings if f.get("severity") == "error"}), [2, 3, 4])
        part = self.scripts.run("translate", "\n".join(lines[2:4]), context, {"dy": 1}, preceding=lines[:2], following=lines[4:])
        self.assertTrue(part.refused, part.text)
        self.assertEqual([(f["line"], f["reason"]) for f in part.findings if f.get("severity") == "error"], [(3, "rotary-turned"), (4, "rotary-turned")])
        # Lines below that never turn A: moved, as the whole run moves them.
        never = lines[:4] + ["G0 Z50.", "M30"]
        self.assertFalse(self.scripts.run("translate", "\n".join(never), context, {"dy": 1}).refused)
        self.assertFalse(self.scripts.run("translate", "\n".join(never[2:4]), context, {"dy": 1}, preceding=never[:2], following=never[4:]).refused)
        # Without the lines below, such a move is refused rather than guessed.
        blind = self.scripts.run("translate", "\n".join(never[2:4]), context, {"dy": 1}, preceding=never[:2])
        self.assertEqual({f["reason"] for f in blind.findings if f.get("severity") == "error"}, {"selection-below"})

    def test_fz6_klartext_approach_and_departure_turn(self) -> None:
        """FZ-6: plan §5 P4a item 5 allows APPR LT, LN, CT and DEP LT under rotate and mirror (LEN
        and CCA keep their values); the database gives these codes no parameters, so LEN and CCA
        are words nothing describes and the run is refused (``word-unknown``)."""
        text = "\n".join([
            "0 BEGIN PGM A MM", "1 TOOL CALL 1 Z S3000", "2 L X+0 Y+0 Z+5 R0 FMAX",
            "3 APPR LT X+10 Y+20 LEN15 RR F100", "4 L X+30 Y+20", "5 DEP LT LEN12.5 F100",
            "6 APPR CT X+10 Y+20 CCA90 R+5 RL F100", "7 L X+30 Y+20", "8 DEP LCT X+40 Y+40 R5 F100", "9 END PGM A MM",
        ])
        context = self.context("klartext")
        self.assertWritten(self.scripts.run("rotate", text, context, {"angle": 90}))
        self.assertWritten(self.scripts.run("mirror", text, context, {"about": "y-axis"}))

    def test_fz7_sinumerik_corner_rounding_and_chamfer(self) -> None:
        """FZ-7: ``RND=`` and ``CHR=`` on a Sinumerik move are lengths that keep their value
        (``_nc_geom``'s role ``length`` names them), but the database does not know them, so
        every transform refuses the block (an assignment word nothing describes)."""
        text = "N10 G17 G90 G71\nN20 G0 X0 Y0 Z5\nN30 G1 X10 Y0 RND=2 F200\nN40 G1 X10 Y10 CHR=1\nN50 G1 X0 Y10\nN60 M30"
        context = self.context("sinumerik-mill")
        self.assertWritten(self.scripts.run("translate", text, context, {"dx": 1}))
        self.assertWritten(self.scripts.run("rotate", text, context, {"angle": 90}))

    def test_fz8_fanuc_corner_words(self) -> None:
        """FZ-8: a Fanuc chamfer or corner rounding between two moves (``,C1.``, ``,R2.``) has no
        sign and keeps its value under every transform; the code sets do not describe it, so
        rotate, mirror and the lathe Z mirror refuse it (``word-unknown``; translate leaves it
        and lists it)."""
        lathe = "%\nO0001\nG18 G21 G40 G99\nT0101\nG0 X50. Z2.\nG1 X20. Z-10. ,C1. F0.2\nX40. Z-20. ,R2.\nX45.\nM30\n%"
        self.assertWritten(self.scripts.run("mirror", lathe, self.context("fanuc-lathe-a", "no machine"), {"about": "z"}))
        mill = "G21 G17 G90\nG0 X0. Y0. Z5.\nG1 X20. Y0. ,R2. F100.\nG1 X20. Y20. ,C1.\nG1 X0. Y20.\nM30"
        self.assertWritten(self.scripts.run("rotate", mill, self.context("fanuc-mill", "no machine"), {"angle": 90}))
        # Wave Y (FZ-8): described on G1, G2 and G3 (FANUC 0i-D milling manual p.86-89, 0i-F lathe
        # manual p.150-154), they keep their value; on an arc they are no radius of it.
        arc = "G21 G17 G90\nG0 X0. Y0. Z5.\nG1 X20. Y0. F100.\nG2 X0. Y20. I-10. J10. ,R3.\nG1 X0. Y0.\nM30"
        out = self.scripts.run("mirror", arc, self.context("fanuc-mill", "no machine"), {"about": "y-axis"})
        self.assertWritten(out)
        self.assertIn("G3 X0. Y20. I10. J10. ,R3.", out.text.split("\n"))
        # The angle of a drawing dimension (`,A`) is still a word nobody describes.
        angle = lathe.replace("X40. Z-20. ,R2.", "X40. ,A30.")
        refused = self.scripts.run("mirror", angle, self.context("fanuc-lathe-a", "no machine"), {"about": "z"})
        self.assertTrue(refused.refused)

    def test_fz9_a_length_offset_number_without_its_code(self) -> None:
        """FZ-9: ``H1`` without ``G43`` is the length offset number (the address only the
        length compensation group declares, plan §7 #304, as ``D2`` is), but #320 excludes the
        whole group because ``G43`` also takes ``Z``, so rotate and mirror refuse the block
        (``word-unknown``)."""
        text = "G21 G17 G90\nG0 X1. Y1. Z5.\nZ37.7 H1\nG1 X5. Y2. F100.\nM30"
        context = self.context("fanuc-mill", "no machine")
        self.assertWritten(self.scripts.run("rotate", text, context, {"angle": 90}))
        self.assertWritten(self.scripts.run("mirror", text, context, {"about": "y-axis"}))


class OracleReadingFz10Test(unittest.TestCase):
    """FZ-10, the Sinumerik twin of FZ-3: an oracle reading, the program written is correct.

    v1.2.0 manual-check fix round (D6-7): with the shipped profile, whose control travels the
    change of a shift with the next increment (SD42440 at 1), the rotation refuses the increment
    after ``ATRANS`` instead; the reading is held on a machine where SD42440 is 0
    (``syntax.incrementTravelsShift`` off), where the increment is only the increment."""

    TEXT = (
        "%_N_FZ10_MPF\nN10 G71 G90 G54 G17\nG0 X-5 Y5 Z10\nG1 X10 Y10 F500\n"
        "N20 ATRANS X0 Y0\nG91 G1 X-33.098 F1666.8\nG90 G1 X-4.52 Y0.162\nM30"
    )
    PARAMS = {"cx": 19.31, "cy": -2.63, "angle": 90}

    @classmethod
    def setUpClass(cls) -> None:
        cls.scripts = Scripts.get()
        profile_set = [p for p in PROFILE_SETS if p.name == "sinumerik-mill"][0]
        cls.shipped = context_of(profile_set, profile_set.contexts[0][0])
        cls.context = copy.deepcopy(cls.shipped)
        cls.context["profile"]["syntax"]["incrementTravelsShift"] = False
        cls.out = cls.scripts.run("rotate", cls.TEXT, cls.context, cls.PARAMS)
        cls.plan = oracle.plan_rotate(90, cls.PARAMS["cx"], cls.PARAMS["cy"])
        cls.before = cls.scripts.run("extents", cls.TEXT, cls.context).payload
        cls.after = cls.scripts.run("extents", cls.out.text, cls.context).payload

    def raw(self) -> List[str]:
        return oracle.check_extents(self.before, self.after, self.plan)

    def accepted(self, problem: str, after_text: Optional[str] = None, before_text: Optional[str] = None) -> bool:
        return added_zero_word(problem, self.TEXT if before_text is None else before_text, self.out.text if after_text is None else after_text, self.before, self.after, self.plan)

    def test_d6_7_with_the_shipped_profile_the_increment_after_the_frame_is_refused(self) -> None:
        self.assertTrue(self.shipped["profile"]["syntax"].get("incrementTravelsShift"))
        out = self.scripts.run("rotate", self.TEXT, self.shipped, self.PARAMS)
        self.assertEqual(out.crash, "")
        self.assertTrue(out.refused)
        self.assertIn((6, "shift-increment"), [(f["line"], f["reason"]) for f in out.payload.get("findings", []) if f.get("severity") == "error"])
        # Written absolutely after the frame, the increment is turned, and the extents see no
        # position they cannot resolve: the reading is not needed there.
        text = self.TEXT.replace("N20 ATRANS X0 Y0\n", "N20 ATRANS X0 Y0\nG90 G1 X10 Y10\n")
        out = self.scripts.run("rotate", text, self.shipped, self.PARAMS)
        self.assertFalse(out.refused)
        after = self.scripts.run("extents", out.text, self.shipped).payload
        before = self.scripts.run("extents", text, self.shipped).payload
        self.assertEqual(oracle.check_extents(before, after, self.plan), [])

    def test_the_rotation_writes_a_zero_increment_word_and_the_path_is_the_same(self) -> None:
        """The program is correct: the block after the frame gets ``X0.000``, a word that moves
        nothing, and the path oracle (end points and arcs of every block) finds the original's
        path turned."""
        self.assertEqual(self.out.crash, "")
        self.assertFalse(self.out.refused)
        self.assertIn("G91 G1 X0.000 Y-33.098", self.out.text)
        checker = Checker(self.scripts, self.TEXT, self.context, False, "fz10")
        checker.path("rotate", dict(cx=self.PARAMS["cx"], cy=self.PARAMS["cy"], angle=90), self.out.text, "rotate by 90", self.PARAMS, self.before)
        self.assertEqual([v.short() for v in checker.violations], [])

    def test_the_extents_see_one_more_unresolved_position_and_the_oracle_accepts_it(self) -> None:
        problems = self.raw()
        self.assertTrue(problems, "the plain oracle no longer sees the added word: the reading is not needed")
        for problem in problems:
            self.assertRegex(problem, r"0 positions not resolved in the original, 1 in the result$")
            self.assertTrue(self.accepted(problem), problem)
        # the Checker the fuzz uses reaches the same verdict
        checker = Checker(self.scripts, self.TEXT, self.context, False, "fz10")
        checker.oracle(self.plan, self.out.text, "rotate by 90, 1 times", self.PARAMS, "rotate", dict(cx=self.PARAMS["cx"], cy=self.PARAMS["cy"], angle=90))
        self.assertEqual([v.short() for v in checker.violations], [])

    def test_a_nonzero_difference_is_still_flagged(self) -> None:
        problems = self.raw()
        self.assertTrue(problems)
        problem = problems[0]
        # the added word moves the axis: not a zero word
        self.assertFalse(self.accepted(problem, self.out.text.replace("X0.000", "X5.000")))
        # a range that moved wrong (the row of the report is not the original's, moved)
        wrong = copy.deepcopy(self.after)
        for row in wrong["rows"]:
            if row.get("scope") == "offset" and "ATRANS" in str(row.get("where")) and row.get("axisId") == "X":
                row["min"] = row["max"] = "99"
        self.assertFalse(added_zero_word(problem, self.TEXT, self.out.text, self.before, wrong, self.plan))
        # no frame above: a zero increment that is not after a frame is not this reading
        self.assertFalse(self.accepted(problem, before_text=self.TEXT.replace("ATRANS X0 Y0", "G0 X0 Y0")))
        # a zero word that the original had (nothing added) and a program of another length
        self.assertFalse(self.accepted(problem, after_text=self.out.text + "\nM30"))
        self.assertFalse(self.accepted(problem, after_text=self.out.text.replace("X0.000 ", "")))
        # other differences are not read: a count the other way, a moved minimum
        self.assertFalse(self.accepted("offset G54 + ATRANS (line 5), X: 1 positions not resolved in the original, 0 in the result"))
        self.assertFalse(self.accepted("offset G54 + ATRANS (line 5), X: minimum 3, expected 4"))


if __name__ == "__main__":
    unittest.main()
