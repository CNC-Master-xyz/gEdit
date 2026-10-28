"""`rotate.py` (Phase 4 plan §5 P4a, P4.4; exit criteria X20 and X22), against the golden
cases in ``tests/fixtures/scripts/rotate/`` (the format is ``tests/fixtures/scripts/README.md``,
"The geometry goldens"), and the properties of X20 the goldens cannot hold alone: a rotation by
360° gives the program back byte for byte, four rotations by 90° give every value back, and a
rounded rotation stays on the turned path (checked against a computation of its own, not the
script's) with no drift along incremental moves.

The identity and round trip also run over every owner-public program the rotation does not
refuse; what each program refuses is printed, counted per reason, and not asserted.

The helpers at the top are used by ``test_mirror.py`` as well. The programs are synthetic,
written for gEdit.
"""

from __future__ import annotations

import concurrent.futures
import math
import os
import sys
import unittest
from decimal import Decimal
from typing import Any, Dict, List, Optional, Sequence, Tuple

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()
import _nc_path  # noqa: E402  (the bundled folder is on sys.path from here on)

SCRIPT = "rotate.py"
OWNER_PUBLIC = helpers.FIXTURES_DIR / "nc" / "owner-public"
#: The owner-public runs: several scripts at once, each in its own process.
WORKERS = max(1, min(4, os.cpu_count() or 1))
#: One run over the largest owner-public program (99,000 lines) on a loaded machine.
LONG_TIMEOUT_SECONDS = 900


# ---------------------------------------------------------------------------
# Helpers (test_mirror.py imports them)
# ---------------------------------------------------------------------------


def case_named(script: str, name: str) -> helpers.GeometryCase:
    return next(c for c in helpers.geometry_cases(script) if c.name == name)


def run_case(script: str, case: helpers.GeometryCase, text: Optional[str] = None, **params: Any) -> Dict[str, Any]:
    """One run of ``script`` with the context of ``case`` (its profile, machine and selection),
    on ``text`` (the case's input by default), with ``params`` instead of the case's."""
    context = helpers.geometry_context(case)
    if params:
        context["params"] = dict(params)
    out = helpers.run_script(script, stdin=case.input_text() if text is None else text, context=context)
    if not out.ok:
        raise AssertionError(out.stderr)
    return out.json()


def run_text(
    script: str, profile_id: str, params: Dict[str, Any], text: str,
    preceding: Optional[Sequence[str]] = None, preset: Optional[str] = None,
) -> Dict[str, Any]:
    """One run of ``script`` on ``text`` with the profile ``profile_id`` (and a machine
    ``preset``): the whole document, or a selection right below ``preceding``."""
    context = helpers.effective_context(profile_id, preset=preset) if preset else helpers.effective_context(profile_id)
    context["params"] = dict(params)
    lines = text.split("\n")
    if preceding is not None:
        start = len(preceding) + 1
        context["input"] = {"scope": "selection", "startLine": start, "endLine": start + len(lines) - 1, "precedingLines": list(preceding)}
    else:
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
    out = helpers.run_script(script, stdin=text, context=context)
    if not out.ok:
        raise AssertionError(out.stderr)
    return out.json()


def run_selection(
    script: str, profile_id: str, params: Dict[str, Any], program: Sequence[str], start: int, end: int,
    below: bool = True,
) -> Dict[str, Any]:
    """One run of ``script`` on lines ``start`` to ``end`` (1-based) of ``program`` as a
    selection, with the lines above it and (``below``) the lines below it
    (``input.followingLines``, which the app leaves out when there are too many)."""
    context = helpers.effective_context(profile_id)
    context["params"] = dict(params)
    lines = list(program)
    context["input"] = {"scope": "selection", "startLine": start, "endLine": end, "precedingLines": lines[: start - 1]}
    if below:
        context["input"]["followingLines"] = lines[end:]
    out = helpers.run_script(script, stdin="\n".join(lines[start - 1 : end]), context=context)
    if not out.ok:
        raise AssertionError(out.stderr)
    return out.json()


def errors_of(result: Dict[str, Any]) -> List[Tuple[int, str]]:
    return [(f["line"], f["reason"]) for f in result.get("findings", []) if f.get("severity") == "error"]


def refused(result: Dict[str, Any]) -> bool:
    return any(f.get("severity") == "error" for f in result.get("findings", []))


def words_by_line(text: str, profile: Dict[str, Any]) -> List[List[Tuple[str, Optional[Decimal]]]]:
    """Every word of every line with its written value (``None`` for an expression)."""
    cp = gedit_nc.compile_profile(profile)
    state = None
    out = []
    for line in text.split("\n"):
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        words = []
        for token in tokens:
            if token.kind != "word" or not token.address:
                continue
            literal, _ = _nc_path.literal_of(token)
            value = Decimal(literal.raw.replace(",", ".")) if literal is not None else None
            words.append((token.address.upper(), value))
        out.append(words)
    return out


def assert_values_back(test: unittest.TestCase, before: str, after: str, profile: Dict[str, Any]) -> None:
    """Every word of ``before`` has its value again in ``after``, line by line (a word a
    transform added stands next to them and is not asked about)."""
    lines_before = words_by_line(before, profile)
    lines_after = words_by_line(after, profile)
    test.assertEqual(len(lines_before), len(lines_after))
    for number, (old, new) in enumerate(zip(lines_before, lines_after), 1):
        remaining = list(new)
        for address, value in old:
            match = next((i for i, (a, v) in enumerate(remaining) if a == address), None)
            test.assertIsNotNone(match, "line %d: %s is gone" % (number, address))
            got = remaining.pop(match)  # type: ignore[arg-type]
            test.assertEqual(got[1], value, "line %d: %s" % (number, address))


def positions(text: str, context: Dict[str, Any], first: int = 1, preceding: Sequence[str] = ()) -> List[Dict[str, Optional[Decimal]]]:
    """Where the tool is after every line of ``text`` (coordinates), by the path tracker."""
    cp = gedit_nc.compile_profile(context["profile"])
    tracker = _nc_path.PathTracker(context, cp)
    state = None
    for number, line in enumerate(preceding, first - len(preceding)):
        state, _ = tracker.line(line, number, state, False)
    out = []
    for number, line in enumerate(text.split("\n"), first):
        state, step = tracker.line(line, number, state, True)
        out.append({axis: (None if v is None else tracker.axes.geo(axis, v)) for axis, v in step.after.items()})
    return out


def arcs_of(text: str, context: Dict[str, Any]) -> List[Any]:
    cp = gedit_nc.compile_profile(context["profile"])
    tracker = _nc_path.PathTracker(context, cp)
    state = None
    out = []
    for number, line in enumerate(text.split("\n"), 1):
        state, step = tracker.line(line, number, state, True)
        if step.arc is not None:
            out.append(step.arc)
    return out


def assert_synthetic(test: unittest.TestCase, script: str) -> None:
    """Every golden program says in its first comment line that it is synthetic (the lines
    above a selection are the top of its document)."""
    for case in helpers.geometry_cases(script):
        with test.subTest(case=case.name):
            top = case.preceding_lines() or case.input_lines()
            test.assertIn("WRITTEN FOR GEDIT", "\n".join(top[:3]))


def owner_public() -> List[Tuple[str, str, str]]:
    """``(rel, profile id, text)`` of every owner-public program, as the app hands it over."""
    from tests.python.test_owner_public import decode, profile_of, programs

    return [(rel, profile_of(rel), decode(path.read_bytes())) for rel, path in programs()]


def run_long(script: str, text: str, profile_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    context = helpers.effective_context(profile_id, params=params)
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    out = helpers.run_script(script, stdin=text, context=context)
    if not out.ok:
        raise AssertionError("%s: %s" % (script, out.stderr[-2000:]))
    return out.json()


def run_owner_public(jobs: Sequence[Tuple[str, str, str, Dict[str, Any]]]) -> Dict[Tuple[str, str], Dict[str, Any]]:
    """``{(rel, key): result}`` for jobs ``(rel, key, script, params)`` on the owner-public programs."""
    texts = {rel: (pid, text) for rel, pid, text in owner_public()}
    saved = helpers.RUN_TIMEOUT_SECONDS
    helpers.RUN_TIMEOUT_SECONDS = LONG_TIMEOUT_SECONDS
    try:
        ordered = sorted(jobs, key=lambda job: -len(texts[job[0]][1]))
        with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {
                pool.submit(run_long, script, texts[rel][1], texts[rel][0], params): (rel, key)
                for rel, key, script, params in ordered
            }
            return {futures[f]: f.result() for f in concurrent.futures.as_completed(futures)}
    finally:
        helpers.RUN_TIMEOUT_SECONDS = saved


def refusal_counts(result: Dict[str, Any]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for finding in result.get("findings", []):
        if finding.get("severity") == "error":
            counts[finding["reason"]] = counts.get(finding["reason"], 0) + 1
    return counts


def print_counts(title: str, counts: Dict[str, Dict[str, int]], kept: Sequence[str]) -> None:
    """The review's numbers (plan P4.4): what each owner-public program refused, per reason."""
    lines = ["", "%s: %d programs written, %d refused (counts are of the findings, at most 1000 a run)" % (title, len(kept), len(counts))]
    lines.extend("  written: %s" % rel for rel in kept)
    total: Dict[str, int] = {}
    for rel in sorted(counts):
        reasons = counts[rel]
        lines.append("  %s: %s" % (rel, ", ".join("%s %d" % (r, n) for r, n in sorted(reasons.items()))))
        for reason, n in reasons.items():
            total[reason] = total.get(reason, 0) + n
    lines.append("  blocks refused per reason: %s" % ", ".join("%s %d" % (r, n) for r, n in sorted(total.items())))
    print("\n".join(lines), file=sys.stderr)


# ---------------------------------------------------------------------------
# The goldens
# ---------------------------------------------------------------------------

#: The cases of the plan's exit criteria (a missing folder fails here, not silently).
CASES = {
    "fanuc-mill-90", "fanuc-mill-180-decimal-centre", "fanuc-mill-30-rounded", "fanuc-mill-30-arc-refused",
    "fanuc-mill-is-b-90", "fanuc-mill-is-b-resolution", "fanuc-mill-refused", "fanuc-mill-selection",
    "fanuc-mill-selection-in-cycle", "fanuc-lathe-refused", "klartext-270", "klartext-refused",
    "klartext-selection-in-block", "okuma-milling-as-lathe", "sinumerik-mill-90-centre", "sinumerik-mill-refused",
    # The P4a fix round (batch B2).
    "b2-klartext-increments-30", "b2-selection-arc-refused", "b2-selection-incremental-refused",
    "b2-selection-join-180", "b2-selection-unprimed", "b2-sinumerik-increments-30",
}

#: The refusals of X22 (and §7 #296) that apply to rotate, each held by a refused golden.
REASONS = {
    "frame", "coordinate-shift", "intermediate-point", "call", "expression", "machine-dependent",
    "distance-assumed", "position-unknown", "unknown-code", "word-unknown", "rotary-word", "selection-inside",
    "cycle-not-reviewed", "cycle-position", "fk-contour", "arc-tangential", "arc-check", "resolution",
    "pole-unknown", "plane", "lathe-rotate", "selection-start", "selection-unprimed",
}


class GoldenTest(unittest.TestCase):
    def test_every_case(self) -> None:
        cases = helpers.geometry_cases("rotate")
        self.assertLessEqual(CASES, {c.name for c in cases})
        for case in cases:
            with self.subTest(case=case.name):
                out = helpers.run_script(SCRIPT, stdin=case.input_text(), context=helpers.geometry_context(case))
                self.assertTrue(out.ok, out.stderr)
                result = out.json()
                self.assertEqual(result["text"], case.expected_text())
                want = case.envelope()
                self.assertEqual(result.get("message"), want["message"])
                self.assertEqual(result.get("findings", []), want["findings"])
                # Q4-1: a refused run hands the input back and says why at every block.
                self.assertEqual(refused(result), case.refused)
                if case.refused:
                    self.assertEqual(result["text"], case.input_text())

    def test_every_refusal_that_applies_is_held_by_a_golden(self) -> None:
        seen = set()
        for case in helpers.geometry_cases("rotate"):
            if case.refused:
                seen |= {f["reason"] for f in case.envelope()["findings"] if f["severity"] == "error"}
        self.assertEqual(REASONS - seen, set())

    def test_every_program_says_it_is_synthetic(self) -> None:
        assert_synthetic(self, "rotate")


class IdentityTest(unittest.TestCase):
    """X20: a rotation by whole turns gives the program back byte for byte."""

    def test_360_and_0_and_minus_360(self) -> None:
        for case in helpers.geometry_cases("rotate"):
            if case.refused:
                continue
            params = dict(case.params)
            for angle in (360, 0, -360, 720):
                with self.subTest(case=case.name, angle=angle):
                    params["angle"] = angle
                    result = run_case(SCRIPT, case, **params)
                    self.assertFalse(refused(result), result["message"])
                    self.assertEqual(result["text"], case.input_text())


class FourQuartersTest(unittest.TestCase):
    """X20: four rotations by 90° give every value back; the path is the same after them."""

    def test_four_times_90(self) -> None:
        for case in helpers.geometry_cases("rotate"):
            if case.refused or case.params.get("angle") not in (90, 180, 270):
                continue
            with self.subTest(case=case.name):
                text = case.input_text()
                params = dict(case.params, angle=90)
                for _ in range(4):
                    result = run_case(SCRIPT, case, text, **params)
                    self.assertFalse(refused(result), result["message"])
                    text = result["text"]
                context = helpers.geometry_context(case)
                assert_values_back(self, case.input_text(), text, context["profile"])
                before = positions(case.input_text(), context, case.context()["input"]["startLine"], case.preceding_lines())
                after = positions(text, context, case.context()["input"]["startLine"], case.preceding_lines())
                for number, (b, a) in enumerate(zip(before, after), 1):
                    for axis in ("X", "Y", "Z"):
                        if b.get(axis) is not None:
                            # The one position not exact: a word added from a point the tracker
                            # computed (after a Klartext polar move) is rounded (the golden says so).
                            self.assertLess(abs(a[axis] - b[axis]), Decimal("0.001"), "line %d %s" % (number, axis))  # type: ignore[operator]

    def test_a_quarter_turn_is_exact(self) -> None:
        # No word of an exact rotation is rounded, so its message counts none.
        for name in ("fanuc-mill-90", "fanuc-mill-180-decimal-centre", "sinumerik-mill-90-centre", "fanuc-mill-is-b-90"):
            with self.subTest(case=name):
                self.assertNotIn("rounded", case_named("rotate", name).envelope()["message"])


class RoundedTest(unittest.TestCase):
    """AD-44: a rotation by 30° rounds each word and keeps every point on the turned path."""

    def test_the_rounded_points_are_the_turned_points(self) -> None:
        case = case_named("rotate", "fanuc-mill-30-rounded")
        context = helpers.geometry_context(case)
        before = positions(case.input_text(), context)
        after = positions(case.expected_text(), context)
        cos, sin = math.cos(math.radians(30)), math.sin(math.radians(30))
        for number, (b, a) in enumerate(zip(before, after), 1):
            if b.get("X") is None or b.get("Y") is None:
                continue
            x, y = float(b["X"]), float(b["Y"])  # type: ignore[arg-type]
            with self.subTest(line=number):
                # Half the last decimal of the word, and no more: the increments of lines
                # 10-12 are differences of rounded points, so they do not add up.
                self.assertLess(abs(float(a["X"]) - (x * cos - y * sin)), 0.00051)  # type: ignore[arg-type]
                self.assertLess(abs(float(a["Y"]) - (x * sin + y * cos)), 0.00051)  # type: ignore[arg-type]
                self.assertEqual(a["Z"], b["Z"])

    def test_every_arc_of_the_result_keeps_its_radius(self) -> None:
        case = case_named("rotate", "fanuc-mill-30-rounded")
        arcs = arcs_of(case.expected_text(), helpers.geometry_context(case))
        self.assertEqual(len(arcs), 2)
        for arc in arcs:
            start, end = _nc_path.arc_radii(arc)
            self.assertLessEqual(abs(start - end), Decimal("0.002"))

    def test_the_decimals_of_the_form(self) -> None:
        case = case_named("rotate", "fanuc-mill-30-rounded")
        result = run_case(SCRIPT, case, angle=30, decimals="4")
        self.assertIn("G0 X8.6603 Y5.0000 Z5.", result["text"].split("\n"))
        self.assertIn("G1 X-23.7672 Y20.9190", result["text"].split("\n"))
        # Decimals change nothing in an exact rotation.
        self.assertEqual(run_case(SCRIPT, case, angle=90, decimals="4")["text"], run_case(SCRIPT, case, angle=90)["text"])

    def test_the_arc_check_refuses_at_the_arc_and_passes_with_more_decimals(self) -> None:
        case = case_named("rotate", "fanuc-mill-30-arc-refused")
        self.assertEqual([f["line"] for f in case.envelope()["findings"] if f["severity"] == "error"], [7])
        self.assertFalse(refused(run_case(SCRIPT, case, angle=30)))


class FormTest(unittest.TestCase):
    def test_a_missing_angle_is_an_error_not_a_guess(self) -> None:
        case = case_named("rotate", "fanuc-mill-90")
        context = helpers.geometry_context(case)
        context["params"] = {"cx": 0, "cy": 0}
        out = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)
        self.assertFalse(out.ok)
        self.assertIn("Angle", out.stderr)

    def test_the_header_is_the_contract_of_the_readme(self) -> None:
        source = (helpers.SCRIPTS_DIR / SCRIPT).read_text(encoding="utf-8")
        # Q-C (the owner's answer of 2026-10-16): the geometry scripts get 900 s.
        for line in ('# input = "selection-or-document"', '# output = "replace"', "# envelope = true", "# timeout = 900"):
            self.assertIn(line, source)
        for field in ("cx", "cy", "angle", "decimals"):
            self.assertIn('# id = "%s"' % field, source)


class IntegrationGapTest(unittest.TestCase):
    """Gaps P4.4 found and the P4a Wave B integration fixed (plan §7 #300, #307)."""

    def errors(self, result: Dict[str, Any]) -> List[Tuple[int, str]]:
        return [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"]

    def test_rotary_words_at_zero_turn_nothing(self) -> None:
        # AD-31's rotary rule about the tool axis: `A0. C0.` and `B0` leave every rotary axis
        # untouched, so the rotation goes on; `B30.` refuses its block and every move while
        # it stands there, the block that brings it back to 0 included.
        case = case_named("rotate", "fanuc-mill-90")
        text = (
            "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90\nG0 A0. C0.\n"
            "G0 X10. Y0. Z50.\nG1 X20. F100.\nG0 B0\nM30"
        )
        result = run_case(SCRIPT, case, text, cx=0, cy=0, angle=90)
        self.assertFalse(refused(result), result["findings"])
        self.assertIn("G1 X0. Y20. F100.", result["text"].split("\n"))
        turned = text.replace("G0 B0\n", "G0 B30.\nG1 X30.\nG0 B0. X0.\n")
        self.assertEqual(self.errors(run_case(SCRIPT, case, turned, cx=0, cy=0, angle=90)), [(6, "rotary-word"), (7, "rotary-word"), (8, "rotary-word")])

    def test_an_arc_through_a_point_is_refused_as_such(self) -> None:
        # The intermediate point of CIP (`I1=`, `J1=`, `K1=`) is a length (its database entry
        # says so), so the block's first reason is the arc, not the reading of a number.
        case = case_named("rotate", "sinumerik-mill-90-centre")
        text = (
            "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\nN10 G17 G90 G71\nN20 G0 X0 Y0\n"
            "N30 CIP X20 Y0 I1=10 J1=10\nN40 M30"
        )
        self.assertEqual(self.errors(run_case(SCRIPT, case, text, cx=0, cy=0, angle=30)), [(4, "arc-tangential")])
        # Wave Y (T016): a quarter turn turns the arc with the path, exactly.
        result = run_case(SCRIPT, case, text, cx=0, cy=0, angle=90)
        self.assertEqual(self.errors(result), [])
        self.assertIn("N30 CIP X0 Y20 I1=-10 J1=10", result["text"].split("\n"))


#: The top of a synthetic Fanuc milling program, the tool at X5 Y3 (the selections below start under it).
FANUC_TOP = ["(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", "%", "O4210", "G21 G17 G90 G54", "G0 X5. Y3. Z5."]
#: The same for Klartext.
KLARTEXT_TOP = ["0 BEGIN PGM SYNTH MM", "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE", "2 TOOL CALL 1 Z S3000", "3 L X+5 Y+3 Z+5 R0 FMAX"]


class IncrementRoundingTest(unittest.TestCase):
    """NC-1 (the P4a review): an incremental word without a point, on a machine that reads
    numbers as written, is rounded to 3 decimals in mm (as an absolute word is), not to whole
    millimetres; where the machine reads it in increments it stays whole increments."""

    TEXT = "\n".join(FANUC_TOP[:4] + ["G0 X0 Y0 Z5.", "G91 G1 X10 Y-5 F100.", "G90 G0 Z50.", "M30", "%"])

    def test_the_goldens(self) -> None:
        # Sinumerik and Klartext read every number as written.
        sinumerik = case_named("rotate", "b2-sinumerik-increments-30").expected_text().split("\n")
        self.assertIn("N30 G91 G1 X3.66 Y13.66 F100", sinumerik)
        self.assertIn("N40 X=AC(-3.17) Y1.83", sinumerik)
        klartext = case_named("rotate", "b2-klartext-increments-30").expected_text().split("\n")
        self.assertIn("4 L IX-3.66 IY-13.66 R0 F100", klartext)
        self.assertIn("5 L IX+6.062 IY+3.5", klartext)
        # The pole, and with it every move around it.
        self.assertIn("6 CC IX+8.66 IY+5", klartext)

    def test_a_fanuc_machine_that_reads_numbers_as_written(self) -> None:
        result = run_text(SCRIPT, "fanuc-gcode", {"angle": 30}, self.TEXT, preset="calculator")
        self.assertFalse(refused(result), result["findings"])
        self.assertIn("G91 G1 X11.16 Y0.67 F100.", result["text"].split("\n"))

    def test_whole_increments_stay_whole_increments(self) -> None:
        # IS-B: X10 is 0.010 mm; turned, 0.01116 and 0.00067 mm are 11 and 1 increments.
        result = run_text(SCRIPT, "fanuc-gcode", {"angle": 30}, self.TEXT, preset="is-b")
        self.assertFalse(refused(result), result["findings"])
        self.assertIn("G91 G1 X11 Y1 F100.", result["text"].split("\n"))


class SelectionTest(unittest.TestCase):
    """CODE-2 and CODE-4 (the P4a review): a selection whose lines above were not sent is
    refused; the first move of a selection starts where the lines above leave the tool."""

    def test_a_selection_whose_lines_above_were_not_sent(self) -> None:
        case = case_named("rotate", "b2-selection-unprimed")
        self.assertEqual(errors_of(case.envelope()), [(6, "selection-unprimed")])
        # The review's case: G68 and G20 above it, which the run cannot see.
        context = helpers.geometry_context(case_named("rotate", "fanuc-mill-90"))
        context["params"] = {"angle": 90}
        context["input"] = {"scope": "selection", "startLine": 6, "endLine": 7}
        out = helpers.run_script(SCRIPT, stdin="G17 G90 G1 X10. Y10. F100.\nX20. Y10.", context=context)
        self.assertTrue(out.ok, out.stderr)
        self.assertEqual(errors_of(out.json()), [(6, "selection-unprimed")])
        self.assertEqual(out.json()["text"], "G17 G90 G1 X10. Y10. F100.\nX20. Y10.")
        # With the lines above, the frame there refuses it.
        above = ["(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", "O1000", "G20", "G68 X0 Y0 R45.", "G0 X0 Y0 Z1."]
        self.assertEqual({r for _, r in errors_of(run_text(SCRIPT, "fanuc-gcode", {"angle": 90}, "G17 G90 G1 X10. Y10. F100.\nX20. Y10.", above))}, {"frame"})

    def test_the_first_move_writes_both_axes(self) -> None:
        # From X5 Y3, `G1 X10.` ends at X10 Y3; turned by 180 that is X-10 Y-3, not X-10 Y3.
        self.assertIn("G1 X-10. Y-3.", case_named("rotate", "b2-selection-join-180").expected_text().split("\n"))
        result = run_text(SCRIPT, "fanuc-gcode", {"angle": 180}, "G1 X10. F100.\nG1 Y8.", FANUC_TOP)
        self.assertEqual(result["text"], "G1 X-10. Y-3. F100.\nG1 Y-8.")

    def test_an_arc_or_an_increment_as_the_first_move_is_refused(self) -> None:
        self.assertEqual(errors_of(case_named("rotate", "b2-selection-arc-refused").envelope()), [(7, "selection-start")])
        self.assertEqual(errors_of(case_named("rotate", "b2-selection-incremental-refused").envelope()), [(7, "selection-start")])
        # A polar move with an incremental angle, around a pole the selection moves.
        result = run_text(SCRIPT, "heidenhain-klartext", {"angle": 180}, "4 CC X+10 Y+0\n5 LP PR+5 IPA+30 R0 F100", KLARTEXT_TOP)
        self.assertEqual(errors_of(result), [(6, "selection-start")])

    def test_a_pole_before_the_first_move_takes_the_tool_position(self) -> None:
        # `CC X+10` takes its Y from the tool, which stands at Y+3 (not moved): turned, Y-3.
        result = run_text(SCRIPT, "heidenhain-klartext", {"angle": 180}, "4 CC X+10\n5 LP PR+5 PA+0 R0 F100", KLARTEXT_TOP)
        self.assertFalse(refused(result), result["findings"])
        self.assertEqual(result["text"].split("\n")[0], "4 CC X-10 Y-3")

    def test_a_start_on_the_centre_is_not_moved(self) -> None:
        # The tool stands on the centre of the rotation, so the increment turns from there.
        result = run_text(SCRIPT, "fanuc-gcode", {"cx": 5, "cy": 3, "angle": 90}, "G91 G1 X5. F100.\nG90 G1 Y8.", FANUC_TOP)
        self.assertFalse(refused(result), result["findings"])
        self.assertEqual(result["text"].split("\n")[0], "G91 G1 X0. Y5. F100.")

    def test_a_whole_turn_refuses_nothing(self) -> None:
        result = run_text(SCRIPT, "fanuc-gcode", {"angle": 360}, "G91 G1 X5. F100.", FANUC_TOP)
        self.assertFalse(refused(result), result["findings"])


class SkepticGeometryTest(unittest.TestCase):
    """Wave Y skeptic of BL-NC-geometry, D1: a tangential arc (CT) or a Klartext departure (DEP)
    continues the direction of the move before it. As the first move of a selection, or right
    after the join from the unmoved point above it, that direction is not the turned one, even
    from a point the rotation does not move. Each test fails without the fix, except the guards."""

    #: A Sinumerik CT after a line (the skeptic's t016c).
    TANGENT = [
        "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
        "N10 G17 G90 G71", "N20 G0 X10 Y0 Z5", "N30 G1 Z-2 F200", "N40 G1 X20 Y10",
        "N50 CT X30 Y20", "N60 G1 X40 Y20", "N70 G0 Z50", "N80 M30",
    ]
    #: A Klartext polar approach and a departure on a tangential arc (the skeptic's t018y).
    DEPART = [
        "0 BEGIN PGM T MM", "1 TOOL CALL 1 Z S3000", "2 CC X+0 Y+0", "3 L X+40 Y+0 R0 FMAX", "4 L Z-2 R0 F200",
        "5 APPR PLCT PR+20 PA+0 R5 RL F200", "6 CP IPA+90 DR+", "7 DEP LCT X+0 Y+40 R5 F800",
        "8 L Z+50 R0 FMAX", "9 END PGM T MM",
    ]

    def test_d1_a_tangential_arc_from_the_centre_as_the_first_move(self) -> None:
        # The tool stands on the centre X20 Y10, which does not move; the arc would still
        # start along the old direction of N40.
        result = run_selection(SCRIPT, "sinumerik-mill", {"angle": 90, "cx": 20, "cy": 10}, self.TANGENT, 6, 9)
        self.assertEqual(errors_of(result), [(6, "selection-start")])
        self.assertEqual(result["text"], "\n".join(self.TANGENT[5:9]))

    def test_d1_a_tangential_arc_after_the_join(self) -> None:
        # N40 joins the unmoved X10 Y0 to the turned path: N50 would follow the join.
        result = run_selection(SCRIPT, "sinumerik-mill", {"angle": 90, "cx": 20, "cy": 10}, self.TANGENT, 5, 9)
        self.assertEqual(errors_of(result), [(5, "selection-start")])

    def test_d1_a_departure_as_the_first_move(self) -> None:
        result = run_selection(SCRIPT, "heidenhain-klartext", {"angle": 90, "cx": 0, "cy": 20}, self.DEPART, 8, 10)
        self.assertEqual(errors_of(result), [(8, "selection-start")])

    def test_d1_guards_a_join_from_the_centre_and_the_whole_program(self) -> None:
        # The join starts on the centre X10 Y0: it is the turned line, and the arc follows it.
        result = run_selection(SCRIPT, "sinumerik-mill", {"angle": 90, "cx": 10, "cy": 0}, self.TANGENT, 5, 9)
        self.assertFalse(refused(result), result["findings"])
        self.assertEqual(result["text"].split("\n")[:2], ["N40 G1 X0 Y10", "N50 CT X-10 Y20"])
        for program, profile in ((self.TANGENT, "sinumerik-mill"), (self.DEPART, "heidenhain-klartext")):
            result = run_text(SCRIPT, profile, {"angle": 90, "cx": 20, "cy": 10}, "\n".join(program))
            self.assertFalse(refused(result), result["findings"])


class OwnerPublicTest(unittest.TestCase):
    """X20 over the owner-public programs: identity (360°) and four quarter turns, on every
    program the rotation does not refuse; the refusals are printed per reason, not asserted."""

    def test_identity_and_round_trip(self) -> None:
        programs = owner_public()
        results = run_owner_public([(rel, "360", SCRIPT, {"angle": 360}) for rel, _, _ in programs])
        counts: Dict[str, Dict[str, int]] = {}
        kept: List[str] = []
        for rel, pid, text in programs:
            result = results[(rel, "360")]
            if refused(result):
                self.assertEqual(result["text"], text, rel)
                counts[rel] = refusal_counts(result)
                continue
            with self.subTest(program=rel):
                self.assertEqual(result["text"], text)
                turned = text
                for _ in range(4):
                    step = run_long(SCRIPT, turned, pid, {"angle": 90})
                    if refused(step):
                        kept.append("%s (identity kept; a quarter turn refused: %s)" % (rel, refusal_counts(step)))
                        break
                    turned = step["text"]
                else:
                    assert_values_back(self, text, turned, helpers.effective_context(pid)["profile"])
                    kept.append("%s (identity kept; four quarter turns give every value back)" % rel)
        print_counts("rotate by 360 degrees over the owner-public programs", counts, kept)
        # A refused run is clean by itself, so a floor keeps a script that came to refuse everything
        # from passing. Measured on 2026-10-16: 5 of the 20 programs are written by the 360 degree
        # run (the lathes are not for it) and 4 of them also turn four times a quarter; the floors
        # are one below. A deliberate new refusal may lower them, in the commit that adds it.
        self.assertGreaterEqual(len(kept), 4, "rotate wrote %d of the 20 owner-public programs: a new refusal? lower the floor on purpose" % len(kept))
        whole = [line for line in kept if "four quarter turns give every value back" in line]
        self.assertGreaterEqual(len(whole), 3, "rotate turned %d programs four times a quarter: a new refusal? lower the floor on purpose" % len(whole))



# ---------------------------------------------------------------------------
# P4a fix batch B6 (CODE-1): what the run no longer does
# ---------------------------------------------------------------------------


def in_process(module: Any, profile_id: str, params: Dict[str, Any], text: str) -> Dict[str, Any]:
    """One run of a script's ``main`` in this process on the whole of ``text`` (so a test can
    count what the run does): the envelope it wrote. The script module is imported by name."""
    context = helpers.effective_context(profile_id)
    context["params"] = dict(params)
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    written: Dict[str, Any] = {}
    saved = (gedit_nc.load_context, gedit_nc.read_input, gedit_nc.envelope)
    gedit_nc.load_context = lambda: context
    gedit_nc.read_input = lambda: text.split("\n")
    gedit_nc.envelope = lambda out, message=None, findings=None: written.update(text=out, message=message, findings=list(findings or []))
    try:
        module.main()
    finally:
        gedit_nc.load_context, gedit_nc.read_input, gedit_nc.envelope = saved
    return written


class CountedTrackers:
    """Counts the path trackers a run makes (and with what) by standing in for the class."""

    def __init__(self) -> None:
        self.made: List[Dict[str, Any]] = []
        self._real = _nc_path.PathTracker

    def __enter__(self) -> "CountedTrackers":
        counted = self

        class Counted(counted._real):  # type: ignore[name-defined, misc]
            def __init__(self, context, cp, **kwargs):  # type: ignore[no-untyped-def]
                counted.made.append(dict(kwargs))
                super().__init__(context, cp, **kwargs)

        _nc_path.PathTracker = Counted  # type: ignore[misc]
        return self

    def __exit__(self, *exc: Any) -> None:
        _nc_path.PathTracker = self._real  # type: ignore[misc]


class WalkCountTest(unittest.TestCase):
    """The arc check walks the written program again only to look at the arcs it wrote."""

    STRAIGHT = "G21 G17 G90\nG0 X10. Y0.\nG1 X20.5 Y5.25 F200.\nG1 X-4. Y8.\nM30"
    ARCS = "G21 G17 G90\nG0 X10. Y0.\nG3 X0. Y10. I-10. J0. F200.\nG1 X-4. Y8.\nM30"

    def run_rotate(self, text: str, angle: int = 30):
        import rotate

        with CountedTrackers() as trackers:
            result = in_process(rotate, "fanuc-gcode", {"cx": 0, "cy": 0, "angle": angle}, text)
        return result, trackers.made

    def test_a_rounded_run_without_an_arc_walks_the_program_once(self) -> None:
        result, made = self.run_rotate(self.STRAIGHT)
        self.assertIn("rounded", result["message"])
        self.assertEqual(len(made), 1, made)

    def test_a_rounded_run_with_an_arc_walks_the_written_program_again_for_the_arcs_only(self) -> None:
        result, made = self.run_rotate(self.ARCS)
        self.assertEqual(len(made), 2, made)
        self.assertEqual(made[1], {"reach": False, "flow": False})
        self.assertEqual(result["findings"][-1]["reason"], "rounded")

    def test_the_arc_check_still_finds_an_arc_rounding_leaves_off_its_radius(self) -> None:
        # The golden `fanuc-mill-30-arc-refused`: the walk that looks at the arcs is the one that refuses it.
        import rotate

        case = case_named("rotate", "fanuc-mill-30-arc-refused")
        with CountedTrackers() as trackers:
            result = in_process(rotate, case.profile_id, case.params, case.input_text())
        self.assertEqual(len(trackers.made), 2)
        self.assertEqual([f["reason"] for f in result["findings"]], ["arc-check"])
        self.assertEqual(result["text"], case.input_text())


if __name__ == "__main__":
    unittest.main()
