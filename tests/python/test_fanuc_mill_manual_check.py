"""The Fanuc mill code data after the manual check (2026-10-25, decisions D6-2, D6-3, D6-8).

- **D6-2** ``G53.6`` (turn the tool axis to the tilted plane, tool tip kept) turns the rotary
  axes as ``G53.1`` does: after it and ``G69`` a shift is refused (``rotary-turned``) until the
  rotary axes are written again. It is no "alone" code (H, R and an end point go with it) and,
  like ``G53.1``, is taken only under a tilted plane.
- **D6-3** a tilted plane and tool centre point control may be on together: ``G68.2`` under
  ``G43.4`` and ``G43.4`` under ``G68.2`` raise no "refused in this state" warning.
- **D6-8** ``G68.2`` under a tool length offset still warns (the warning stays; the code's
  description says it depends on the machine).

Run: ``taskpolicy -b python3 -B -S -m unittest tests.python.test_fanuc_mill_manual_check``.
"""

from __future__ import annotations

import unittest
from typing import Any, Dict, List, Optional, Tuple

from tests.python import helpers

helpers.import_gedit_nc()

HEAD = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)"


def program(*lines: str) -> str:
    return "\n".join((HEAD,) + lines)


def run(script: str, text: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    context = helpers.effective_context("fanuc-gcode")
    context["params"] = dict(params or {})
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    out = helpers.run_script(script, text, context)
    if not out.ok:
        raise AssertionError("%s failed:\n%s" % (script, out.stderr[-2000:]))
    return out.json()


def errors(result: Dict[str, Any]) -> List[Tuple[int, str]]:
    return [(f["line"], f["reason"]) for f in result.get("findings") or [] if f.get("severity") == "error"]


def checks(text: str, check: str) -> List[Tuple[int, str]]:
    report = run("program_checks.py", text)
    return [(row["line"], row["message"]) for row in report["rows"] if row["checkId"] == check]


class G536Test(unittest.TestCase):
    TILT = program(
        "G21 G17 G40 G49 G80 G90 G94 G54",
        "G0 B0. C0.",
        "G0 X0. Y0. Z50.",
        "G68.2 X0 Y0 Z0 I0 J30. K0",
        "G53.6 H1",
        "G69",
        "G1 X20. Y5. F200.",
        "G0 B0. C0.",
        "G1 X30. Y5.",
        "M30",
    )

    def test_after_g53_6_and_g69_a_shift_is_refused_until_the_rotaries_are_written(self) -> None:
        result = run("translate.py", self.TILT, {"dx": 1, "dy": 2})
        found = errors(result)
        self.assertIn((8, "rotary-turned"), found)
        self.assertNotIn((10, "rotary-turned"), found)
        self.assertEqual([line for line, reason in found if reason == "unknown-code"], [])

    def test_g53_6_with_its_words_is_taken_under_a_tilted_plane(self) -> None:
        text = program("G21 G17 G40 G49 G80 G90 G94", "G68.2 X0 Y0 Z0 I0 J30. K0", "G53.6 H1 R10. X0 Y0 Z5.", "G69", "M30")
        self.assertEqual(checks(text, "aloneInBlock"), [])
        self.assertEqual(checks(text, "stateConflicts"), [])

    def test_g53_6_without_a_tilted_plane_warns(self) -> None:
        text = program("G21 G17 G40 G49 G80 G90 G94", "G53.6 H1", "M30")
        self.assertEqual([line for line, _ in checks(text, "stateConflicts")], [3])


class TiltAndTcpTest(unittest.TestCase):
    def test_a_tilted_plane_under_tool_centre_point_control_is_no_conflict(self) -> None:
        # G43.4 also switches a length offset on; since B2's half of D6-3 program_checks.py
        # tells the two apart: the offset of tool centre point control is no plain length
        # offset, so G68.2 under G43.4 gives no warning at all.
        text = program("G21 G17 G40 G49 G80 G90 G94", "G43.4 H1", "G68.2 X0 Y0 Z0 I0 J30. K0", "G69", "G49", "M30")
        self.assertEqual(checks(text, "stateConflicts"), [])

    def test_tool_centre_point_control_under_a_tilted_plane_is_no_conflict(self) -> None:
        text = program("G21 G17 G40 G49 G80 G90 G94", "G68.2 X0 Y0 Z0 I0 J30. K0", "G53.1", "G43.4 H1", "G49", "G69", "M30")
        self.assertEqual(checks(text, "stateConflicts"), [])
        text = text.replace("G43.4 H1", "G43.5 H1 I0 J0 K1.")
        self.assertEqual(checks(text, "stateConflicts"), [])

    def test_a_tilted_plane_under_a_tool_length_offset_still_warns(self) -> None:
        text = program("G21 G17 G40 G49 G80 G90 G94", "G43 H1 Z50.", "G68.2 X0 Y0 Z0 I0 J30. K0", "G69", "M30")
        self.assertEqual([line for line, _ in checks(text, "stateConflicts")], [4])


if __name__ == "__main__":
    unittest.main()
