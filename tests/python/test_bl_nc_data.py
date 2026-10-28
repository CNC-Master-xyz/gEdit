"""Wave Y, batch BL-NC-data: what the scripts do with the code-database entries the batch added.

The data itself is held by ``src/lib/data/codes/blNcData.test.ts``; this module holds the
behaviour, each case a regression test that fails on the base without the change:

* T093: Klartext cycle 20 CONTOUR DATA is DEF-active, and its ``Q5`` (surface) and ``Q7``
  (clearance height) are tool-axis positions. Address arithmetic moves them with the ``Z``
  words, and the SL cycles 21 to 24 that read them (``usedBy``) are moved with cycle 20 or not
  at all (``Group.linked``). The transforms refuse cycle 20 (``cycle-position``), as they did
  while the database lacked it: they read its parameter lines without the cycle.
* T094: the pattern cycles 220 and 221 run the cycle defined last at a centre or a start point
  of their own: the definition and its calls are refused together (``cycle-position``).
* T096: the tool names ``QS13``/``QS18`` of the SL cycles no longer refuse the cycle.
* T107: ``G65``/``G66`` without ``P`` get a "missing word" row on both Fanuc profiles.

Synthetic programs only, written for gEdit, not for a machine.
"""

from __future__ import annotations

import unittest
from typing import Any, Dict, List, Optional, Tuple

from tests.python import helpers

HEADER = "0 BEGIN PGM SL MM\n1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE"


def contour_data(number: int, q5: str = "+30", q7: str = "+80") -> str:
    return "\n".join([
        "%d CYCL DEF 20 CONTOUR DATA ~" % number,
        "  Q1=-20 ;MILLING DEPTH ~",
        "  Q2=1 ;TOOL PATH OVERLAP ~",
        "  Q3=+0.2 ;ALLOWANCE FOR SIDE ~",
        "  Q4=+0.1 ;ALLOWANCE FOR FLOOR ~",
        "  Q5=%s ;SURFACE COORDINATE ~" % q5,
        "  Q6=2 ;SET-UP CLEARANCE ~",
        "  Q7=%s ;CLEARANCE HEIGHT ~" % q7,
        "  Q8=0.5 ;ROUNDING RADIUS ~",
        "  Q9=+1 ;ROTATIONAL DIRECTION",
    ])


def rough_out(number: int, q18: str = "Q18=0 ;COARSE ROUGHING TOOL ~") -> str:
    return "\n".join([
        "%d CYCL DEF 22 ROUGH-OUT ~" % number,
        "  Q10=-5 ;PLUNGING DEPTH ~",
        "  Q11=100 ;FEED RATE FOR PLNGNG ~",
        "  Q12=350 ;FEED RATE F. ROUGHNG ~",
        "  " + q18,
        "  Q19=150 ;FEED RATE FOR RECIP.",
    ])


def sl_program(q5: str = "+30", q18: str = "Q18=0 ;COARSE ROUGHING TOOL ~") -> str:
    return "\n".join([
        HEADER,
        "2 TOOL CALL 1 Z S3000",
        "3 L Z+100 R0 FMAX",
        "4 CYCL DEF 14.0 CONTOUR",
        "5 CYCL DEF 14.1 CONTOUR LABEL 1",
        contour_data(6, q5=q5),
        rough_out(7, q18=q18),
        "8 L X+50 Y+50 R0 FMAX",
        "9 CYCL CALL M3",
        "10 L Z+100 R0 FMAX",
        "11 LBL 1",
        "12 L X+10 Y+10 RL",
        "13 L X+90",
        "14 L Y+90",
        "15 L X+10",
        "16 L Y+10",
        "17 LBL 0",
        "18 END PGM SL MM",
    ])


PATTERN = "\n".join([
    "0 BEGIN PGM PT MM",
    "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
    "2 TOOL CALL 1 Z S3000",
    "3 L X+0 Y+0 Z+100 R0 FMAX",
    "4 CYCL DEF 200 DRILLING ~",
    "  Q200=2 ;SET-UP CLEARANCE ~",
    "  Q201=-15 ;DEPTH ~",
    "  Q206=250 ;FEED RATE FOR PLNGNG ~",
    "  Q202=5 ;PLUNGING DEPTH ~",
    "  Q210=0 ;DWELL TIME AT TOP ~",
    "  Q203=+30 ;SURFACE COORDINATE ~",
    "  Q204=50 ;2ND SET-UP CLEARANCE ~",
    "  Q211=0.25 ;DWELL TIME AT DEPTH",
    "5 CYCL DEF 220 POLAR PATTERN ~",
    "  Q216=+50 ;CENTER IN 1ST AXIS ~",
    "  Q217=+50 ;CENTER IN 2ND AXIS ~",
    "  Q244=80 ;PITCH CIRCLE DIAMETR ~",
    "  Q245=+0 ;STARTING ANGLE ~",
    "  Q246=+360 ;STOPPING ANGLE ~",
    "  Q247=+0 ;STEPPING ANGLE ~",
    "  Q241=8 ;NR OF REPETITIONS ~",
    "  Q200=2 ;SET-UP CLEARANCE ~",
    "  Q203=+30 ;SURFACE COORDINATE ~",
    "  Q204=50 ;2ND SET-UP CLEARANCE ~",
    "  Q301=1 ;MOVE TO CLEARANCE ~",
    "  Q365=0 ;TYPE OF TRAVERSE",
    "6 L Z+100 R0 FMAX",
    "7 END PGM PT MM",
])


def run(script: str, text: str, params: Dict[str, Any], profile: str = "heidenhain-klartext", selection: Optional[Tuple[int, int]] = None) -> Dict[str, Any]:
    context = helpers.effective_context(profile, params=params)
    lines = text.split("\n")
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
    if selection is not None:
        start, end = selection
        # Wave Y (FZ-5): a selection gets the lines below it too.
        context["input"] = {"scope": "selection", "startLine": start, "endLine": end, "precedingLines": lines[: start - 1], "followingLines": lines[end:]}
        text = "\n".join(lines[start - 1 : end])
    out = helpers.run_script(script, stdin=text, context=context)
    if not out.ok:
        raise AssertionError(out.stderr[-2000:])
    return out.json()


def shift_z(text: str, operand: float = 0.5, **extra: Any) -> Dict[str, Any]:
    return run("address_arithmetic.py", text, {"operation": "add", "operand": operand, "addresses": ["Z"]}, **extra)


def line_of(text: str, start: str) -> int:
    return next(i for i, line in enumerate(text.split("\n"), 1) if line.strip().startswith(start))


def changed(before: str, payload: Dict[str, Any]) -> List[Tuple[int, str]]:
    old = before.split("\n")
    new = payload["text"].split("\n")
    return [(i, b.strip()) for i, (a, b) in enumerate(zip(old, new), 1) if a != b]


def findings(payload: Dict[str, Any]) -> List[Tuple[int, str]]:
    return [(f["line"], f["reason"]) for f in payload["findings"]]


class T093ContourData(unittest.TestCase):
    """Cycle 20: its tool-axis positions move with the run, together with the SL cycles."""

    def test_a_z_shift_moves_the_surface_and_the_clearance_height(self) -> None:
        text = sl_program()
        payload = shift_z(text)
        self.assertEqual(
            [c for _, c in changed(text, payload)],
            ["3 L Z+100.5 R0 FMAX", "Q5=+30.5 ;SURFACE COORDINATE ~", "Q7=+80.5 ;CLEARANCE HEIGHT ~", "10 L Z+100.5 R0 FMAX"],
        )
        self.assertNotIn("cycle-not-reviewed", [r for _, r in findings(payload)])

    def test_a_surface_it_cannot_move_refuses_the_sl_cycle_and_its_call(self) -> None:
        # Cycle 22 and its call read the surface of cycle 20: left with it, never moved apart.
        text = sl_program(q5="+Q100")
        payload = shift_z(text)
        got = findings(payload)
        self.assertIn((line_of(text, "6 CYCL DEF 20"), "cycle-expression"), got)
        self.assertIn((line_of(text, "7 CYCL DEF 22"), "cycle-expression"), got)
        self.assertIn((line_of(text, "9 CYCL CALL"), "cycle-expression"), got)
        call = next(f for f in payload["findings"] if f["line"] == line_of(text, "9 CYCL CALL"))
        self.assertIn("the contour data it uses", call["message"])
        self.assertNotIn("Q7=+80.5", payload["text"])

    def test_a_selection_below_the_contour_data_leaves_the_call_and_says_why(self) -> None:
        text = sl_program()
        start = line_of(text, "7 CYCL DEF 22")
        end = line_of(text, "10 L Z+100")
        payload = shift_z(text, selection=(start, end))
        self.assertIn((line_of(text, "9 CYCL CALL"), "cycle-outside"), findings(payload))

    def test_cycle_25_has_its_own_surface_and_is_not_tied_to_cycle_20(self) -> None:
        text = "\n".join([
            HEADER,
            "2 TOOL CALL 1 Z S3000",
            contour_data(3, q5="+Q100"),
            "4 CYCL DEF 25 CONTOUR TRAIN ~",
            "  Q1=-20 ;MILLING DEPTH ~",
            "  Q3=+0 ;ALLOWANCE FOR SIDE ~",
            "  Q5=+0 ;SURFACE COORDINATE ~",
            "  Q7=+50 ;CLEARANCE HEIGHT ~",
            "  Q10=-5 ;PLUNGING DEPTH ~",
            "  Q11=100 ;FEED RATE FOR PLNGNG ~",
            "  Q12=350 ;FEED RATE F. ROUGHNG ~",
            "  Q15=-1 ;CLIMB OR UP-CUT",
            "5 CYCL CALL M3",
            "6 END PGM SL MM",
        ])
        payload = shift_z(text)
        self.assertIn("  Q7=+50.5 ;CLEARANCE HEIGHT ~", payload["text"].split("\n"))
        self.assertEqual([r for line, r in findings(payload) if line == line_of(text, "5 CYCL CALL")], [])

    def test_translate_refuses_the_contour_data_as_before(self) -> None:
        # The transforms read the parameter lines without the cycle; until they move Q5 and Q7
        # they refuse cycle 20 (it was an unknown cycle before Wave Y).
        payload = run("translate.py", sl_program(), {"dx": 0, "dy": 0, "dz": 0.5})
        self.assertIn((line_of(sl_program(), "6 CYCL DEF 20"), "cycle-position"), findings(payload))
        self.assertEqual(payload["text"], sl_program())


class T094PatternCycles(unittest.TestCase):
    """Cycle 220 runs the cycle defined last at a centre of its own."""

    def test_the_definition_and_the_pattern_are_left_together(self) -> None:
        payload = shift_z(PATTERN)
        got = findings(payload)
        self.assertIn((line_of(PATTERN, "5 CYCL DEF 220"), "cycle-position"), got)
        self.assertIn((line_of(PATTERN, "4 CYCL DEF 200"), "cycle-position"), got)
        # The surface of cycle 200 stays where cycle 220 stays: its Q203 replaces 200's anyway.
        self.assertNotIn("Q203=+30.5", payload["text"])
        self.assertIn("6 L Z+100.5 R0 FMAX", payload["text"])

    def test_expand_does_not_write_the_cycle_out_at_one_point(self) -> None:
        # Cycle 220 runs cycle 200 at eight points of its own: written out where the tool stands,
        # seven holes would be lost.
        text = PATTERN.replace("Q211=0.25 ;DWELL TIME AT DEPTH", "Q211=0 ;DWELL TIME AT DEPTH")
        payload = run("expand_cycles.py", text, {})
        self.assertEqual(payload["text"], text)
        self.assertTrue(any(f["severity"] == "error" and f["line"] == line_of(text, "5 CYCL DEF 220") for f in payload["findings"]), payload["findings"])

    def test_translate_refuses_the_pattern(self) -> None:
        payload = run("translate.py", PATTERN, {"dx": 1, "dy": 0, "dz": 0})
        self.assertEqual(payload["text"], PATTERN)
        self.assertTrue(any(r in ("cycle-position", "cycle-not-reviewed") for _, r in findings(payload)))


class T096ToolNames(unittest.TestCase):
    """QS18, the name of the roughing tool, is a value of cycle 22 and no position."""

    def test_a_tool_name_no_longer_refuses_the_cycle(self) -> None:
        text = sl_program(q18='QS18="ROUGHER 10" ;COARSE ROUGHING TOOL ~')
        payload = shift_z(text)
        self.assertNotIn("cycle-not-reviewed", [r for _, r in findings(payload)])
        self.assertIn("  Q5=+30.5 ;SURFACE COORDINATE ~", payload["text"].split("\n"))


class T107MacroCallWithoutP(unittest.TestCase):
    """G65 and G66 call the program P; without it the control stops with an alarm."""

    def rows(self, text: str, profile: str) -> List[Tuple[int, str]]:
        report = run("program_checks.py", text, {}, profile=profile)
        return [(row["line"], row["message"]) for row in report["rows"] if row["checkId"] == "requiredWords"]

    def test_a_missing_p_is_reported_on_both_fanuc_profiles(self) -> None:
        for profile in ("fanuc-gcode", "fanuc-lathe"):
            with self.subTest(profile=profile):
                text = "%\nO1000\nG65 A1.\nG66 A2.\nG67\nM30\n%"
                rows = self.rows(text, profile)
                self.assertEqual([line for line, _ in rows], [3, 4])
                self.assertIn("G65", rows[0][1])
                self.assertIn("P", rows[0][1])

    def test_a_call_with_p_is_fine(self) -> None:
        for profile in ("fanuc-gcode", "fanuc-lathe"):
            with self.subTest(profile=profile):
                self.assertEqual(self.rows("%\nO1000\nG65 P9010 A1.\nG66 P9011 A2.\nG67\nM30\n%", profile), [])


if __name__ == "__main__":
    unittest.main()
