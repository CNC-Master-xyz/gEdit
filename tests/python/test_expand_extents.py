"""X23, the extents half: the extents of an expanded program equal the extents of the program it
was expanded from (Phase 4 plan §5 P4.7, §6.3 rule 12; v1.2.0 P4.7b, T108).

For every case of ``tests/fixtures/scripts/expand_cycles/`` that writes a program, ``extents.py``
runs over the input and over ``expected.nc`` (a selection case: over the lines above it followed
by each) and the two reports agree on every row: the same scopes (the program, each work offset,
each tool), on every axis the same minimum, the same maximum and the same count of positions not
resolved; and the same kinds of finding. The line numbers are not compared: the expansion writes
more lines.

This holds because ``extents.py`` reads a drilling cycle the code database describes the way the
expansion writes it out (``_nc_cycles.holes_of``): the Klartext and Sinumerik depths measured from
the surface (``Q203 + Q201``, ``RFP - DPR`` with ``DP`` where ``DPR`` is 0), the Klartext
``CYCL CALL POS``, every hole of a Fanuc repeat count, and a Fanuc cycle under ``G91`` (``R`` from
the initial level, ``Z`` from the R point). ``test_expand_cycles.py`` compares the rows its input
resolves; this file asks for equality everywhere, so the cases P4.7 left out of its extents oracle
(``G91_CYCLES``) are in.

Run: ``taskpolicy -b python3 -B -S -m unittest tests.python.test_expand_extents`` (also with
``/usr/bin/python3``, the oldest Python gEdit supports).
"""

from __future__ import annotations

import copy
import unittest
from typing import Any, Dict, List, Tuple

from tests.python import helpers

#: The written cases this file must find, so a renamed or deleted golden fails loudly: the depth
#: rows of T108 (Klartext 200/201, Sinumerik `DP`/`DPR`) and the Fanuc `G91` cases.
REQUIRED = (
    "fanuc-g81-g98-g99",
    "fanuc-g81-incremental-repeat",
    "fanuc-g83-incremental",
    "klartext-200-calls",
    "klartext-201-reaming",
    "sinumerik-cycle81-mcall",
    "sinumerik-dp-dpr",
)

#: The rows the comparison reads (the machine positions are rows of their own, compared too).
COMPARED = ("min", "max", "unresolved")


def written_cases() -> List[helpers.GeometryCase]:
    return [case for case in helpers.geometry_cases("expand_cycles") if not case.refused]


def documents(case: helpers.GeometryCase) -> Tuple[str, str]:
    """The whole document before and after the expansion (a selection below its lines above)."""
    above = case.preceding_file.read_text(encoding="utf-8") if case.preceding_file is not None else ""
    return above + case.input_text(), above + case.expected_text()


def extents_of(text: str, case: helpers.GeometryCase) -> Dict[str, Any]:
    context = copy.deepcopy(helpers.geometry_context(case))
    context["params"] = {}
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    out = helpers.run_script("extents.py", stdin=text, context=context)
    if not out.ok:
        raise AssertionError("extents.py failed on %s: %s" % (case.name, out.stderr[-1500:]))
    return out.json()


def rows_of(report: Dict[str, Any]) -> Dict[Tuple[str, str, str], Tuple[Any, ...]]:
    return {
        (str(row.get("scope")), str(row.get("where")), str(row.get("axisId"))): tuple(row.get(key) for key in COMPARED)
        for row in report.get("rows", [])
    }


def kinds_of(report: Dict[str, Any]) -> List[str]:
    return sorted(str(finding.get("reason")) for finding in report.get("findings", []))


class ExtentsEqualityTest(unittest.TestCase):
    """X23: extents(original) == extents(expanded), for every written golden."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.cases = written_cases()
        cls.reports: Dict[str, Tuple[Dict[str, Any], Dict[str, Any]]] = {}

    def reports_of(self, case: helpers.GeometryCase) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """The extents of the document before and after the expansion, run once per case."""
        found = self.reports.get(case.name)
        if found is None:
            before_text, after_text = documents(case)
            found = self.reports[case.name] = (extents_of(before_text, case), extents_of(after_text, case))
        return found

    def test_the_cases_are_there(self) -> None:
        names = {case.name for case in self.cases}
        self.assertEqual(sorted(set(REQUIRED) - names), [])
        for prefix in ("fanuc-", "klartext-", "sinumerik-"):
            self.assertTrue(any(name.startswith(prefix) for name in names), prefix)

    def test_the_extents_of_the_expansion_are_the_extents_of_the_cycles(self) -> None:
        for case in self.cases:
            with self.subTest(case=case.name):
                before, after = self.reports_of(case)
                self.assertEqual(rows_of(after), rows_of(before))
                self.assertEqual(kinds_of(after), kinds_of(before))

    def test_the_depths_are_resolved(self) -> None:
        # T108: the depth of a described cycle is in the tool-axis range of the input, not
        # counted "not resolved" (the equality above would also hold if both were not resolved).
        for case in self.cases:
            with self.subTest(case=case.name):
                report = self.reports_of(case)[0]
                z = [row for row in report["rows"] if row.get("scope") == "program" and row.get("axisId") == "Z"]
                self.assertEqual(len(z), 1)
                self.assertEqual(z[0]["unresolved"], 0)
                self.assertNotIn("cycle", kinds_of(report))


if __name__ == "__main__":
    unittest.main()
