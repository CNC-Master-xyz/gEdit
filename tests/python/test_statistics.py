"""Statistics and Time (Phase 4 plan §5 P4b, P4.9; AD-47; exit criterion X24; plan §6.4 rule 6).

Three kinds of check:

1. **the goldens** of ``tests/fixtures/scripts/statistics/<case>/`` (``tests/fixtures/scripts/README.md``,
   "The drilling and time goldens"): the CSV byte for byte and the envelope's message and findings,
   each case computed by hand in its ``README.md``: a Fanuc mill program with ``G81``, ``G83``,
   ``G73``, an arc, a helix and the top-feed clamp; Klartext with ``CYCL CALL`` and the dwell cycle;
   Sinumerik ``CYCLE83`` and the travel time ``G931`` (T085); a lathe program under constant surface
   speed with its clamp and the split; a program without the machine's motion data;
2. **the rules** by small programs computed by hand here: the feed units (per minute, per revolution,
   constant surface speed with and without a clamp, inverse time, travel time), both rapid kinds, the
   units of the form, the dwells in each dialect's form, every "not estimated" kind, the tool rows, the
   channels, a selection, the form's errors; and the expansion's goldens estimated as the cycle and
   as its plain moves (AD-45, :class:`ExpansionTest`);
3. **the header**: the form ids of plan §6.4 rule 6 and their ``prefill`` lines.

Run: ``taskpolicy -b python3 -B -S -m unittest tests.python.test_statistics`` (also with
``/usr/bin/python3``, the oldest Python gEdit supports; :class:`OldestPythonTest` runs the goldens
with it from the newest one).
"""

from __future__ import annotations

import csv
import io
import os
import re
import unittest
from typing import Any, Dict, List, Optional

from tests.python import helpers

helpers.import_gedit_nc()

SCRIPT = "time_estimate.py"
CASES_DIR = helpers.SCRIPT_FIXTURES_DIR / "statistics"
OLDEST = "/usr/bin/python3"

#: The goldens the work package writes (plan §6.4 rule 6, the task's dialect list).
CASE_NAMES = (
    "fanuc-mill-g81-g83",
    "fanuc-no-motion",
    "fanuc-refused-cycles",
    "klartext-cycl-call",
    "lathe-css",
    "sinumerik-call-move-mcall",
    "sinumerik-cycle83-g931",
)

#: The "not estimated" kinds of plan §6.4 rule 6, in its order; the script adds two after them.
PLAN_KINDS = (
    "multi-pass",
    "thread",
    "contour",
    "pattern",
    "lap",
    "per-tooth",
    "call",
    "rotary-rate",
    "cycle",
    "peck-retract-missing",
    "peck-clearance-missing",
    "position-unknown",
)

#: A full motion form (mm), as a machine with a motion block prefills it.
MOTION = {"motionUnits": "mm", "rapidX": 30000, "rapidY": 30000, "rapidZ": 20000, "rapidKind": "straight", "toolChange": 4, "format": "csv"}


# ---------------------------------------------------------------------------
# Running the script
# ---------------------------------------------------------------------------


class Case:
    """One ``tests/fixtures/scripts/statistics/<case>/`` folder."""

    def __init__(self, directory: Any) -> None:
        self.name = directory.name
        self.directory = directory
        self.input_text = helpers.read_text(directory / "input.nc")
        self.params = helpers.load_json(directory / "params.json")
        self.options = helpers.load_json(directory / "case.json")
        self.expected = helpers.read_text(directory / "expected.csv")
        self.envelope = helpers.load_json(directory / "envelope.json")

    def context(self) -> Dict[str, Any]:
        return make_context(self.options["profile"], self.input_text, self.params, limits=self.options.get("limits"))


def cases() -> List[Case]:
    return [Case(d) for d in sorted(p for p in CASES_DIR.iterdir() if p.is_dir())]


def make_context(
    profile: str,
    text: str,
    params: Optional[Dict[str, Any]] = None,
    limits: Optional[Dict[str, Any]] = None,
    preset: Optional[str] = None,
    machine_name: Optional[str] = None,
) -> Dict[str, Any]:
    """A whole-document context of a built-in profile: no machine, or the machine of one of the
    profile's presets (``resolved/effective/<profile>/preset-<id>.json``); the limits block as the app
    puts a valid one into ``machine.limits``."""
    context = helpers.effective_context(profile, preset=preset)
    context["params"] = dict(params or {})
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    context["machine"] = dict(context["machine"])
    if machine_name is not None:
        context["machine"]["id"] = machine_name.lower().replace(" ", "-")
        context["machine"]["name"] = machine_name
    if limits is not None:
        context["machine"]["limits"] = limits
    return context


def run(text: str, context: Dict[str, Any], interpreter: Optional[str] = None) -> Dict[str, Any]:
    out = helpers.run_script(SCRIPT, stdin=text, context=context, interpreter=interpreter)
    if not out.ok:
        raise AssertionError("%s failed (exit %d): %s" % (SCRIPT, out.returncode, out.stderr[-2000:]))
    return out.json()


def table(result: Dict[str, Any]) -> Dict[str, Dict[str, str]]:
    """The CSV of a ``format: csv`` run, by the tool column (and ``channel / tool`` with channels)."""
    rows = list(csv.DictReader(io.StringIO(result["text"])))
    out: Dict[str, Dict[str, str]] = {}
    for row in rows:
        key = row["Tool"] if "Channel" not in row else "%s / %s" % (row["Channel"], row["Tool"])
        out[key] = row
    return out


def stats(profile: str, text: str, params: Optional[Dict[str, Any]] = None, **extra: Any) -> Dict[str, Any]:
    form = dict(MOTION)
    form.update(params or {})
    return run(text, make_context(profile, text, form, **extra))


def reasons(result: Dict[str, Any], after: int = 0) -> Dict[int, str]:
    """The warnings by line (after the line ``after``: the helpers' own first moves, whose start is
    where the machine stands, are position-unknown in every program)."""
    return {f["line"]: f["reason"] for f in result["findings"] if f["severity"] == "warning" and f["line"] > after}


def cell_lines(cell: str, kind: str) -> List[int]:
    """The lines a "Not estimated, by kind and line" cell lists for ``kind`` (``call 7-8; thread 9``)."""
    for part in cell.split("; "):
        name, _, numbers = part.partition(" ")
        if name != kind:
            continue
        out: List[int] = []
        for item in numbers.split(", "):
            first, _, last = item.partition("-")
            out.extend(range(int(first), int(last or first) + 1))
        return out
    return []


def fanuc(*blocks: str) -> str:
    """A Fanuc mill program around ``blocks``: the tool at X0 Y0 Z50, its start known."""
    head = [
        "%",
        "O9001 (WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)",
        "G21 G17 G40 G80 G90 G94",
        "T1 M6",
        "G0 X0. Y0. A0. S1000 M3",
        "G43 H1 Z50.",
    ]
    return "\n".join(head + list(blocks) + ["M30", "%", ""])


def lathe(*blocks: str) -> str:
    """A Fanuc lathe program around ``blocks``: the tool at X100 Z100, its start known."""
    head = ["%", "O9002 (WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", "G21 G18 G40 G99", "T0101", "G0 X100. Z100."]
    return "\n".join(head + list(blocks) + ["M30", "%", ""])


# ---------------------------------------------------------------------------
# 1. The goldens
# ---------------------------------------------------------------------------


class GoldenTest(unittest.TestCase):
    def test_the_cases_are_there(self):
        self.assertEqual(tuple(c.name for c in cases()), CASE_NAMES)

    def test_every_case_gives_its_csv_and_its_envelope(self):
        for case in cases():
            with self.subTest(case=case.name):
                result = run(case.input_text, case.context())
                self.assertEqual(result["text"], case.expected)
                self.assertEqual(result["message"], case.envelope["message"])
                self.assertEqual(result["findings"], case.envelope["findings"])

    def test_every_case_is_synthetic_and_computed_by_hand(self):
        for case in cases():
            with self.subTest(case=case.name):
                self.assertIn("WRITTEN FOR GEDIT", case.input_text)
                readme = helpers.read_text(case.directory / "README.md")
                total = list(csv.DictReader(io.StringIO(case.expected)))[-1]
                # The README's computation ends at the totals the CSV gives.
                self.assertIn(total["Feed length (mm)"], readme)
                self.assertIn(total["Rapid length (mm)"], readme)
                if total["Total time (s)"] != "not set":
                    self.assertIn(total["Total time (s)"], readme)

    def test_the_csv_is_lengths_to_a_hundredth_and_times_to_a_tenth(self):
        for case in cases():
            with self.subTest(case=case.name):
                for row in csv.DictReader(io.StringIO(case.expected)):
                    self.assertRegex(row["Feed length (mm)"], r"^\d+\.\d\d$")
                    self.assertRegex(row["Rapid length (mm)"], r"^\d+\.\d\d$")
                    for column in ("Feed time (s)", "Rapid time (s)", "Dwell time (s)", "Tool-change time (s)", "Total time (s)"):
                        self.assertRegex(row[column], r"^(\d+\.\d|not set)$")


# ---------------------------------------------------------------------------
# 2. The rules
# ---------------------------------------------------------------------------


class FeedTest(unittest.TestCase):
    """A feed move takes its length / the feed at 100 % (plan §6.4 rule 6)."""

    def test_a_feed_per_revolution_is_multiplied_by_the_speed_in_force(self):
        # G97 S1000, F0.1 mm/rev: 100 mm/min; 50 mm take 30 s.
        result = stats("fanuc-gcode", fanuc("G0 Z5.", "G95 G97 S1000", "G1 X50. F0.1"))
        self.assertEqual(table(result)["T1"]["Feed time (s)"], "30.0")

    def test_a_feed_per_revolution_without_the_speed_unit_is_not_estimated(self):
        # The mill database powers on in no spindle mode: rpm is not assumed.
        result = stats("fanuc-gcode", fanuc("G0 Z5.", "G95 S1000", "G1 X50. F0.1"))
        self.assertEqual(reasons(result).get(9), "feed-unknown")
        self.assertEqual(table(result)["T1"]["Feed length (mm)"], "0.00")

    def test_inverse_time_takes_one_over_f_minutes(self):
        # G93 F2: half a minute for the block, whatever its length; above the top feed it is held.
        result = stats("fanuc-gcode", fanuc("G0 Z5.", "G93 G1 X50. F2."))
        self.assertEqual(table(result)["T1"]["Feed time (s)"], "30.0")
        result = stats("fanuc-gcode", fanuc("G0 Z5.", "G93 G1 X50. F2."), {"maxFeed": 50})
        # 50 mm in 0.5 min is 100 mm/min, above 50: 1 min.
        self.assertEqual(table(result)["T1"]["Feed time (s)"], "60.0")
        self.assertIn("clamped", [f["reason"] for f in result["findings"]])

    def test_a_travel_time_is_f_seconds_as_written_t085(self):
        text = "\n".join(
            [
                "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
                "N10 G17 G90 G71 G94",
                "N20 T1 D1",
                "N25 M6",
                "N30 G0 X0 Y0 Z10",
                "N40 G931 G1 X100 F2.5",
                "N50 M30",
                "",
            ]
        )
        # 2.5 s as written; without a top feed nothing holds it.
        result = stats("sinumerik-mill", text)
        self.assertEqual(table(result)["T1"]["Feed time (s)"], "2.5")
        self.assertNotIn("clamped", [f["reason"] for f in result["findings"]])
        # 100 mm in 2.5 s is 2400 mm/min: under a top feed of 2000 it takes 3 s, counted.
        result = stats("sinumerik-mill", text, {"maxFeed": 2000})
        self.assertEqual(table(result)["T1"]["Feed time (s)"], "3.0")
        clamped = [f for f in result["findings"] if f["reason"] == "clamped"]
        self.assertEqual([f["line"] for f in clamped], [6])
        self.assertIn("1 move is timed at the top feed.", result["message"])

    def test_constant_surface_speed_without_a_clamp_follows_the_diameter(self):
        # G96 S100, F0.1 mm/rev, facing X80 -> X40 (r 40 -> 20) along 20 mm: t = L * mean r / (f K),
        # K = 100000 / (2 pi) = 15915.494; 20 * 30 / 1591.5494 = 0.376991 min = 22.6 s. No clamp.
        result = stats("fanuc-lathe", lathe("G0 X80. Z0.", "G96 S100 M3", "G1 X40. F0.1"))
        self.assertEqual(table(result)["T1"]["Feed time (s)"], "22.6")

    def test_without_a_clamp_in_the_program_the_machine_limit_holds_the_speed(self):
        # Facing X40 -> X0 under G96 S100, F0.1: unclamped 20 * 10 / 1591.5494 min = 7.5 s; held at
        # 1000 rpm (limits.spindle.main) below r = 15.9155: 4.0845 mm at mean r 17.9577 (0.046087 min)
        # and 15.9155 mm at 100 mm/min (0.159155 min): 0.205242 min = 12.3 s.
        program = lathe("G0 X40. Z0.", "G96 S100 M3", "G1 X0. F0.1")
        self.assertEqual(table(stats("fanuc-lathe", program))["T1"]["Feed time (s)"], "7.5")
        limited = stats("fanuc-lathe", program, limits={"spindle": {"main": 1000}})
        self.assertEqual(table(limited)["T1"]["Feed time (s)"], "12.3")
        # The program's clamp wins over the machine's limit.
        clamped = stats("fanuc-lathe", lathe("G0 X40. Z0.", "G50 S1000", "G96 S100 M3", "G1 X0. F0.1"), limits={"spindle": {"main": 5000}})
        self.assertEqual(table(clamped)["T1"]["Feed time (s)"], "12.3")

    def test_a_feed_per_revolution_under_surface_speed_on_a_mill_is_not_estimated(self):
        result = stats("fanuc-gcode", fanuc("G0 Z5.", "G95 G96 S100", "G1 X50. F0.1"))
        self.assertEqual(reasons(result).get(9), "feed-unknown")

    def test_a_feed_whose_reading_depends_on_the_machine_is_not_estimated(self):
        # F2500 per revolution: 0.25 mm/rev on IS-B (the lathe's 0.0001 mm/rev steps since the
        # manual-check fix D4-1), 2500 as written; no machine is chosen.
        program = lathe("G97 S1000 M3", "G1 Z50. F2500")
        result = stats("fanuc-lathe", program)
        self.assertEqual(reasons(result).get(7), "feed-unknown")
        self.assertIn("depends on the machine", next(f["message"] for f in result["findings"] if f["line"] == 7))
        # With the IS-B machine it is 0.25 mm/rev: 250 mm/min, 50 mm in 12 s.
        machine = stats("fanuc-lathe", program, preset="is-b")
        self.assertEqual(table(machine)["T1"]["Feed time (s)"], "12.0")


class RapidTest(unittest.TestCase):
    """Both rapid kinds, the form's units, the rates that are not set (Q4-11)."""

    PROGRAM = fanuc("G0 X30. Y40. Z10.")  # from X0 Y0 Z50: 30, 40, -40; length sqrt(3300) = 57.4456

    def test_straight_takes_the_length_over_the_slowest_moving_axis(self):
        result = stats("fanuc-gcode", self.PROGRAM, {"rapidKind": "straight"})
        # 57.4456 / 20000 * 60 = 0.172 s.
        self.assertEqual(table(result)["T1"]["Rapid time (s)"], "0.2")
        self.assertEqual(table(result)["T1"]["Rapid length (mm)"], "64.03")

    def test_per_axis_takes_the_longest_axis(self):
        # Rates X 600, Y 600, Z 1200 per min: X 3 s, Y 4 s, Z 2 s: 4 s. Straight: 64.0312 / 600 * 60 = 6.4 s.
        rates = {"rapidX": 600, "rapidY": 600, "rapidZ": 1200}
        self.assertEqual(table(stats("fanuc-gcode", self.PROGRAM, dict(rates, rapidKind="per-axis")))["T1"]["Rapid time (s)"], "4.0")
        self.assertEqual(table(stats("fanuc-gcode", self.PROGRAM, dict(rates, rapidKind="straight")))["T1"]["Rapid time (s)"], "6.4")

    def test_an_empty_rapid_kind_is_read_as_straight_and_said(self):
        rates = {"rapidX": 600, "rapidY": 600, "rapidZ": 1200, "rapidKind": ""}
        result = stats("fanuc-gcode", self.PROGRAM, rates)
        self.assertEqual(table(result)["T1"]["Rapid time (s)"], "6.4")
        self.assertIn("The kind of rapid move is not set", result["message"])

    def test_inch_rates_are_converted_exactly(self):
        # 600 in/min is 15240 mm/min: 64.0312 mm straight at the slowest (X, Y) take 0.25 s.
        rates = {"motionUnits": "inch", "rapidX": 600, "rapidY": 600, "rapidZ": 1200}
        self.assertEqual(table(stats("fanuc-gcode", self.PROGRAM, rates))["T1"]["Rapid time (s)"], "0.3")
        rates = {"motionUnits": "inch", "rapidX": 6, "rapidY": 6, "rapidZ": 12}
        # 6 in/min = 152.4 mm/min: 64.0312 / 152.4 * 60 = 25.2 s.
        self.assertEqual(table(stats("fanuc-gcode", self.PROGRAM, rates))["T1"]["Rapid time (s)"], "25.2")

    def test_rates_without_their_units_are_not_used(self):
        result = stats("fanuc-gcode", self.PROGRAM, {"motionUnits": ""})
        row = table(result)["T1"]
        self.assertEqual((row["Rapid length (mm)"], row["Rapid time (s)"], row["Total time (s)"]), ("64.03", "not set", "not set"))
        self.assertTrue(any(f["reason"] == "value-not-set" and "units of the rates" in f["message"] for f in result["findings"]))

    def test_a_missing_rate_is_named_once_and_only_where_an_axis_needs_it(self):
        result = stats("fanuc-gcode", fanuc("G0 Z10.", "G0 Z5.", "G0 X10."), {"rapidZ": ""})
        missing = [(f["line"], f["message"]) for f in result["findings"] if f["reason"] == "value-not-set"]
        self.assertEqual(missing, [(7, "The rapid rate of Z is not set in the form, so the rapid time and the total are not set.")])
        self.assertIn("Not set in the form: the rapid rate of Z.", result["message"])

    def test_a_rotary_axis_turns_at_its_rate_in_degrees_per_minute(self):
        # G0 A90.: 90 degrees at 3600 deg/min take 1.5 s; without the rate: not estimated.
        program = fanuc("G0 A90.")
        self.assertEqual(table(stats("fanuc-gcode", program, {"rapidA": 3600}))["T1"]["Rapid time (s)"], "1.5")
        self.assertEqual(reasons(stats("fanuc-gcode", program)).get(7), "rotary-rate")


class DwellTest(unittest.TestCase):
    """A dwell counts as written, from the dwell code's form (plan §6.3 rule 6)."""

    def test_fanuc_seconds_and_increments(self):
        program = fanuc("G4 X1.5", "G4 P500")
        # X in seconds; P in least time increments: not known without a machine...
        result = stats("fanuc-gcode", program)
        self.assertEqual(table(result)["T1"]["Dwell time (s)"], "1.5")
        self.assertEqual(reasons(result).get(8), "dwell-unknown")
        # ...0.001 s on the IS-B machine, 0.0001 s on IS-C.
        self.assertEqual(table(stats("fanuc-gcode", program, preset="is-b"))["T1"]["Dwell time (s)"], "2.0")
        self.assertEqual(table(stats("fanuc-gcode", program, preset="is-c"))["T1"]["Dwell time (s)"], "1.6")

    def test_a_cycle_dwell_in_increments_reads_the_machine_too(self):
        # G82 P1500: 1.5 s at the bottom on IS-B (hole: rapid 50 -> 2, feed 2 -> -5, dwell, rapid back).
        program = fanuc("G98 G82 X0. Y0. Z-5. R2. P1500 F100.", "G80")
        self.assertEqual(table(stats("fanuc-gcode", program, preset="is-b"))["T1"]["Dwell time (s)"], "1.5")
        self.assertEqual(reasons(stats("fanuc-gcode", program)).get(7), "dwell-unknown")

    def test_sinumerik_seconds_and_revolutions(self):
        text = "\n".join(
            [
                "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
                "N10 G17 G90 G71 G94",
                "N20 T1 D1",
                "N25 M6",
                "N30 S600 M3",
                "N40 G4 F2",
                "N50 G4 S15",
                "N60 M30",
                "",
            ]
        )
        # 2 s, and 15 revolutions at 600 rpm = 1.5 s.
        self.assertEqual(table(stats("sinumerik-mill", text))["T1"]["Dwell time (s)"], "3.5")

    def test_okuma_dwell_in_seconds_without_a_form(self):
        text = "\n".join(["$WRITTEN.MIN%", "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", "G50 S2000", "G4 F2.5", "M2", ""])
        # `G4` has no dwell form there; its F is the dwell (`fNotFeed`, `unit: 'dwell'`), read on the
        # machine: the presets read F2.5 differently, so without a machine it is not estimated.
        self.assertEqual(reasons(stats("okuma-osp", text)), {4: "dwell-unknown"})
        # Unit 1 mm reads every number as written: 2.5 s. (The 1 um preset counts F in 0.01 s.)
        result = stats("okuma-osp", text, preset="okuma-1mm")
        self.assertEqual(table(result)["Total"]["Dwell time (s)"], "2.5")

    def test_a_lathe_dwell_without_a_form_reads_its_seconds_and_lists_the_rest(self):
        # The Fanuc lathe G4 has no dwell form in the database: X and U are seconds (`unit: 'dwell'`);
        # a P (least time increments) is not read without the form: not estimated, never silent.
        result = stats("fanuc-lathe", lathe("G4 U1.5", "G4 P500"))
        self.assertEqual(table(result)["T1"]["Dwell time (s)"], "1.5")
        self.assertEqual(reasons(result, after=5), {7: "dwell-unknown"})

    def test_the_klartext_dwell_cycle(self):
        text = "\n".join(
            [
                "0 BEGIN PGM D MM",
                "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
                "2 TOOL CALL 1 Z S1000",
                "3 CYCL DEF 9.0 DWELL TIME",
                "4 CYCL DEF 9.1 DWELL 0.8",
                "5 END PGM D MM",
                "",
            ]
        )
        self.assertEqual(table(stats("heidenhain-klartext", text))["T1"]["Dwell time (s)"], "0.8")


class NotEstimatedTest(unittest.TestCase):
    """Every kind of plan §6.4 rule 6 (and the two this script adds), each with its line."""

    def test_the_kinds_are_the_plans_in_its_order_then_two_more(self):
        source = helpers.read_text(helpers.SCRIPTS_DIR / SCRIPT)
        block = source[source.index("KINDS = {") : source.index("KIND_ORDER")]
        kinds = tuple(re.findall(r'^    "([a-z-]+)": \(', block, re.MULTILINE))
        self.assertEqual(kinds, PLAN_KINDS + ("feed-unknown", "dwell-unknown"))

    def assertKind(self, result: Dict[str, Any], line: int, kind: str) -> None:
        found = reasons(result)
        self.assertEqual(found.get(line), kind, result["findings"])
        rows = table(result)
        self.assertIn(line, cell_lines(rows["Total"]["Not estimated, by kind and line"], kind))

    def test_multi_pass_and_thread(self):
        result = stats("fanuc-lathe", lathe("G0 X40. Z2.", "G71 U1. R0.5", "G71 P10 Q20 U0.2 W0.1 F0.2", "G32 Z-20. F1.5"))
        self.assertKind(result, 7, "multi-pass")
        self.assertKind(result, 8, "multi-pass")
        self.assertKind(result, 9, "thread")

    def test_the_contour_of_a_roughing_cycle_is_not_counted_where_it_stands(self):
        # FANUC 30i lathe manual (G71): after the roughing the control goes on after block nf; the
        # contour N100-N200 runs inside the cycle and with G70, not in passing. After it the tool
        # stands where the cycles left it: the next move's start is not known.
        program = lathe(
            "G97 S1000 M3",
            "G0 X42. Z2.",
            "G71 U1. R0.5",
            "G71 P100 Q200 U0.2 W0.1 F0.2",
            "N100 G0 X20.",
            "G1 Z-20. F0.1",
            "N200 X42.",
            "G70 P100 Q200",
            "G0 X100. Z100.",
            "G0 X110.",
        )
        result = stats("fanuc-lathe", program, {"rapidX": 12000, "rapidZ": 15000})
        self.assertEqual(reasons(result, after=5), {8: "multi-pass", 9: "multi-pass", 13: "cycle", 14: "position-unknown"})
        self.assertIn("its contour, blocks 100 to 200", next(f["message"] for f in result["findings"] if f["line"] == 9))
        row = table(result)["T1"]
        # Rapids: X100 Z100 -> X42 Z2 (radius 29, Z 98: 102.2034) and X100 -> X110 (radius 5).
        self.assertEqual((row["Feed length (mm)"], row["Rapid length (mm)"]), ("0.00", "107.20"))

    def test_contour_pattern_and_per_tooth(self):
        text = "\n".join(
            [
                "0 BEGIN PGM K MM",
                "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
                "2 TOOL CALL 1 Z S1000 M137",
                "3 L X+0 Y+0 Z+50 R0 FMAX",
                "4 FL X+10 Y+20",
                "5 L X+20 FZ0.1",
                "6 CYCL DEF 200 DRILLING ~",
                "  Q200=2 ;SET-UP CLEARANCE ~",
                "  Q201=-10 ;DEPTH ~",
                "  Q206=150 ;FEED RATE FOR PLNGNG ~",
                "  Q202=10 ;PLUNGING DEPTH ~",
                "  Q210=0 ;DWELL TIME AT TOP ~",
                "  Q203=+0 ;SURFACE COORDINATE ~",
                "  Q204=20 ;2ND SET-UP CLEARANCE ~",
                "  Q211=0 ;DWELL TIME AT DEPTH ~",
                "  Q395=0 ;DEPTH REFERENCE",
                "7 CYCL CALL PAT F500",
                "8 END PGM K MM",
                "",
            ]
        )
        result = stats("heidenhain-klartext", text)
        self.assertKind(result, 5, "contour")
        self.assertKind(result, 6, "per-tooth")
        self.assertKind(result, 17, "pattern")

    def test_lap(self):
        text = "\n".join(
            [
                "$WRITTEN.MIN%",
                "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)",
                "G50 S2000",
                "G0 X60 Z5",
                "G0 X50 Z2",
                "G85 NLAP1 D2 F0.3 U0.2 W0.1",
                "NLAP1 G81",
                "G1 X20 Z0",
                "G1 Z-20",
                "G80",
                "M2",
                "",
            ]
        )
        result = stats("okuma-osp", text)
        self.assertKind(result, 6, "lap")
        # The shape between G81 and G80 does not move: nothing of it is counted.
        self.assertEqual(table(result)["Total"]["Feed length (mm)"], "0.00")

    def test_call(self):
        result = stats("fanuc-gcode", fanuc("M98 P1000", "G65 P9010 A1."))
        self.assertKind(result, 7, "call")
        self.assertKind(result, 8, "call")

    def test_a_jump_is_counted_as_not_estimated(self):
        result = stats("fanuc-gcode", fanuc("GOTO 10"))
        self.assertKind(result, 7, "call")

    def test_rotary_rate_of_a_feed_move(self):
        result = stats("fanuc-gcode", fanuc("G1 A90. F1000."), {"rapidA": 3600})
        self.assertKind(result, 7, "rotary-rate")

    def test_cycle_with_its_reason(self):
        result = stats("fanuc-gcode", fanuc("G98 G84 X0. Y0. Z-10. R2. F150.", "G80", "G98 G87 X0. Y0. Z-10. R2. Q1. F100.", "G80"))
        self.assertKind(result, 7, "cycle")
        self.assertKind(result, 9, "cycle")
        messages = {f["line"]: f["message"] for f in result["findings"]}
        self.assertIn("tapping", messages[7])
        self.assertIn("no description of how this cycle moves", messages[9])

    def test_the_two_peck_values(self):
        program = fanuc("G99 G73 X0. Y0. Z-10. R2. Q3. F100.", "G80", "G0 Z50.", "G99 G83 X0. Y0. Z-10. R2. Q3. F100.", "G80")
        result = stats("fanuc-gcode", program)
        self.assertKind(result, 7, "peck-retract-missing")
        self.assertKind(result, 10, "peck-clearance-missing")
        # With the form's values both are timed (the prefill of the machine's motion block, Q4-9).
        timed = stats("fanuc-gcode", program, {"peckRetract": 0.5, "peckClearance": 1})
        self.assertEqual(reasons(timed, after=6), {})

    def test_position_unknown(self):
        result = stats("fanuc-gcode", fanuc("G91 G28 Z0.", "G90 G0 X10."))
        self.assertKind(result, 7, "position-unknown")
        # X and Y are known; the move in X is timed although Z is not known.
        self.assertEqual(table(result)["T1"]["Rapid length (mm)"], "10.00")

    KLARTEXT_PLAIN = "\n".join(
        [
            "0 BEGIN PGM U MM",
            "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
            "2 TOOL CALL 1 Z S1000",
            "3 L X+0 Y+0 Z+50 R0 FMAX",
            "4 L X+20 F500",
            "5 END PGM U MM",
            "",
        ]
    )

    def test_klartext_powers_on_in_feed_per_minute(self):
        # TNC 640 user manual (Klartext), M136: by default F is in mm/min; M136 switches to mm per
        # revolution until M137. The profile's power-on feed mode says so: 20 mm at 500 = 2.4 s.
        self.assertEqual(table(stats("heidenhain-klartext", self.KLARTEXT_PLAIN))["T1"]["Feed time (s)"], "2.4")

    def test_feed_unknown_without_a_feed_unit(self):
        # A profile that declares no power-on feed mode and a program that sets none: not guessed.
        text = self.KLARTEXT_PLAIN
        context = make_context("heidenhain-klartext", text, dict(MOTION))
        context["profile"] = dict(context["profile"])
        context["profile"].pop("modal", None)
        self.assertKind(run(text, context), 5, "feed-unknown")

    def test_feed_unknown_without_a_feed(self):
        self.assertKind(stats("fanuc-gcode", fanuc("G1 X10.")), 7, "feed-unknown")

    def test_dwell_unknown(self):
        self.assertKind(stats("fanuc-gcode", fanuc("G4 P500")), 7, "dwell-unknown")

    def test_a_cycle_dwell_that_cannot_be_read_leaves_out_that_dwell_only(self):
        # NC-K (fix batch 2): no machine, so the least time increment of `P500` is not known. The
        # dwell is listed; the moves of both holes are counted: per hole a rapid 48 down to R2,
        # 12 at F100 (7.2 s) and 60 back up to Z50 (G98), and 10 in X between them.
        result = stats("fanuc-gcode", fanuc("G98 G82 X0. Y0. Z-10. R2. P500 F100.", "X10.", "G80"))
        self.assertEqual(reasons(result, after=6), {7: "dwell-unknown", 8: "dwell-unknown"})
        self.assertIn("the moves of the cycle are counted", next(f["message"] for f in result["findings"] if f["line"] == 7))
        row = table(result)["T1"]
        self.assertEqual(
            (row["Feed length (mm)"], row["Feed time (s)"], row["Rapid length (mm)"], row["Dwell time (s)"], row["Not estimated"]),
            ("24.00", "14.4", "226.00", "0.0", "4"),
        )
        self.assertEqual(cell_lines(row["Not estimated, by kind and line"], "dwell-unknown"), [7, 8])
        # A cycle whose holes cannot be placed (the level it starts at is not known) is still
        # left out whole, listed once, not as a dwell too.
        unplaced = stats("fanuc-gcode", fanuc("G91 G28 Z0.", "G90 G98 G82 X0. Y0. Z-10. R2. P500 F100.", "G80"))
        self.assertEqual(reasons(unplaced, after=7), {8: "cycle"})
        self.assertEqual(table(unplaced)["T1"]["Feed length (mm)"], "0.00")

    def test_a_refused_block_under_a_modal_call_is_named_by_the_cycle_in_force(self):
        # Fix batch 1 (NC-10) refuses a block under MCALL that writes only a feed: the control
        # runs the cycle after it too. The row names the cycle, not the block a second time.
        text = "\n".join(
            [
                "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
                "N10 G17 G90 G71 G94",
                "N20 T4 D1",
                "N30 M6",
                "N40 S3000 M3 F100",
                "N50 G0 X0 Y0 Z30",
                "N60 MCALL CYCLE81(10,0,2,-5)",
                "N70 X20 Y20",
                "N80 F250",
                "N90 MCALL",
                "N100 M30",
                "",
            ]
        )
        result = stats("sinumerik-mill", text)
        self.assertKind(result, 9, "cycle")
        message = next(f["message"] for f in result["findings"] if f["line"] == 9)
        self.assertTrue(message.startswith("N80 F250: not estimated: the cycle is not timed (CYCLE81: "), message)

    def test_a_cycle_entry_marked_as_a_call_is_timed_as_the_cycle(self):
        # The estimate asks _nc_cycles.call_of, the expansion's detector, which leaves out cycle
        # entries (Klartext `M99` and `CYCL CALL` run the defined cycle): a cycle code whose data
        # says `call: true` is still timed from its holes, not listed as a subprogram call.
        program = fanuc("G98 G81 X0. Y0. Z-5. R2. F100.", "G80")
        context = make_context("fanuc-gcode", program, dict(MOTION))
        context["codes"] = [dict(e, call=True) if isinstance(e, dict) and e.get("code") == "G81" else e for e in context["codes"]]
        result = run(program, context)
        self.assertEqual(reasons(result, after=6), {})
        self.assertEqual(table(result)["T1"]["Feed length (mm)"], "7.00")

    def test_a_block_that_is_not_estimated_adds_nothing(self):
        result = stats("fanuc-gcode", fanuc("G1 A90. X10. F1000."), {"rapidA": 3600})
        row = table(result)["T1"]
        self.assertEqual((row["Feed length (mm)"], row["Feed time (s)"]), ("0.00", "0.0"))


class ExpansionTest(unittest.TestCase):
    """AD-45: the time estimate counts what the expansion would write. Each written case of
    ``tests/fixtures/scripts/expand_cycles/`` is estimated twice, as the cycle (``input.nc``) and
    as its plain moves (``expected.nc``): every column but the lines of the "not estimated" cell
    agrees. The Fanuc ``G91`` cases hold only since P4.7b, where the tracker reads a cycle's
    ``Z`` under ``G91`` from the R point and its repeat count as that many holes (found at the P4b
    Wave B integration: before it the rapid lengths were 328.96 against 338.64 and 222.55 against
    224.20)."""

    #: A block the estimate cannot time is left out whole, its holes included, where the expansion
    #: leaves out only its one move: the first approach from a start that is not known
    #: (Klartext). A cycle dwell in least increments without the machine's increment (Fanuc
    #: ``fanuc-g82-g85-g86-g89``) leaves out that dwell only since fix batch 2 (NC-K), as the
    #: expansion's ``G4`` does, and is compared.
    WHOLE_BLOCK = frozenset(("klartext-201-reaming", "klartext-201-retract-zero"))

    def estimate(self, case: Any, text: str) -> Dict[str, Dict[str, str]]:
        context = helpers.geometry_context(case)
        form = dict(MOTION)
        form.update({k: v for k, v in case.params.items() if k in ("peckRetract", "peckClearance") and v not in (None, "")})
        context["params"] = form
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
        rows = table(run(text, context))
        for row in rows.values():
            row.pop("Not estimated, by kind and line", None)
        return rows

    def test_a_cycle_is_estimated_as_its_expansion(self):
        compared = []
        for case in helpers.geometry_cases("expand_cycles"):
            if case.refused or case.preceding_file is not None or case.name in self.WHOLE_BLOCK:
                continue
            with self.subTest(case=case.name):
                self.assertEqual(self.estimate(case, case.input_text()), self.estimate(case, case.expected_text()))
                compared.append(case.name)
        self.assertIn("fanuc-g81-incremental-repeat", compared)
        self.assertIn("fanuc-g82-g85-g86-g89", compared)
        self.assertIn("fanuc-g83-incremental", compared)
        self.assertGreaterEqual(len(compared), 10)

    def test_klartext_201_with_q208_0_retracts_at_the_plunging_feed(self):
        # The expansion's feedOutZero (P4b follow-ups): Q208=0 is out at Q206, not a refusal.
        # At X0 Y0 from Z50: rapid 48 down to Z2, 12 in and 12 out at F100 (24 mm, 14.4 s; M137,
        # feed per minute, is in force at power-on), rapid 18 up to Q204 Z20.
        text = "\n".join(
            [
                "0 BEGIN PGM K MM",
                "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
                "2 TOOL CALL 1 Z S1000",
                "3 L X+0 Y+0 Z+50 R0 FMAX M3",
                "4 CYCL DEF 201 REAMING ~",
                "  Q200=2 ;SET-UP CLEARANCE ~",
                "  Q201=-10 ;DEPTH ~",
                "  Q206=100 ;FEED RATE FOR PLNGNG ~",
                "  Q211=0 ;DWELL TIME AT DEPTH ~",
                "  Q208=0 ;RETRACTION FEED RATE ~",
                "  Q203=+0 ;SURFACE COORDINATE ~",
                "  Q204=20 ;2ND SET-UP CLEARANCE",
                "5 CYCL CALL",
                "6 END PGM K MM",
                "",
            ]
        )
        result = stats("heidenhain-klartext", text)
        self.assertEqual(reasons(result, after=4), {})
        row = table(result)["T1"]
        self.assertEqual((row["Feed length (mm)"], row["Feed time (s)"], row["Rapid length (mm)"]), ("24.00", "14.4", "66.00"))


class PositionTest(unittest.TestCase):
    """Where the tool stands after a drilling cycle, which the tracker leaves "not known"."""

    def test_after_a_drilling_cycle_the_tool_stands_where_its_last_hole_left_it(self):
        # G98: back at the initial level Z50 (rapids 48 down to R2, 55 back up); then 10 mm up.
        result = stats("fanuc-gcode", fanuc("G98 G81 X0. Y0. Z-5. R2. F100.", "G80", "G0 Z60."))
        self.assertEqual(reasons(result, after=6), {})
        self.assertEqual(table(result)["T1"]["Rapid length (mm)"], "113.00")

    def test_after_a_refused_cycle_the_position_is_not_known(self):
        # The G83 without the clearance is not estimated, and where it leaves the tool is not known:
        # the rapid after it is not timed from the level the G81 left (a stale 10 mm).
        program = fanuc("G98 G81 X0. Y0. Z-5. R2. F100.", "G99 G83 X10. Q2.", "G80", "G0 Z60.")
        result = stats("fanuc-gcode", program)
        self.assertEqual(reasons(result, after=6), {8: "peck-clearance-missing", 10: "position-unknown"})
        self.assertEqual(table(result)["T1"]["Rapid length (mm)"], "103.00")

    def test_a_k0_block_without_a_position_leaves_the_tool_where_it_stood(self):
        # Fix batch 7: K0 stores the values and drills nothing, so the tool stays at Z50 and the
        # rapid to Z60 after it is timed (10 mm), as it is in the expansion that keeps the block.
        result = stats("fanuc-gcode", fanuc("G98 G81 Z-5. R2. F100. K0", "G80", "G0 Z60."))
        self.assertEqual(reasons(result, after=6), {})
        self.assertEqual(table(result)["T1"]["Rapid length (mm)"], "10.00")


class RowTest(unittest.TestCase):
    """Per tool, in order of first use, and the total (plan §6.4 rule 6)."""

    def test_a_tool_called_twice_is_one_row_with_two_changes(self):
        program = fanuc("G1 Z40. F600.", "T2 M6", "G1 Z30. F600.", "T1 M6", "G1 Z20. F600.")
        rows = table(stats("fanuc-gcode", program))
        self.assertEqual(list(rows), ["T1", "T2", "Total"])
        self.assertEqual((rows["T1"]["Tool changes"], rows["T1"]["Feed time (s)"], rows["T1"]["Tool-change time (s)"]), ("2", "2.0", "8.0"))
        self.assertEqual((rows["Total"]["Tool changes"], rows["Total"]["Feed length (mm)"]), ("3", "30.00"))

    def test_moves_before_the_first_tool_have_a_row_of_their_own(self):
        text = "\n".join(["%", "O9003 (WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", "G21 G90 G94", "G0 X0. Y0. Z50.", "G0 Z10.", "T1 M6", "G0 Z50.", "M30", "%", ""])
        rows = table(stats("fanuc-gcode", text))
        self.assertEqual(list(rows), ["No tool", "T1", "Total"])
        self.assertEqual(rows["No tool"]["Rapid length (mm)"], "40.00")

    def test_no_time_without_motion_data(self):
        result = run(fanuc("G0 Z10.", "G1 X10. F100."), make_context("fanuc-gcode", fanuc(), {"format": "csv"}))
        row = table(result)["Total"]
        self.assertEqual((row["Rapid time (s)"], row["Tool-change time (s)"], row["Total time (s)"]), ("not set", "not set", "not set"))
        self.assertEqual(row["Feed time (s)"], "6.0")
        self.assertTrue(result["message"].startswith("No total time"))

    def test_the_table_format_and_the_lower_bound_line(self):
        result = stats("fanuc-gcode", fanuc("G0 Z10.", "G1 X10. F100."), {"format": "table"})
        lines = result["text"].split("\n")
        self.assertTrue(lines[0].startswith("Tool  "))
        self.assertTrue(set(lines[1]) <= {"-", " "})
        self.assertIn("The estimate is a lower bound", result["text"])
        self.assertIn("The estimate is a lower bound", result["message"])
        # Times as minutes and seconds: 6 s of feed.
        self.assertIn("0:06.0", lines[2])

    def test_the_machine_is_named_last(self):
        result = stats("fanuc-gcode", fanuc("G0 Z10."), preset="is-b", machine_name="Mill 1")
        self.assertTrue(result["message"].endswith("Machine 'Mill 1': numbers without a point are increments of 0.001 mm."), result["message"])
        self.assertTrue(stats("fanuc-gcode", fanuc("G0 Z10."))["message"].endswith("No machine chosen: a value whose reading depends on the machine is not estimated."))


class ChannelTest(unittest.TestCase):
    """Per channel, as the tool list (M12, AD-32); the channels are never added up."""

    def test_rows_per_channel_and_a_total_for_each(self):
        base = helpers.FIXTURES_DIR / "channels"
        context = helpers.channel_context(base / "resolve" / "c01-twin-single.json")
        context["params"] = {"format": "csv"}
        text = helpers.read_text(base / "nc" / "fanuc-lathe" / "c01-twin-single.nc")
        result = run(text, context)
        rows = table(result)
        self.assertEqual(
            [key for key in rows],
            [
                "Channel 1 / No tool",
                "Channel 1 / T1",
                "Channel 1 / T3",
                "Channel 1 / Total",
                "Channel 2 / No tool",
                "Channel 2 / T2",
                "Channel 2 / T4",
                "Channel 2 / Total",
            ],
        )
        # Before the first tool: `G28 U0 W0`, a move to a machine position.
        self.assertEqual(cell_lines(rows["Channel 2 / No tool"]["Not estimated, by kind and line"], "position-unknown"), [27])
        # Channel 2: G1 Z-4. F0.08 from Z5 at 1500 rpm (9 mm at 120 mm/min, 4.5 s), G1 Z-25. F0.1 from
        # Z5 at 900 rpm (30 mm at 90 mm/min, 20 s).
        self.assertEqual((rows["Channel 2 / T2"]["Feed time (s)"], rows["Channel 2 / T4"]["Feed time (s)"]), ("4.5", "20.0"))
        self.assertEqual(rows["Channel 2 / Total"]["Feed length (mm)"], "39.00")
        self.assertIn("Estimated time per channel:", result["message"])
        self.assertTrue(all(f["message"].startswith(("Channel 1: ", "Channel 2: ")) for f in result["findings"] if f["reason"] != "value-not-set"))


class SelectionTest(unittest.TestCase):
    def test_the_lines_above_prime_the_walk(self):
        program = fanuc("G0 Z10.", "G1 X10. F100.", "X20.")
        lines = program.split("\n")
        start = 9  # `X20.`
        context = make_context("fanuc-gcode", program, dict(MOTION))
        context["input"] = {"scope": "selection", "startLine": start, "endLine": start, "precedingLines": lines[: start - 1]}
        result = run(lines[start - 1] + "\n", context)
        # The feed, the tool and the position come from above: 10 mm at 100 mm/min.
        rows = table(result)
        self.assertEqual(list(rows), ["T1", "Total"])
        self.assertEqual((rows["T1"]["Feed length (mm)"], rows["T1"]["Feed time (s)"], rows["T1"]["Tool changes"]), ("10.00", "6.0", "0"))

    def test_a_selection_without_the_lines_above_says_so(self):
        program = fanuc("G0 Z10.", "G1 X10. F100.", "X20.")
        lines = program.split("\n")
        context = make_context("fanuc-gcode", program, dict(MOTION))
        context["input"] = {"scope": "selection", "startLine": 9, "endLine": 9}
        result = run(lines[8] + "\n", context)
        self.assertEqual([(f["line"], f["reason"]) for f in result["findings"]][0], (9, "selection-unprimed"))
        # Neither the feed nor the position is known there: the move is not estimated.
        self.assertEqual(table(result)["Total"]["Feed length (mm)"], "0.00")


class FormTest(unittest.TestCase):
    def test_a_value_that_is_not_a_number_refuses_the_run(self):
        out = helpers.run_script(SCRIPT, stdin=fanuc(), context=make_context("fanuc-gcode", fanuc(), {"rapidX": "fast"}))
        self.assertEqual(out.returncode, 1)
        self.assertIn("Rapid rate X: 'fast' is not a number.", out.stderr)

    def test_a_rate_of_zero_refuses_the_run(self):
        out = helpers.run_script(SCRIPT, stdin=fanuc(), context=make_context("fanuc-gcode", fanuc(), {"maxFeed": 0}))
        self.assertEqual(out.returncode, 1)
        self.assertIn("a value above 0 is needed", out.stderr)

    def test_without_a_code_database_the_run_stops(self):
        context = make_context("fanuc-gcode", fanuc(), {})
        context["codes"] = []
        out = helpers.run_script(SCRIPT, stdin=fanuc(), context=context)
        self.assertEqual(out.returncode, 1)
        self.assertIn("needs the code database", out.stderr)

    def test_peck_values_follow_the_units_of_the_form(self):
        # G83 Q3 from R2 to -10 with a clearance of 1 mm or of 1 inch (25.4 mm, which reaches the
        # R plane: the cycle refuses, value-missing): the inch value is converted, not read as mm.
        program = fanuc("G99 G83 X0. Y0. Z-10. R2. Q3. F100.", "G80")
        self.assertEqual(reasons(stats("fanuc-gcode", program, {"peckClearance": 1, "motionUnits": "mm"}), after=6), {})
        inch = stats("fanuc-gcode", program, {"peckClearance": 1, "motionUnits": "inch", "rapidX": 1000, "rapidY": 1000, "rapidZ": 1000})
        self.assertEqual(reasons(inch).get(7), "cycle")


# ---------------------------------------------------------------------------
# 3. The header
# ---------------------------------------------------------------------------


class HeaderTest(unittest.TestCase):
    """The form ids of plan §6.4 rule 6 and the ``prefill`` of rule 5."""

    def header(self) -> str:
        source = helpers.read_text(helpers.SCRIPTS_DIR / SCRIPT)
        return source[source.index("# /// gedit") : source.index("# ///\n", source.index("# /// gedit") + 5)]

    def params(self) -> Dict[str, Dict[str, str]]:
        out: Dict[str, Dict[str, str]] = {}
        for block in self.header().split("# [[params]]")[1:]:
            fields = dict(re.findall(r'^# (\w+) = "([^"]*)"', block, re.MULTILINE))
            out[fields["id"]] = fields
        return out

    def test_the_form_ids_are_the_plans(self):
        self.assertEqual(
            list(self.params()),
            ["peckRetract", "peckClearance", "motionUnits", "rapidX", "rapidY", "rapidZ", "rapidA", "rapidB", "rapidC", "rapidKind", "maxFeed", "toolChange", "format"],
        )

    def test_every_machine_value_is_prefilled_from_the_motion_block(self):
        params = self.params()
        expected = {
            "peckRetract": "machine.motion.peckRetract",
            "peckClearance": "machine.motion.peckClearance",
            "motionUnits": "machine.motion.units",
            "rapidKind": "machine.motion.rapidKind",
            "maxFeed": "machine.motion.maxFeed",
            "toolChange": "machine.motion.toolChange",
        }
        for axis in "XYZABC":
            expected["rapid" + axis] = "machine.motion.rapid." + axis
        self.assertEqual({k: v.get("prefill") for k, v in params.items() if "prefill" in v}, expected)
        self.assertNotIn("prefill", params["format"])

    def test_no_peck_field_limits_the_decimals(self):
        # CODE-7 (fix batch 2): a `decimals` line made the form drop a machine value with more
        # decimals than it allows (the prefill of the motion block), silently.
        for block in self.header().split("# [[params]]")[1:]:
            self.assertNotIn("# decimals", block)

    def test_the_output_is_a_new_document_with_an_envelope(self):
        header = self.header()
        self.assertIn('# output = "new-document"', header)
        self.assertIn("# envelope = true", header)


class OldestPythonTest(unittest.TestCase):
    """The goldens on the oldest Python gEdit supports (3.9), run from the newest."""

    @unittest.skipUnless(os.path.exists(OLDEST), "no %s on this machine" % OLDEST)
    def test_the_goldens_on_the_oldest_python(self):
        for case in cases():
            with self.subTest(case=case.name):
                result = run(case.input_text, case.context(), interpreter=OLDEST)
                self.assertEqual(result["text"], case.expected)
                self.assertEqual(result["findings"], case.envelope["findings"])


if __name__ == "__main__":
    unittest.main()
