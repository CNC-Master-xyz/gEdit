"""The expansion of the drilling cycles (Phase 4 plan §5 P4b, P4.7; §6.3; exit criterion X23).

Four kinds of check:

1. **the goldens** of ``tests/fixtures/scripts/expand_cycles/<case>/`` (the format of the
   geometry goldens, ``tests/fixtures/scripts/README.md``): a run that writes gives
   ``expected.nc`` byte for byte and the envelope's message and findings; a refused run hands the
   input back byte for byte and lists one error per refused block (Q4-1). Fanuc mill ``G81``,
   ``G82``, ``G83``, ``G73``, ``G85``, ``G86``, ``G89`` under ``G98``/``G99``, ``G90``/``G91`` and
   with a repeat count; Klartext 200 and 203 with ``M99``, ``M89``, ``CYCL CALL`` and
   ``CYCL CALL POS``; Sinumerik ``CYCLE81``-``CYCLE83``, ``CYCLE86`` with and without ``MCALL``;
   every refusal of ``_nc_cycles.REASONS`` that a program can show and the run's own; selections.
2. **the path oracle** (§6.1 tracker): the written program, walked by ``_nc_path.PathTracker``,
   reaches every hole ``_nc_cycles.holes_of`` reads from the input (its position at its depth),
   in order, and ends where the input ends on every axis the input's walk knows.
3. **the extents oracle** (X23): ``extents.py`` gives the written program the ranges it gives the
   input, on every row and axis. Since P4.7b the input's report reads the depth of every cycle
   as the expansion writes it (``surface + Q201``, ``RFP - DPR``, the Fanuc ``G91`` depth from
   the R point and the repeat count; T108, plan §6.3 rule 12), so no row of a written case is
   left "not resolved".
4. **the readers** ``levels_of``, ``peck_bottoms`` and ``holes_of`` by themselves, the return
   mode from the machine's power-on modes, the form's peck values.

**The schemas** are the shipped ones (``src/lib/data/codes/*.json``, P4.6), read from the
resolved databases ``tests/unit/resolved.test.ts`` writes: the Wave A integration dropped the
test schemas P4.7 ran with until then, and every golden reads the real data.

Run: ``taskpolicy -b python3 -B -S -m unittest tests.python.test_expand_cycles`` (also with
``/usr/bin/python3``, the oldest Python gEdit supports).
"""

from __future__ import annotations

import copy
import re
import unittest
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from tests.python import helpers

helpers.import_gedit_nc()
import gedit_nc  # noqa: E402
import _nc_cycles  # noqa: E402
import _nc_path  # noqa: E402

SCRIPT = "expand_cycles.py"
CASES_DIR = helpers.SCRIPT_FIXTURES_DIR / "expand_cycles"

#: ``extents.py`` writes its numbers to 0.0001.
UNIT = Decimal("0.0001")


def cases() -> List[helpers.GeometryCase]:
    return helpers.geometry_cases("expand_cycles")


def case_context(case: helpers.GeometryCase) -> Dict[str, Any]:
    return helpers.geometry_context(case)


def plain_context(profile_id: str, text: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """A whole-document context of a built-in profile, no machine."""
    context = helpers.effective_context(profile_id)
    context["params"] = dict(params or {})
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    return context


def run(text: str, context: Dict[str, Any], interpreter: Optional[str] = None) -> Dict[str, Any]:
    out = helpers.run_script(SCRIPT, stdin=text, context=context, interpreter=interpreter)
    if not out.ok:
        raise AssertionError("%s failed (exit %d): %s" % (SCRIPT, out.returncode, out.stderr[-2000:]))
    return out.json()


def refused(result: Dict[str, Any]) -> bool:
    return any(f.get("severity") == "error" for f in result.get("findings") or [])


# ---------------------------------------------------------------------------
# The path oracle
# ---------------------------------------------------------------------------


class Walk:
    """A program walked by the tracker, with ``holes_of`` asked on every line."""

    def __init__(self, text: str, context: Dict[str, Any], pecks: _nc_cycles.PeckValues) -> None:
        cp = gedit_nc.compile_profile(context["profile"])
        self.tracker = _nc_path.PathTracker(context, cp, reach=False)
        self.steps: List[Any] = []
        self.holes: List[_nc_cycles.Hole] = []
        self.refusals: List[_nc_cycles.CycleRefusal] = []
        state = None
        for number, line in enumerate(text.split("\n"), 1):
            state, step = self.tracker.line(line, number, state, True)
            holes, refusals = _nc_cycles.holes_of(step, self.tracker, pecks, context)
            self.steps.append(step)
            self.holes.extend(holes)
            self.refusals.extend(refusals)

    def points(self) -> List[Dict[str, Optional[Decimal]]]:
        """Where the tool stands after every line (the tracker's positions)."""
        return [dict(step.after) for step in self.steps]

    def end(self) -> Dict[str, Optional[Decimal]]:
        return dict(self.steps[-1].after) if self.steps else {}


def path_problems(input_text: str, written_text: str, context: Dict[str, Any], pecks: _nc_cycles.PeckValues) -> List[str]:
    """What the written program does differently from the holes of the input (the path oracle)."""
    source = Walk(input_text, context, pecks)
    problems: List[str] = ["input: %s" % (r,) for r in source.refusals]
    # The written program has no cycle left: walked plainly, every hole bottom is a point it
    # reaches, in the order of the holes.
    target = Walk(written_text, context, pecks)
    if target.holes or target.refusals:
        problems.append("the written program still runs a cycle")
    points = target.points()
    at = 0
    for hole in source.holes:
        depth = hole.levels.get("depth")
        wanted = {"X": hole.position.get("X"), "Y": hole.position.get("Y"), "Z": depth}
        found = False
        while at < len(points):
            point = points[at]
            at += 1
            if all(point.get(axis) is not None and point.get(axis) == value for axis, value in wanted.items()):
                found = True
                break
        if not found:
            problems.append("hole of line %d at %s is not reached in order" % (hole.line, wanted))
            break
    before, after = source.end(), target.end()
    for axis, value in before.items():
        if value is not None and after.get(axis) != value:
            problems.append("ends at %s%s, the input at %s%s" % (axis, after.get(axis), axis, value))
    return problems


# ---------------------------------------------------------------------------
# The extents oracle (X23)
# ---------------------------------------------------------------------------


def extents_of(text: str, context: Dict[str, Any]) -> Dict[str, Any]:
    changed = copy.deepcopy(context)
    changed["params"] = {}
    changed["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    out = helpers.run_script("extents.py", stdin=text, context=changed)
    if not out.ok:
        raise AssertionError("extents.py failed: %s" % out.stderr[-1500:])
    return out.json()


def rows_of(report: Dict[str, Any]) -> Dict[Tuple[str, str, str], Dict[str, Any]]:
    out: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    for row in report.get("rows", []):
        if row.get("scope") in ("program", "offset", "tool"):
            out[(str(row.get("scope")), str(row.get("where")), str(row.get("axisId")))] = row
    return out


def extents_problems(before: Dict[str, Any], after: Dict[str, Any]) -> Tuple[List[str], int]:
    """The ranges of the written program against the input's, on every row the input resolves;
    and how many rows the input leaves not resolved (none since P4.7b, T108)."""
    problems: List[str] = []
    skipped = 0
    old, new = rows_of(before), rows_of(after)
    for key, row in sorted(old.items()):
        if int(row.get("unresolved", 0) or 0) > 0:
            skipped += 1
            continue
        other = new.get(key)
        if other is None:
            problems.append("%s: no row in the written program's report" % (key,))
            continue
        for end in ("min", "max"):
            a, b = row.get(end), other.get(end)
            if (a is None) != (b is None) or (a is not None and abs(Decimal(a) - Decimal(b)) > UNIT):
                problems.append("%s %s: %s, the input %s" % (key, end, b, a))
    return problems, skipped


# ---------------------------------------------------------------------------
# The goldens
# ---------------------------------------------------------------------------


class GoldenTest(unittest.TestCase):
    """Every case of ``tests/fixtures/scripts/expand_cycles/``."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.cases = cases()
        cls.results: Dict[str, Dict[str, Any]] = {}

    def result(self, case: helpers.GeometryCase) -> Dict[str, Any]:
        found = self.results.get(case.name)
        if found is None:
            found = run(case.input_text(), case_context(case))
            self.results[case.name] = found
        return found

    def test_there_are_cases_of_every_dialect(self) -> None:
        names = [c.name for c in self.cases]
        for prefix in ("fanuc-", "klartext-", "sinumerik-", "lathe-"):
            self.assertTrue(any(n.startswith(prefix) for n in names), prefix)

    def test_the_goldens(self) -> None:
        for case in self.cases:
            with self.subTest(case=case.name):
                result = self.result(case)
                envelope = case.envelope()
                self.assertEqual(result["text"], case.expected_text())
                self.assertEqual(result["message"], envelope["message"])
                self.assertEqual(result["findings"], envelope["findings"])
                self.assertEqual(refused(result), case.refused)

    def test_a_refused_run_hands_the_input_back(self) -> None:
        for case in self.cases:
            if case.refused:
                with self.subTest(case=case.name):
                    self.assertEqual(self.result(case)["text"], case.input_text())
                    for finding in case.envelope()["findings"]:
                        if finding["severity"] == "error":
                            self.assertIn(finding["reason"], list(_nc_cycles.REASONS) + ["no-database", "selection-unprimed"])

    def test_every_refusal_a_program_can_show_has_a_golden(self) -> None:
        shown = set()
        for case in self.cases:
            if case.refused:
                shown.update(f["reason"] for f in case.envelope()["findings"] if f["severity"] == "error")
        # `no-code` and `resolution` need a database or a number no built-in profile has; their
        # cases are the unit tests below (WriterRefusalTest).
        wanted = set(_nc_cycles.REASONS) - {"no-code", "resolution"}
        self.assertEqual(sorted(wanted - shown), [])

    def test_the_path_oracle(self) -> None:
        for case in self.cases:
            if case.refused or case.preceding_file is not None:
                continue
            with self.subTest(case=case.name):
                context = case_context(case)
                params = case.params
                pecks = _nc_cycles.PeckValues(
                    retract=Decimal(str(params["peckRetract"])) if params.get("peckRetract") not in (None, "") else None,
                    clearance=Decimal(str(params["peckClearance"])) if params.get("peckClearance") not in (None, "") else None,
                )
                self.assertEqual(path_problems(case.input_text(), case.expected_text(), context, pecks), [])

    def test_the_extents_equality(self) -> None:
        """X23: the extents of the written program equal the cycle's, on every row; the input's
        report resolves every row (T108, P4.7b)."""
        compared = 0
        for case in self.cases:
            if case.refused or case.preceding_file is not None:
                continue
            with self.subTest(case=case.name):
                context = case_context(case)
                before = extents_of(case.input_text(), context)
                after = extents_of(case.expected_text(), context)
                problems, skipped = extents_problems(before, after)
                self.assertEqual(problems, [])
                self.assertEqual(skipped, 0, "rows the input's report leaves not resolved")
                compared += 1
        self.assertGreaterEqual(compared, 8)


# ---------------------------------------------------------------------------
# The readers by themselves
# ---------------------------------------------------------------------------

D = Decimal


class LevelsTest(unittest.TestCase):
    FANUC = {"kind": "drill", "steps": [], "returnBy": "code", "leaves": {"motion": "before", "feed": "cycle"}}
    KLARTEXT = {"kind": "peck", "steps": [], "returnBy": "role", "relativeDepth": "signed", "leaves": {"motion": "cycle", "feed": "before"}}
    SINUMERIK = dict(KLARTEXT, relativeDepth="into-material")

    def test_absolute_and_incremental_r_point_and_depth(self) -> None:
        values = {"r-plane": D("2"), "depth": D("-5")}
        self.assertEqual(_nc_cycles.levels_of(self.FANUC, values, D("50"), False, "initial"), {"start": D("50"), "r-plane": D("2"), "depth": D("-5"), "return": D("50")})
        values = {"r-plane": D("-48"), "depth": D("-7")}
        self.assertEqual(_nc_cycles.levels_of(self.FANUC, values, D("50"), True, "r-plane"), {"start": D("50"), "r-plane": D("2"), "depth": D("-5"), "return": D("2")})

    def test_a_return_mode_not_known_refuses(self) -> None:
        with self.assertRaises(_nc_cycles.CycleError) as caught:
            _nc_cycles.levels_of(self.FANUC, {"r-plane": D("2"), "depth": D("-5")}, D("50"), False, None)
        self.assertEqual(caught.exception.reason, "return-assumed")

    def test_relative_depths_by_the_schema(self) -> None:
        values = {"surface": D("0"), "clearance": D("2"), "depth-relative": D("-12"), "return-relative": D("50")}
        self.assertEqual(_nc_cycles.levels_of(self.KLARTEXT, values, D("100"), False, None), {"start": D("100"), "clearance": D("2"), "depth": D("-12"), "return": D("50")})
        values = {"surface": D("0"), "clearance": D("2"), "depth-relative": D("8"), "return": D("10")}
        self.assertEqual(_nc_cycles.levels_of(self.SINUMERIK, values, D("30"), False, None)["depth"], D("-8"))
        with self.assertRaises(_nc_cycles.CycleError) as caught:
            _nc_cycles.levels_of(self.SINUMERIK, dict(values, **{"depth-relative": D("-8")}), D("30"), False, None)
        self.assertEqual(caught.exception.reason, "depth-direction")

    def test_a_relative_depth_wins_unless_it_is_zero(self) -> None:
        values = {"surface": D("0"), "depth": D("-5"), "depth-relative": D("8")}
        self.assertEqual(_nc_cycles.levels_of(self.SINUMERIK, values, D("30"), False, None)["depth"], D("-8"))
        values["depth-relative"] = D("0")
        self.assertEqual(_nc_cycles.levels_of(self.SINUMERIK, values, D("30"), False, None)["depth"], D("-5"))

    def test_a_level_without_its_values_is_left_out(self) -> None:
        levels = _nc_cycles.levels_of(self.KLARTEXT, {"surface": D("0")}, D("10"), False, None)
        self.assertEqual(levels, {"start": D("10")})


class PeckTest(unittest.TestCase):
    STEP = {"step": "pecks", "mode": "full-retract"}

    def test_a_constant_peck_ends_at_the_depth(self) -> None:
        self.assertEqual(_nc_cycles.peck_bottoms(D("2"), D("-20"), {"peck": D("6")}, self.STEP), [D("-4"), D("-10"), D("-16"), D("-20")])
        self.assertEqual(_nc_cycles.peck_bottoms(D("2"), D("-4"), {"peck": D("6")}, self.STEP), [D("-4")])
        self.assertEqual(_nc_cycles.peck_bottoms(D("2"), D("-3"), {"peck": D("6")}, self.STEP), [D("-3")])

    def test_the_decrement_and_the_minimum(self) -> None:
        # TNC 640 cycle manual, cycle 203: 5, then 4, then 3, then 3 (Q202=5, Q212=1, Q205=3).
        values = {"peck": D("5"), "peck-decrement": D("1"), "peck-minimum": D("3")}
        self.assertEqual(_nc_cycles.peck_bottoms(D("0"), D("-20"), values, self.STEP), [D("-5"), D("-9"), D("-12"), D("-15"), D("-18"), D("-20")])
        # Without a minimum a peck is not shorter than the decrement.
        values = {"peck": D("5"), "peck-decrement": D("2")}
        self.assertEqual(_nc_cycles.peck_bottoms(D("0"), D("-16"), values, self.STEP), [D("-5"), D("-8"), D("-10"), D("-12"), D("-14"), D("-16")])

    def test_the_first_peck_by_its_level(self) -> None:
        values = {"first-peck": D("-5"), "peck-decrement": D("0")}
        self.assertEqual(_nc_cycles.peck_bottoms(D("2"), D("-15"), values, self.STEP), [D("-5"), D("-12"), D("-15")])

    def test_a_peck_of_zero_refuses(self) -> None:
        for values in ({"peck": D("0")}, {"peck": D("-1")}, {}, {"first-peck": D("5")}, {"peck": D("1"), "peck-decrement": D("-1")}):
            with self.subTest(values=values):
                with self.assertRaises(_nc_cycles.CycleError) as caught:
                    _nc_cycles.peck_bottoms(D("2"), D("-10"), values, self.STEP)
                self.assertEqual(caught.exception.reason, "value-missing")

    def test_too_many_pecks_refuse(self) -> None:
        with self.assertRaises(_nc_cycles.CycleError):
            _nc_cycles.peck_bottoms(D("0"), D("-100"), {"peck": D("0.001")}, self.STEP)


FANUC_DRILL = "\n".join(
    [
        "O1 (WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)",
        "G21 G17 G40 G80 G90 G94",
        "G0 X0. Y0. S1000 M3",
        "G43 H1 Z20.",
        "G81 X10. Y10. Z-5. R2. F150.",
        "G80",
        "G0 Z100.",
        "M30",
    ]
)


def walk_holes(text: str, context: Dict[str, Any], pecks: Optional[_nc_cycles.PeckValues] = None) -> Walk:
    return Walk(text, context, pecks or _nc_cycles.PeckValues())


KLARTEXT_REAM = "\n".join(
    [
        "0 BEGIN PGM FZ MM",
        "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
        "2 TOOL CALL 3 Z S800",
        "3 L Z+100 R0 FMAX M3",
        "4 CYCL DEF 201 REAMING ~",
        "  Q200=2 ;SET-UP CLEARANCE ~",
        "  Q201=-15 ;DEPTH ~",
        "  Q206=100 ;FEED RATE FOR PLNGNG ~",
        "  Q211=0 ;DWELL TIME AT DEPTH ~",
        "  Q208=0 ;RETRACTION FEED RATE ~",
        "  Q203=+0 ;SURFACE COORDINATE ~",
        "  Q204=50 ;2ND SET-UP CLEARANCE",
        "5 L X+30 Y+20 R0 FMAX M99",
        "6 L Z+100 R0 FMAX M30",
        "7 END PGM FZ MM",
    ]
)


class FeedOutZeroTest(unittest.TestCase):
    """The owner, 2026-10-20: Klartext 201 ``Q208=0`` retracts at the plunging feed ``Q206``
    (TNC 640 cycles manual 10/2017 §3.4), said by the schema's ``feedOutZero``; every other feed
    of 0 or less still refuses (plan §6.3 rule 3)."""

    def walk(self, text: str, profile: str = "heidenhain-klartext") -> Walk:
        return walk_holes(text, plain_context(profile, text))

    def test_q208_zero_retracts_at_the_plunging_feed(self) -> None:
        for written in ("Q208=0", "Q208=+0.0", "Q208=-0"):
            with self.subTest(written=written):
                walk = self.walk(KLARTEXT_REAM.replace("Q208=0", written))
                self.assertEqual(walk.refusals, [])
                (hole,) = walk.holes
                feeds = [(m.to.get("Z"), m.feed, m.feed_role) for m in hole.moves if m.kind == "feed"]
                self.assertEqual(feeds, [(D("-15"), "F100", "feed"), (D("2"), "F100", "feed-out")])

    def test_a_retract_feed_below_zero_still_refuses(self) -> None:
        walk = self.walk(KLARTEXT_REAM.replace("Q208=0", "Q208=-5"))
        self.assertEqual([(r.reason, r.detail) for r in walk.refusals], [("value-missing", "Q208=-5, a feed of 0 or less")])

    def test_a_plunging_feed_of_zero_still_refuses(self) -> None:
        walk = self.walk(KLARTEXT_REAM.replace("Q206=100", "Q206=0"))
        self.assertEqual([(r.reason, r.detail) for r in walk.refusals], [("value-missing", "Q206=0, a feed of 0 or less")])

    def test_a_retract_feed_of_zero_refuses_where_the_manual_gives_it_no_meaning(self) -> None:
        # CYCLE85's RFF has no feedOutZero in the data: 0 is no feed there.
        text = "\n".join(
            [
                "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
                "N10 G17 G90 G71 G54",
                "N20 S800 M3",
                "N30 G0 X20 Y20 Z50",
                "N40 CYCLE85(10,0,2,,12,0.2,100,0,0,1,0)",
                "N50 M30",
            ]
        )
        walk = self.walk(text, "sinumerik-mill")
        self.assertEqual([r.reason for r in walk.refusals], ["value-missing"])
        self.assertIn("a feed of 0 or less", walk.refusals[0].detail)
        self.assertEqual(len(self.walk(text.replace(",100,0,", ",100,250,"), "sinumerik-mill").holes), 1)


class HolesTest(unittest.TestCase):
    """``holes_of`` on a walk, outside the script."""

    def test_a_block_without_a_cycle_has_no_holes(self) -> None:
        context = plain_context("fanuc-gcode", FANUC_DRILL)
        walk = walk_holes(FANUC_DRILL.replace("G81 X10. Y10. Z-5. R2. F150.", "G1 X10. F100."), context)
        self.assertEqual((walk.holes, walk.refusals), ([], []))

    def test_the_return_mode_from_the_machines_power_on_modes(self) -> None:
        # The owner's answer of 2026-10-19: no G98/G99 in the program and none in the machine's
        # power-on modes refuses; the machine's power-on G99 is a return mode.
        context = plain_context("fanuc-gcode", FANUC_DRILL)
        walk = walk_holes(FANUC_DRILL, context)
        self.assertEqual([r.reason for r in walk.refusals], ["return-assumed"])
        for source, wanted in (("machine", ["Z2."]), ("profile", None)):
            with self.subTest(source=source):
                context = plain_context("fanuc-gcode", FANUC_DRILL)
                modal = context["profile"].setdefault("modal", {})
                modal.setdefault("initial", {})["cyclereturn"] = "G99"
                modal["sources"] = {"cyclereturn": source}
                walk = walk_holes(FANUC_DRILL, context)
                if wanted is None:
                    self.assertEqual([r.reason for r in walk.refusals], ["return-assumed"])
                    continue
                self.assertEqual(walk.refusals, [])
                (hole,) = walk.holes
                self.assertEqual(hole.levels["return"], D("2"))
                self.assertEqual(hole.end["Z"], D("2"))

    def test_the_moves_of_one_hole(self) -> None:
        text = FANUC_DRILL.replace("G81", "G98 G81")
        walk = walk_holes(text, plain_context("fanuc-gcode", text))
        (hole,) = walk.holes
        self.assertEqual(hole.code, "G81")
        self.assertEqual(hole.kind, "drill")
        self.assertEqual(hole.position, {"X": D("10"), "Y": D("10")})
        self.assertEqual(hole.start, D("20"))
        self.assertEqual([(m.kind, m.to, m.feed) for m in hole.moves], [
            ("rapid", {"X": D("10"), "Y": D("10")}, None),
            ("rapid", {"Z": D("2")}, None),
            ("feed", {"Z": D("-5")}, "F150."),
            ("rapid", {"Z": D("20")}, None),
        ])
        self.assertEqual(hole.end, {"X": D("10"), "Y": D("10"), "Z": D("20")})

    def test_the_peck_values_come_from_the_form(self) -> None:
        # Q4-9: a G73/G83 program without the form's value does not run; with the value the
        # machine's motion block prefills (P4.8's `prefill`) it does.
        text = FANUC_DRILL.replace("G81 X10. Y10. Z-5. R2. F150.", "G98 G83 X10. Y10. Z-20. R2. Q6. F150.")
        context = plain_context("fanuc-gcode", text)
        context["machine"] = dict(context["machine"], motion={"units": "mm", "peckRetract": 0.5, "peckClearance": 1})
        walk = walk_holes(text, context)
        self.assertEqual([r.reason for r in walk.refusals], ["peck-clearance-missing"])
        motion = _nc_cycles.machine_motion(context) or {}
        prefilled = _nc_cycles.PeckValues(retract=D(str(motion["peckRetract"])), clearance=D(str(motion["peckClearance"])))
        walk = walk_holes(text, context, prefilled)
        self.assertEqual(walk.refusals, [])
        self.assertEqual([m.to.get("Z") for m in walk.holes[0].moves if m.kind == "rapid"][1:4], [D("2"), D("2"), D("-3")])
        result = run(text, dict(context, params={"peckRetract": motion["peckRetract"], "peckClearance": motion["peckClearance"]}))
        self.assertFalse(refused(result))
        result = run(text, dict(context, params={}))
        self.assertEqual([f["reason"] for f in result["findings"]], ["peck-clearance-missing"])

    def test_asking_twice_gives_the_same_answer(self) -> None:
        text = FANUC_DRILL.replace("G81", "G98 G81")
        context = plain_context("fanuc-gcode", text)
        cp = gedit_nc.compile_profile(context["profile"])
        tracker = _nc_path.PathTracker(context, cp, reach=False)
        state = None
        for number, line in enumerate(text.split("\n"), 1):
            state, step = tracker.line(line, number, state, True)
            first = _nc_cycles.holes_of(step, tracker, _nc_cycles.PeckValues(), context)
            self.assertIs(_nc_cycles.holes_of(step, tracker, _nc_cycles.PeckValues(), context), first)

    def test_the_word_the_writer_copies_from(self) -> None:
        text = FANUC_DRILL.replace("G81", "G98 G81")
        context = plain_context("fanuc-gcode", text)
        cp = gedit_nc.compile_profile(context["profile"])
        tracker = _nc_path.PathTracker(context, cp, reach=False)
        state = None
        found = None
        for number, line in enumerate(text.split("\n"), 1):
            state, step = tracker.line(line, number, state, True)
            holes, _ = _nc_cycles.holes_of(step, tracker, _nc_cycles.PeckValues(), context)
            if holes:
                found = _nc_cycles.last_read(tracker)
        assert found is not None
        self.assertEqual(found.form, "word")
        self.assertEqual({r: t.text for r, t in found.words.items()}, {"depth": "Z-5.", "r-plane": "R2.", "feed": "F150."})
        self.assertEqual(found.level_token.text, "Z20.")
        self.assertFalse(found.keep_block)


class RunTest(unittest.TestCase):
    """What a run says beside the goldens."""

    def test_no_database(self) -> None:
        context = plain_context("fanuc-gcode", FANUC_DRILL)
        context["codes"] = []
        result = run(FANUC_DRILL, context)
        self.assertEqual(result["text"], FANUC_DRILL)
        self.assertEqual([f["reason"] for f in result["findings"]], ["no-database"])

    def test_a_bad_form_value_stops_the_run(self) -> None:
        context = plain_context("fanuc-gcode", FANUC_DRILL, {"peckRetract": -1})
        out = helpers.run_script(SCRIPT, stdin=FANUC_DRILL, context=context)
        self.assertEqual(out.returncode, 1)
        self.assertIn("High-speed peck retract (G73)", out.stderr)

    def test_without_a_cycle_nothing_changes(self) -> None:
        text = FANUC_DRILL.replace("G81 X10. Y10. Z-5. R2. F150.", "G1 X10. F100.")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertEqual(result["text"], text)
        self.assertTrue(result["message"].startswith("No drilling cycle to expand: nothing was changed."))
        self.assertEqual(result["findings"], [])


class WriterRefusalTest(unittest.TestCase):
    """The two refusals of the writer that no built-in database shows on a plain program."""

    def test_no_code_for_a_dwell(self) -> None:
        text = FANUC_DRILL.replace("G81 X10. Y10. Z-5. R2. F150.", "G98 G82 X10. Y10. Z-5. R2. P500 F150.")
        context = plain_context("fanuc-gcode", text)
        for entry in context["codes"]:
            entry.pop("dwell", None)
        result = run(text, context)
        self.assertEqual([f["reason"] for f in result["findings"]], ["no-code"])
        self.assertEqual(result["text"], text)

    def test_a_value_that_does_not_fit_its_word(self) -> None:
        # IS-B reads a point-less word in 0.001 mm; a computed peck level of 0.0005 mm more does
        # not fit, and nothing is rounded.
        text = FANUC_DRILL.replace("G81 X10. Y10. Z-5. R2. F150.", "G98 G83 X10. Y10. Z-5000 R2000 Q2500 F150.")
        context = helpers.effective_context("fanuc-gcode", preset="is-b")
        context["params"] = {"peckRetract": 0.5, "peckClearance": "0.0005"}
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
        result = run(text, context)
        self.assertEqual([f["reason"] for f in result["findings"]], ["resolution"])



# ---------------------------------------------------------------------------
# v1.2.0 fix batch 1 (the P4b review): each test fails without its fix
# ---------------------------------------------------------------------------

FANUC_HEAD = [
    "O1 (WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)",
    "G21 G17 G40 G80 G90 G94 G98",
    "G1 X0. Y0. F500 S1000 M3",
    "G43 H1 Z20.",
]
SINUMERIK_HEAD = [
    "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
    "N10 G17 G90 G71 G54",
    "N20 S3000 M3",
    "N30 G0 X0 Y0 Z30 F150",
]


def program(*lines: str) -> str:
    return "\n".join(lines)


def reasons(result: Dict[str, Any]) -> List[Tuple[int, str]]:
    return [(f["line"], f["reason"]) for f in result.get("findings") or [] if f.get("severity") == "error"]


def klartext_drill(*calls: str) -> str:
    return program(
        "0 BEGIN PGM FB MM",
        "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
        "2 TOOL CALL 3 Z S800",
        "3 L Z+100 R0 FMAX M3",
        "4 CYCL DEF 200 DRILLING ~",
        "  Q200=2 ;SET-UP CLEARANCE ~",
        "  Q201=-15 ;DEPTH ~",
        "  Q206=150 ;FEED RATE FOR PLNGNG ~",
        "  Q202=5 ;PLUNGING DEPTH ~",
        "  Q210=0 ;DWELL TIME AT TOP ~",
        "  Q203=+0 ;SURFACE COORDINATE ~",
        "  Q204=50 ;2ND SET-UP CLEARANCE ~",
        "  Q211=0 ;DWELL TIME AT DEPTH ~",
        "  Q395=0 ;DEPTH REFERENCE",
        *calls,
    )


class CallUnderCycleTest(unittest.TestCase):
    """NC-1: a subprogram call, a jump, a loop or a pattern cycle while a modal cycle is in force
    refuses (``call-form``); the detector is ``_nc_cycles.call_of``, shared with the estimate.
    The goldens ``fanuc-calls-under-cycle``, ``sinumerik-mcall-refusals`` and
    ``klartext-jump-and-skip`` show the three dialects."""

    def steps(self, text: str, context: Dict[str, Any]) -> List[Any]:
        return walk_holes(text, context).steps

    def test_call_of_reads_the_data_and_leaves_cycle_entries_out(self) -> None:
        text = program(*FANUC_HEAD, "M98 P2000", "G65 P9010 A1.", "GOTO 10", "X10.", "M99")
        context = plain_context("fanuc-gcode", text)
        walk = walk_holes(text, context)
        found = [_nc_cycles.call_of(step, walk.tracker.interp) for step in walk.steps[4:]]
        self.assertEqual(found, ["M98", "G65", "GOTO", None, None])
        text = program(*SINUMERIK_HEAD, "N40 HOLES1(20,20,0,0,10,4)", "N50 CYCLE81(10,0,2,-5)")
        walk = walk_holes(text, plain_context("sinumerik-mill", text))
        self.assertEqual([_nc_cycles.call_of(step, walk.tracker.interp) for step in walk.steps[4:]], ["HOLES1", None])
        # A cycle entry is no call, whatever flag it carries.
        text = klartext_drill("5 L X+10 Y+10 R0 FMAX M99", "6 CYCL CALL")
        context = plain_context("heidenhain-klartext", text)
        for entry in context["codes"]:
            if entry.get("code") in ("M99", "CYCL CALL"):
                entry["call"] = True
        walk = walk_holes(text, context)
        self.assertEqual([_nc_cycles.call_of(step, walk.tracker.interp) for step in walk.steps[-2:]], [None, None])

    def test_a_subprogram_call_under_a_fanuc_cycle_refuses(self) -> None:
        text = program(*FANUC_HEAD, "G81 X10. Y10. Z-5. R2. F150.", "M98 P2000", "G80", "M30")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertEqual(reasons(result), [(6, "call-form")])
        self.assertIn("M98 while G81 is in force", result["findings"][0]["message"])
        self.assertEqual(result["text"], text)

    def test_a_call_in_the_cycle_block_itself_refuses(self) -> None:
        text = program(*FANUC_HEAD, "G81 X10. Y10. Z-5. R2. F150. M98 P2000", "G80", "M30")
        self.assertEqual(reasons(run(text, plain_context("fanuc-gcode", text))), [(5, "call-form")])

    def test_a_call_after_the_cycle_is_cancelled_is_no_refusal(self) -> None:
        text = program(*FANUC_HEAD, "G81 X10. Y10. Z-5. R2. F150.", "G80", "M98 P2000", "M30")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertEqual(reasons(result), [])
        self.assertIn("Expanded 1 cycle", result["message"])

    def test_a_klartext_label_call_under_m89_refuses_once_the_data_marks_it(self) -> None:
        # Fix batch 3 gives `CALL LBL` and `CALL PGM` `call: true` in the shipped data.
        text = klartext_drill("5 L X+10 Y+10 R0 FMAX M89", "6 CALL LBL 1", "7 L X+40 Y+10 R0 FMAX M99", "8 L Z+100 R0 FMAX M30", "9 LBL 1", "10 L X+20 Y+20 R0 FMAX", "11 LBL 0", "12 END PGM FB MM")
        result = run(text, plain_context("heidenhain-klartext", text))
        self.assertEqual(reasons(result), [(16, "call-form")])


class McallRunsTest(unittest.TestCase):
    """NC-10: under ``MCALL`` a block with only a feed or a speed (a straight move code in force)
    or only ``G0``/``G1`` runs the cycle on the control too: refused (``call-form``)."""

    def test_feed_speed_and_move_code_blocks_refuse_others_do_not(self) -> None:
        text = program(*SINUMERIK_HEAD, "N40 MCALL CYCLE81(10,0,2,-5)", "N50 X10 Y10", "N60 F250", "N70 M8", "N80 S2500", "N90 G1", "N100 X20", "N110 MCALL", "N120 F300", "N130 M30")
        walk = walk_holes(text, plain_context("sinumerik-mill", text))
        self.assertEqual([(r.line, r.reason) for r in walk.refusals], [(7, "call-form"), (9, "call-form"), (10, "call-form")])
        self.assertEqual(len(walk.holes), 2)

    def test_a_feed_under_an_arc_code_is_no_refusal(self) -> None:
        text = program(*SINUMERIK_HEAD, "N35 G2 X0 Y0 I1 J0", "N40 MCALL CYCLE81(10,0,2,-5)", "N50 F250", "N60 MCALL", "N70 M30")
        walk = walk_holes(text, plain_context("sinumerik-mill", text))
        self.assertEqual(walk.refusals, [])


class BlockSkipTest(unittest.TestCase):
    """NC-2, NC-2b: a cycle block with a block skip, a line that holds cycle data with one, and a
    block that gets a mode back with one refuse (``block-skip``); the goldens ``fanuc-block-skip``
    and ``klartext-jump-and-skip``."""

    def test_skipped_cycle_blocks_in_every_dialect(self) -> None:
        cases = [
            ("sinumerik-mill", program(*SINUMERIK_HEAD, "/N60 CYCLE81(10,0,2,-5)", "N70 G0 Z100", "N80 M30"), 5),
            ("sinumerik-mill", program(*SINUMERIK_HEAD, "/N40 MCALL CYCLE81(10,0,2,-5)", "N50 X10 Y10", "N60 MCALL", "N70 M30"), 5),
            ("heidenhain-klartext", klartext_drill("5 L X+10 Y+10 R0 FMAX", "6 /CYCL CALL", "7 L Z+100 R0 FMAX M30", "8 END PGM FB MM"), 16),
            ("heidenhain-klartext", klartext_drill("5 L X+10 Y+10 R0 FMAX", "6 CYCL CALL", "7 L Z+100 R0 FMAX M30", "8 END PGM FB MM").replace("4 CYCL DEF", "4 /CYCL DEF"), 5),
            ("fanuc-gcode", program(*FANUC_HEAD, "G81 X10. Y10. Z-5. R2. F150.", "/G80", "G0 Z100.", "M30"), 6),
        ]
        for profile, text, line in cases:
            with self.subTest(text=text.split("\n")[line - 1]):
                result = run(text, plain_context(profile, text))
                self.assertIn((line, "block-skip"), reasons(result))
                self.assertEqual(result["text"], text)

    def test_a_skip_away_from_any_cycle_is_no_refusal(self) -> None:
        text = program(*FANUC_HEAD, "/G80", "/X5.", "G81 X10. Y10. Z-5. R2. F150.", "G80", "M30")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertEqual(reasons(result), [])

    def test_a_skipped_block_that_needs_nothing_back_is_written(self) -> None:
        # G0 before the cycle, G0 left by it: the skipped block gets nothing back.
        text = program(*[l.replace("G1 X0. Y0. F500", "G0 X0. Y0.") for l in FANUC_HEAD], "G81 X10. Y10. Z-5. R2. F150.", "G80", "/X30.", "M30")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertEqual(reasons(result), [])
        self.assertIn("\n/X30.\n", result["text"])

    def test_the_separator_of_a_skipped_block(self) -> None:
        import expand_cycles

        context = plain_context("fanuc-gcode", "/N60 X20.")
        walk = walk_holes("/N60 X20.", context)
        self.assertEqual(expand_cycles._separator("/N60 X20.", walk.steps[0]), " ")
        walk = walk_holes("/N60X20.Y5.", context)
        self.assertEqual(expand_cycles._separator("/N60X20.Y5.", walk.steps[0]), "")


class LevelRefusalTest(unittest.TestCase):
    """NC-3, NC-7, NC-7b: ``levels_of`` refuses what the controls alarm on or read otherwise (the
    goldens ``sinumerik-levels-refused`` and ``klartext-levels-refused``)."""

    KLARTEXT = LevelsTest.KLARTEXT
    SINUMERIK = LevelsTest.SINUMERIK

    def refusal(self, schema: Dict[str, Any], values: Dict[str, Decimal]) -> Tuple[str, str]:
        with self.assertRaises(_nc_cycles.CycleError) as caught:
            _nc_cycles.levels_of(schema, values, D("100"), False, None)
        return caught.exception.reason, caught.exception.detail

    def test_a_clearance_or_a_return_distance_below_zero(self) -> None:
        base = {"surface": D("0"), "clearance": D("2"), "depth-relative": D("-12"), "return-relative": D("50")}
        self.assertEqual(self.refusal(self.KLARTEXT, dict(base, clearance=D("-2"))), ("value-missing", "a set-up clearance below 0"))
        self.assertEqual(self.refusal(self.KLARTEXT, dict(base, **{"return-relative": D("-5")})), ("value-missing", "a return distance below 0"))
        self.assertEqual(_nc_cycles.levels_of(self.KLARTEXT, dict(base, clearance=D("0"), **{"return-relative": D("0")}), D("100"), False, None)["return"], D("0"))

    def test_a_return_level_not_above_the_surface(self) -> None:
        values = {"surface": D("0"), "clearance": D("2"), "depth-relative": D("5"), "return": D("-1")}
        self.assertEqual(self.refusal(self.SINUMERIK, values)[0], "value-missing")
        self.assertEqual(self.refusal(self.SINUMERIK, dict(values, **{"return": D("0")}))[0], "value-missing")
        self.assertEqual(_nc_cycles.levels_of(self.SINUMERIK, dict(values, **{"return": D("0.5")}), D("30"), False, None)["return"], D("0.5"))

    def test_a_relative_depth_of_zero_or_above_zero(self) -> None:
        self.assertEqual(self.refusal(self.KLARTEXT, {"surface": D("0"), "depth-relative": D("0")}), ("value-missing", "a depth of 0 and no other depth"))
        self.assertEqual(self.refusal(self.SINUMERIK, {"surface": D("0"), "depth-relative": D("0")})[0], "value-missing")
        self.assertEqual(self.refusal(self.KLARTEXT, {"surface": D("0"), "depth-relative": D("1")})[0], "depth-direction")

    def test_no_rapid_below_the_surface(self) -> None:
        # The invariant of check_levels on a schema whose rapid goes to a level below the surface.
        text = program(*SINUMERIK_HEAD, "N60 CYCLE81(10,0,2,-5)", "N70 M30")
        context = plain_context("sinumerik-mill", text)
        for entry in context["codes"]:
            if entry.get("code") == "CYCLE81":
                entry["expand"] = dict(entry["expand"], steps=[{"step": "rapid", "to": "depth"}] + list(entry["expand"]["steps"]))
        walk = walk_holes(text, context)
        self.assertEqual([(r.reason, r.detail) for r in walk.refusals], [("value-missing", "the depth below the surface")])


class CallWithMoveTest(unittest.TestCase):
    """NC-4: a Sinumerik block with its own move and a cycle call keeps the move as its own line
    (the golden ``sinumerik-call-move-lift-off``)."""

    def test_the_move_stays_its_own_block(self) -> None:
        text = program(*SINUMERIK_HEAD, "N60 G0 X10 Y20 CYCLE81(10,0,2,-5)", "N70 G0 Z100", "N80 M30")
        result = run(text, plain_context("sinumerik-mill", text))
        self.assertEqual(result["text"].split("\n")[4:8], ["N60 G0 X10 Y20", "Z2", "G1 Z-5", "G0 Z10"])


class LiftOffBackTest(unittest.TestCase):
    """NC-5: the way back from the lift-off moves in the plane only."""

    def test_rpap_is_not_reversed(self) -> None:
        text = program(*SINUMERIK_HEAD[:3], "N30 G0 X10 Y10 Z30", "N60 CYCLE86(10,0,1,-12,,1,3,-1,0,2,45)", "N70 M30")
        (hole,) = walk_holes(text, plain_context("sinumerik-mill", text)).holes
        rapids = [m.to for m in hole.moves if m.kind == "rapid"]
        self.assertEqual(rapids, [{"Z": D("1")}, {"X": D("9"), "Z": D("-10")}, {"Z": D("1")}, {"X": D("10")}, {"Z": D("10")}])


class RepeatZeroTest(unittest.TestCase):
    """Fix batch 7 (the owner's answer G, 2026-10-22): a Fanuc cycle block with ``K0`` and no
    position stays as written; the control stores the values and drills nothing, so the first
    move written for a later block under that cycle carries its motion code (it ends the cycle on
    the control, as ``G80`` does) and its feed. The golden ``fanuc-k0-data-kept``."""

    HEAD = [line.replace("G1 X0. Y0. F500", "G0 X0. Y0. F500") for line in FANUC_HEAD]

    def test_the_block_stays_as_written_and_the_next_move_ends_the_cycle(self) -> None:
        text = program(*self.HEAD, "N40 G81 Z-5. R2. F150. K0", "N50 X10. Y10.", "N60 G80", "M30")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertEqual(reasons(result), [])
        lines = result["text"].split("\n")
        self.assertEqual(lines[4:7], ["N40 G81 Z-5. R2. F150. K0", "N50 G0 X10. Y10.", "Z2."])
        self.assertEqual([(f["line"], f["severity"], f["reason"]) for f in result["findings"]], [(5, "info", "data-kept")])
        self.assertIn("left as written (K0)", result["findings"][0]["message"])
        self.assertIn("Expanded 1 cycle (1 hole)", result["message"])

    def test_the_first_feed_move_writes_the_feed(self) -> None:
        # F500 is in force and the K0 block writes none: the feed move still writes it.
        text = program(*self.HEAD, "N40 G81 Z-5. R2. K0", "N50 X10. Y10.", "N60 G80", "M30")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertIn("\nG1 Z-5. F500\n", result["text"])

    def test_other_words_stay_with_the_block(self) -> None:
        text = program(*self.HEAD, "N40 G81 Z-5. R2. F150. K0 M8", "N50 X10. Y10.", "N60 G80", "M30")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertIn("\nN40 G81 Z-5. R2. F150. K0 M8\nN50 G0 X10. Y10.\n", result["text"])

    def test_a_k0_block_alone_changes_nothing(self) -> None:
        text = program(*self.HEAD, "N40 G81 Z-5. R2. F150. K0", "N50 G80", "M30")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertEqual(result["text"], text)
        self.assertTrue(result["message"].startswith("No drilling cycle to expand: nothing was changed."))
        self.assertEqual([f["reason"] for f in result["findings"]], ["data-kept"])

    def test_after_g80_the_motion_code_is_not_written_again(self) -> None:
        text = program(*self.HEAD, "N40 G81 Z-5. R2. F150. K0", "N50 G80", "N60 G81 X10. Y10. Z-5. R2. F150.", "N70 G80", "M30")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertIn("\nN50 G80\nN60 X10. Y10.\n", result["text"])


class SpindleTest(unittest.TestCase):
    """NC-9 and the owner's question Q2: CYCLE86 without SDIR refuses; FANUC G86 is written out
    under M3 only."""

    def test_cycle86_without_sdir(self) -> None:
        text = program(*SINUMERIK_HEAD, "N60 CYCLE86(10,0,1,-12,,1,,-1,0,0,45)", "N70 M30")
        walk = walk_holes(text, plain_context("sinumerik-mill", text))
        self.assertEqual([(r.reason, r.detail) for r in walk.refusals], [("value-missing", "the spindle direction SDIR")])

    def test_g86_under_m4_refuses_under_m3_writes(self) -> None:
        text = program(*FANUC_HEAD, "G86 X10. Y10. Z-5. R2. F150.", "G80", "M30")
        self.assertEqual(walk_holes(text, plain_context("fanuc-gcode", text)).refusals, [])
        text = text.replace("S1000 M3", "S1000 M4")
        walk = walk_holes(text, plain_context("fanuc-gcode", text))
        self.assertEqual([(r.reason, r.detail) for r in walk.refusals], [("variant-unknown", "M4 in force")])


class RestoreTargetTest(unittest.TestCase):
    """NC-8 and NC-13: the motion code in force before the cycle goes back on the first block that
    moves (in a frame and to a machine position too); a code gEdit does not know there, or a motion
    code before the cycle that is not known, refuses."""

    def run_fanuc(self, *tail: str) -> Dict[str, Any]:
        text = program(*FANUC_HEAD, "G81 X10. Y10. Z-5. R2. F150.", "G80", *tail)
        return run(text, plain_context("fanuc-gcode", text))

    def test_a_move_in_a_frame_gets_the_motion_code_back(self) -> None:
        result = self.run_fanuc("G68 X0. Y0. R30.", "X30.", "G69", "X40.", "M30")
        self.assertEqual(reasons(result), [])
        self.assertIn("\nG68 X0. Y0. R30.\nG1 X30.\nG69\nX40.\n", result["text"])

    def test_a_machine_position_gets_the_motion_code_back(self) -> None:
        # Sinumerik G53 only leaves the offsets out: the block moves at the motion code in force.
        text = program(*SINUMERIK_HEAD, "N40 G1 X10 Y20", "N50 CYCLE81(10,0,2,-5)", "N60 G53 Z0", "N70 X30", "N80 M30")
        result = run(text, plain_context("sinumerik-mill", text))
        self.assertEqual(reasons(result), [])
        self.assertIn("\nN60 G1 G53 Z0\nN70 X30\n", result["text"])

    def test_a_fanuc_g53_or_g28_block_moves_at_rapid_and_passes_it_on(self) -> None:
        # Fix batch 5: FANUC G53 and G28 move at rapid whatever the motion code in force (the
        # manual; `sets.motion: 'rapid'`), so the first block that moves at that code gets it.
        result = self.run_fanuc("G53 Z0.", "X30.", "M30")
        self.assertEqual(reasons(result), [])
        self.assertIn("\nG53 Z0.\nG1 X30.\n", result["text"])
        result = self.run_fanuc("G91 G28 Z0.", "G90 X30.", "M30")
        self.assertEqual(reasons(result), [])
        self.assertIn("\nG91 G28 Z0.\nG1 G90 X30.\n", result["text"])

    def test_an_unknown_code_there_refuses(self) -> None:
        result = self.run_fanuc("G123 X30.", "X40.", "M30")
        self.assertEqual(reasons(result), [(5, "param-unknown")])
        self.assertIn("G123 on line 7", result["findings"][0]["message"])

    def test_a_motion_code_not_known_before_the_cycle_refuses(self) -> None:
        text = program(*[l.replace("G1 X0. Y0. F500", "X0. Y0.") for l in FANUC_HEAD], "G81 X10. Y10. Z-5. R2. F150.", "G80", "X30. Z100.", "M30")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertEqual(reasons(result), [(5, "value-missing")])
        self.assertIn("the motion code in force before the cycle", result["findings"][0]["message"])


class OwnMotionRestoreTest(unittest.TestCase):
    """Fix batch 5: a block whose own code moves it (`sets.motion` outside the motion group:
    Sinumerik `G74`, which stands in a block of its own, and `G75`) gets no motion code back; the
    next block that moves does, and with none in the selection the cycle refuses."""

    def run_sinumerik(self, *tail: str) -> Dict[str, Any]:
        text = program(*SINUMERIK_HEAD, "N40 G1 X10 Y20", "N50 CYCLE81(10,0,2,-5)", *tail)
        return run(text, plain_context("sinumerik-mill", text))

    def test_g74_stands_alone_and_the_next_move_gets_g1(self) -> None:
        result = self.run_sinumerik("N60 G74 Z1=0", "N70 X30", "N80 M30")
        self.assertEqual(reasons(result), [])
        self.assertIn("\nN60 G74 Z1=0\nN70 G1 X30\n", result["text"])

    def test_g75_moves_at_rapid_and_the_next_move_gets_g1(self) -> None:
        result = self.run_sinumerik("N60 G75 FP=2 X1=0 Y1=0 Z1=0", "N70 X30", "N80 M30")
        self.assertEqual(reasons(result), [])
        self.assertIn("\nN60 G75 FP=2 X1=0 Y1=0 Z1=0\nN70 G1 X30\n", result["text"])

    def test_a_skippable_g74_block_gets_nothing_and_does_not_refuse(self) -> None:
        result = self.run_sinumerik("/N60 G74 Z1=0", "N70 X30", "N80 M30")
        self.assertEqual(reasons(result), [])
        self.assertIn("\n/N60 G74 Z1=0\nN70 G1 X30\n", result["text"])

    def test_a_selection_that_ends_on_g74_refuses(self) -> None:
        lines = [*SINUMERIK_HEAD, "N40 G1 X10 Y20", "N50 CYCLE81(10,0,2,-5)", "N60 G74 Z1=0", "N70 X30", "N80 M30"]
        context = plain_context("sinumerik-mill", "")
        context["input"] = {"scope": "selection", "startLine": 6, "endLine": 7, "precedingLines": lines[:5]}
        result = run(program(*lines[5:7]), context)
        self.assertEqual(reasons(result), [(6, "restore-outside")])


class PeckUnitsTest(unittest.TestCase):
    """NC-11 (CODE-2): the peck values are read in the form's ``motionUnits`` (prefilled from the
    machine) and converted to the units of the block."""

    TEXT = program(
        "O1 (WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)",
        "G20 G17 G40 G80 G90 G94 G98",
        "G0 X0. Y0. S1000 M3",
        "G43 H1 Z1.",
        "G83 X1. Y1. Z-0.5 R0.1 Q0.2 F10.",
        "G80",
        "M30",
    )

    def test_millimetres_on_an_inch_program(self) -> None:
        inch = run(self.TEXT, plain_context("fanuc-gcode", self.TEXT, {"peckClearance": 0.1, "motionUnits": "inch"}))
        mm = run(self.TEXT, plain_context("fanuc-gcode", self.TEXT, {"peckClearance": 2.54, "motionUnits": "mm"}))
        self.assertEqual(reasons(mm), [])
        self.assertEqual(mm["text"], inch["text"])
        self.assertIn("\nZ0.0000\n", mm["text"])

    def test_a_value_that_does_not_convert_exactly_refuses(self) -> None:
        result = run(self.TEXT, plain_context("fanuc-gcode", self.TEXT, {"peckClearance": 1, "motionUnits": "mm"}))
        self.assertEqual(reasons(result), [(5, "resolution")])

    def test_without_units_the_values_are_the_programs(self) -> None:
        result = run(self.TEXT, plain_context("fanuc-gcode", self.TEXT, {"peckClearance": 0.1}))
        self.assertIn("\nZ0.0000\n", result["text"])

    def test_a_unit_that_is_not_mm_or_inch_stops_the_run(self) -> None:
        out = helpers.run_script(SCRIPT, stdin=self.TEXT, context=plain_context("fanuc-gcode", self.TEXT, {"motionUnits": "cm"}))
        self.assertEqual(out.returncode, 1)
        self.assertIn("Units of the peck values", out.stderr)

    def test_the_header_prefills_the_units_and_no_peck_field_limits_the_decimals(self) -> None:
        # CODE-7: a machine value with more decimals than a `decimals` line allows was dropped.
        header = (helpers.SCRIPTS_DIR / SCRIPT).read_text(encoding="utf-8").split("# ///\n")[0]
        blocks = header.split("# [[params]]")[1:]
        self.assertEqual([re.search(r'# id = "([^"]+)"', b).group(1) for b in blocks], ["peckRetract", "peckClearance", "motionUnits"])  # type: ignore[union-attr]
        self.assertIn('# prefill = "machine.motion.units"', blocks[2])
        for block in blocks:
            self.assertNotIn("# decimals", block)


class RepeatCountTest(unittest.TestCase):
    """CODE-1, CODE-4, CODE-5 and the owner's question Q1: the repeat count ``K``."""

    def fanuc(self, *body: str) -> str:
        return program(*FANUC_HEAD, *body, "G80", "G0 Z100.", "M30")

    def test_a_count_above_the_cap_refuses_and_leaves_the_extents_not_known(self) -> None:
        self.assertEqual(_nc_cycles.MAX_REPEAT, _nc_path.MAX_REPEAT)
        text = self.fanuc("G91 G81 X5. Y0. Z-7. R-18. F150. K20000", "G90")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertEqual(reasons(result), [(5, "value-missing")])
        self.assertIn("more than 9999 repeats", result["findings"][0]["message"])
        rows = rows_of(extents_of(text, plain_context("fanuc-gcode", text)))
        self.assertGreater(int(rows[("program", "Program", "X")].get("unresolved") or 0), 0)
        self.assertNotEqual(rows[("program", "Program", "X")].get("max"), "100000")

    def test_k0_without_a_position_drills_nothing_and_reaches_no_depth(self) -> None:
        text = self.fanuc("G81 Z-5. R2. F150. K0")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertEqual(reasons(result), [])
        # Fix batch 7 (the owner's answer G): the block stays as written, nothing is expanded.
        self.assertEqual(result["text"], text)
        self.assertIn("No drilling cycle to expand", result["message"])
        rows = rows_of(extents_of(text, plain_context("fanuc-gcode", text)))
        self.assertEqual(rows[("program", "Program", "Z")].get("min"), "20")

    def test_k0_with_a_position_refuses(self) -> None:
        text = self.fanuc("G81 X10. Y10. Z-5. R2. F150. K0")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertEqual(reasons(result), [(5, "call-form")])
        rows = rows_of(extents_of(text, plain_context("fanuc-gcode", text)))
        self.assertEqual((rows[("program", "Program", "Z")].get("min"), rows[("program", "Program", "X")].get("max")), ("20", "0"))


class LengthOffsetInCycleTest(unittest.TestCase):
    """NC-16: a tool length offset code in the cycle block refuses (``param-unknown``)."""

    def test_g43_and_g49_in_the_cycle_block(self) -> None:
        for code in ("G43 H2", "G49"):
            with self.subTest(code=code):
                text = program(*FANUC_HEAD, "G81 X10. Y10. Z-5. R2. F150. %s" % code, "G80", "M30")
                walk = walk_holes(text, plain_context("fanuc-gcode", text))
                self.assertEqual([r.reason for r in walk.refusals], ["param-unknown"])


class UnknownWordInCycleTest(unittest.TestCase):
    """The manual-check round (D1-1, D1-2, 2026-10-25): a Fanuc cycle block carries the codes, the
    block number, M, S, T, F and the cycle's own parameters; any other address word refuses the
    block (``param-unknown``). The ``,D`` clearance of G73/G83 (0i-F Plus and newer) is not read
    yet: it never lands on a rapid line and the form's value is not used in its place."""

    PECKS = {"peckRetract": "0.5", "peckClearance": "0.5"}

    def test_the_clearance_comma_d_of_g73_and_g83_refuses(self) -> None:
        for code in ("G83", "G73"):
            with self.subTest(code=code):
                line = "%s X10. Y10. Z-20. R2. Q5. ,D1.5 F150." % code
                text = program(*FANUC_HEAD, line, "G80", "M30")
                result = run(text, plain_context("fanuc-gcode", text, self.PECKS))
                self.assertEqual(reasons(result), [(5, "param-unknown")])
                self.assertEqual(result["text"], text)
                self.assertIn(",D1.5, the peck clearance", result["findings"][0]["message"])
                walk = walk_holes(text, plain_context("fanuc-gcode", text), _nc_cycles.PeckValues(retract=Decimal("0.5"), clearance=Decimal("0.5")))
                self.assertEqual(walk.holes, [])

    def test_a_word_that_is_no_parameter_of_the_cycle_refuses(self) -> None:
        for line in (
            "G83 X10. Y10. Z-20. R2. Q5. I1000 F150.",
            "G81 X10. Y10. Z-5. R2. F150. E5",
            "G81 X10. Y10. Z-5. R2. F150. H2",
            "G81 X10. Y10. Z-5. R2. F150. D2",
            "G81 X10. Y10. Z-5. R2. F150. ,C1.",
            "G81 X10. Y10. Z-5. R2. F150. L2",
        ):
            with self.subTest(line=line):
                text = program(*FANUC_HEAD, line, "G80", "M30")
                result = run(text, plain_context("fanuc-gcode", text, self.PECKS))
                self.assertEqual(reasons(result), [(5, "param-unknown")])
                self.assertEqual(result["text"], text)

    def test_a_later_hole_with_such_a_word_refuses(self) -> None:
        text = program(*FANUC_HEAD, "G81 X10. Y10. Z-5. R2. F150.", "X20. I3.", "G80", "M30")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertEqual(reasons(result), [(6, "param-unknown")])

    def test_m_s_t_and_the_block_number_stay_with_the_block(self) -> None:
        text = program(*FANUC_HEAD, "N40 G81 X10. Y10. Z-5. R2. F150. S1200 T2 M8", "G80", "M30")
        result = run(text, plain_context("fanuc-gcode", text))
        self.assertEqual(reasons(result), [])
        self.assertIn("\nN40 S1200 T2 M8 G0 X10. Y10.\n", result["text"])


class AnnotationsTest(unittest.TestCase):
    """CODE-6: every name the annotations of ``_nc_cycles`` use is imported."""

    def test_the_type_hints_resolve(self) -> None:
        import typing

        for name in ("_q_assignments", "_straight_codes", "_group_state"):
            with self.subTest(name=name):
                typing.get_type_hints(getattr(_nc_cycles, name))


if __name__ == "__main__":
    unittest.main()
