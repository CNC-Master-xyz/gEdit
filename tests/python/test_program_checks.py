"""The program checks script (plan section 6 M10, WP10.2; roadmap R7).

Golden cases in ``tests/fixtures/scripts/program_checks/<case>/`` (the folder's README pins
the report and the check ids), and rule tests built on the same runner. Standard library
only; run from the repository root::

    python3 -m unittest tests.python.test_program_checks

The members of the code databases and profiles that the checks read (``sets.spindle``,
``conflicts``, ``syntax.maxWordDigits`` ...) are pinned in
``tests/fixtures/scripts/program_checks/data-pins.json``; :class:`TestShippedData` holds the
shipped, resolved data to it.
"""

from __future__ import annotations

import json
import os
import re
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from tests.python import helpers

SCRIPT = "program_checks.py"
CASES_DIR = helpers.SCRIPT_FIXTURES_DIR / "program_checks"
PINS = helpers.load_json(CASES_DIR / "data-pins.json")

gedit_nc = helpers.import_gedit_nc()


# ---------------------------------------------------------------------------
# Running the script
# ---------------------------------------------------------------------------


def case_context(case: helpers.ScriptCase) -> Dict[str, Any]:
    """The context a golden case runs with: the effective profile and machine, as in
    ``test_tool_list.context_of``."""
    context = case.context()
    if isinstance(case.options.get("machine"), dict):
        effective = helpers.effective_context(golden=case.directory / "case.json")
    else:
        effective = helpers.effective_context(case.profile_id)
    context["profile"] = effective["profile"]
    context["codes"] = effective["codes"]
    context["machine"] = dict(effective["machine"])
    name = case.options.get("machineName")
    if isinstance(name, str) and name:
        context["machine"]["id"] = name.lower().replace(" ", "-")
        context["machine"]["name"] = name
    context.pop("machineName", None)
    # P4.10 (plan §6.4): a `limits` member is the machine's limits block, which the app puts
    # into `context.machine.limits` (`buildContext`); it changes no reading, so the case needs
    # no regenerated effective profile.
    limits = case.options.get("limits")
    if isinstance(limits, dict):
        context["machine"]["limits"] = limits
    context.pop("limits", None)
    context.pop("machine_params", None)
    return context


def run_text(
    text: str,
    profile_id: str = helpers.DEFAULT_PROFILE_ID,
    params: Optional[Dict[str, Any]] = None,
    preset: Optional[str] = None,
    variant: Optional[Any] = None,
    **overrides: Any
) -> Dict[str, Any]:
    """The report for ``text`` on a profile (its defaults: no machine), as a dictionary."""
    context = helpers.effective_context(profile_id, preset=preset, variant=variant)
    context["params"] = dict(params or {})
    lines = text.split("\n")
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
    context.update(overrides)
    result = helpers.run_script(SCRIPT, text, context)
    if not result.ok:
        raise AssertionError("program_checks failed:\n" + result.stderr)
    return result.json()


def findings(report: Dict[str, Any], check: Optional[str] = None) -> List[Dict[str, Any]]:
    rows = report["rows"]
    return [row for row in rows if check is None or row["checkId"] == check]


def ids(report: Dict[str, Any]) -> List[str]:
    return [row["checkId"] for row in report["rows"]]


def lines_of(report: Dict[str, Any], check: Optional[str] = None) -> List[int]:
    return [row["line"] for row in findings(report, check)]


def run_case(case: helpers.ScriptCase) -> Dict[str, Any]:
    result = helpers.run_script(SCRIPT, case.input_text(), case_context(case))
    if not result.ok:
        raise AssertionError("%s failed:\n%s" % (case.name, result.stderr))
    return result.json()


#: `UPDATE_PROGRAM_CHECKS=1` rewrites every `expected.json` from the script (review the diff).
UPDATE = os.environ.get("UPDATE_PROGRAM_CHECKS") == "1"


class TestGoldenCases(unittest.TestCase):
    """Every case folder: the whole report, rows, message and run notes."""

    def test_the_fixture_folder_holds_cases(self) -> None:
        self.assertGreaterEqual(len(helpers.script_cases("program_checks")), 30)

    def test_every_case_produces_its_expected_report(self) -> None:
        for case in helpers.script_cases("program_checks"):
            with self.subTest(case=case.name):
                report = run_case(case)
                if UPDATE:
                    case.expected_file.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    continue
                self.assertEqual(report, case.expected_json())

    def test_rows_are_ordered_by_line_and_then_by_check(self) -> None:
        order = {check_id: i for i, check_id in enumerate(check_ids())}
        for case in helpers.script_cases("program_checks"):
            rows = case.expected_json()["rows"]
            with self.subTest(case=case.name):
                keys = [(row["line"], order[row["checkId"]]) for row in rows]
                self.assertEqual(keys, sorted(keys))
                for row in rows:
                    self.assertIn(row["severity"], ("info", "warning", "error"))
                    self.assertEqual(sorted(row), ["check", "checkId", "line", "message", "severity"])

    def test_every_check_has_a_golden_row(self) -> None:
        seen = set()
        for case in helpers.script_cases("program_checks"):
            seen.update(row["checkId"] for row in case.expected_json()["rows"])
        self.assertEqual(sorted(set(check_ids()) - seen), [])


# ---------------------------------------------------------------------------
# The header, the check table and the README agree
# ---------------------------------------------------------------------------

#: `tomllib` reads the script header the way the backend does; it arrived in 3.11, and
#: the gate also runs on 3.9, where those checks are skipped rather than dropped.
HAS_TOMLLIB = __import__("sys").version_info >= (3, 11)


def script_module() -> Any:
    import importlib

    module = importlib.import_module("program_checks")
    return module


def check_ids() -> List[str]:
    return [check_id for check_id, _ in script_module().CHECKS]


def header_source() -> str:
    lines = (helpers.SCRIPTS_DIR / SCRIPT).read_text(encoding="utf-8").split("\n")
    i = 1 if lines[0].startswith("#!") else 0
    assert lines[i].strip() == "# /// gedit"
    body = []
    i += 1
    while lines[i].strip() != "# ///":
        assert lines[i].startswith("#"), lines[i]
        body.append(lines[i][2:] if lines[i].startswith("# ") else lines[i][1:])
        i += 1
    return "\n".join(body)


class TestHeader(unittest.TestCase):
    def test_the_three_m10_scripts_ask_for_five_minutes_not_the_default_minute(self) -> None:
        # G7 (M10): tokenizing and the modal state alone take about 30 s on a 300,000-line
        # program, so the checks, the extents and the arithmetic (which has the same walk)
        # would meet the 60 s default of `scripts.timeoutSeconds` on a slow or busy
        # machine. The header wins over the setting (m5-scripts-timeout, and `timeout_secs` in
        # runner.rs), so a long program still gets its answer; m10-perf judges the 300 s.
        for name in ("program_checks.py", "extents.py", "address_arithmetic.py"):
            text = (helpers.SCRIPTS_DIR / name).read_text(encoding="utf-8")
            head = text.split("# /// gedit\n", 1)[1].split("\n# ///\n", 1)[0]
            self.assertIn("\n# timeout = 300\n", "\n" + head + "\n", name)

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_the_header_is_the_toml_the_backend_expects(self) -> None:
        import tomllib

        meta = tomllib.loads(header_source())
        self.assertEqual(meta["name"], "Program checks")
        self.assertEqual(meta["output"], "report")
        self.assertEqual(meta["input"], "selection-or-document")
        self.assertNotIn("envelope", meta)
        self.assertNotIn("profiles", meta)  # every dialect: the data decides what runs

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_one_bool_per_check_all_on_in_the_order_of_the_check_table(self) -> None:
        import tomllib

        params = tomllib.loads(header_source())["params"]
        checks = script_module().CHECKS
        self.assertEqual([(p["id"], p["label"]) for p in params], checks)
        for param in params:
            with self.subTest(param=param["id"]):
                self.assertEqual(param["type"], "bool")
                self.assertIs(param["default"], True)
                self.assertTrue(param["help"])

    def test_the_readme_lists_the_checks_in_the_same_order(self) -> None:
        text = (CASES_DIR / "README.md").read_text(encoding="utf-8")
        listed = re.findall(r"^\| `([A-Za-z]+)` \| (?:info|warning|error)", text, re.M)
        self.assertEqual(listed, check_ids())


# ---------------------------------------------------------------------------
# Correct programs give no finding
# ---------------------------------------------------------------------------

EXIT_DIR = helpers.FIXTURES_DIR / "exit"
OWNER_PUBLIC = helpers.FIXTURES_DIR / "nc" / "owner-public"


def decode(path: Path) -> str:
    data = path.read_bytes()
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    return text.replace("\r\n", "\n").replace("\r", "\n")


#: The owner's public programs (fixtures, plan §9.2) and the rows each one gives, read
#: against the manuals: a thread cut under constant surface speed in both lathe posts (the
#: Okuma manual refuses it outright), a programmed stop, the reading of an Okuma program with
#: no machine chosen, and one tape marker with no closing one. Anything else is a check that
#: cries wolf. The 5-axis programs of 45 000 to 99 000 lines run in `TestLongPrograms`.
OWNER_ROWS = {
    "fanuc-gcode/2.5D_MILLING.NC": [],
    "fanuc-gcode/5-Axis.NC": [(1, "programFrame", "info")],
    "fanuc-lathe/TURN.NC": [(205, "threadUnderCss", "warning")],
    "fanuc-lathe/TURN_1.NC": [(208, "threadUnderCss", "warning")],
    "heidenhain-klartext/2.5D_MILLING.H": [],
    "heidenhain-klartext/5-Axis-1.H": [(8388, "stops", "info")],
    "heidenhain-klartext/DRILLING.H": [],
    "heidenhain-klartext/Demo_1.H": [],
    "okuma-osp/2.5D_MILLING.min": [(12, "machineReading", "info")],
    "okuma-osp/DRILLING.min": [(12, "machineReading", "info")],
    "okuma-osp/TURN.min": [(15, "machineReading", "info"), (201, "threadUnderCss", "warning")],
    "sinumerik/TURN_1.mpf": [],
    "sinumerik-mill/2.5D_Milling.mpf": [],
    "sinumerik-mill/DRILLING.mpf": [],
    "sinumerik-mill/Demo_1.mpf": [],
}


class TestCleanPrograms(unittest.TestCase):
    def test_the_exit_fixtures_give_no_row_and_no_note(self) -> None:
        for name, profile in (
            ("fanuc-cp1252-crlf.nc", "fanuc-gcode"),
            ("fanuc-utf8-lf-packed-nul.nc", "fanuc-gcode"),
            ("klartext-utf8bom-crlf.h", "heidenhain-klartext"),
        ):
            with self.subTest(name=name):
                report = run_text(decode(EXIT_DIR / name), profile)
                self.assertEqual(report["rows"], [])
                self.assertEqual(report["findings"], [])

    def test_the_owner_public_programs_give_only_the_rows_read_against_the_manuals(self) -> None:
        for relative, expected in OWNER_ROWS.items():
            path = OWNER_PUBLIC / relative
            with self.subTest(program=relative):
                report = run_text(decode(path), relative.split("/")[0])
                self.assertEqual([(r["line"], r["checkId"], r["severity"]) for r in report["rows"]], expected)
                self.assertEqual(report["findings"], [])

    def test_every_owner_public_program_is_in_the_table(self) -> None:
        listed = set(OWNER_ROWS) | set(LONG_PROGRAMS)
        present = {"%s/%s" % (p.parent.name, p.name) for p in OWNER_PUBLIC.glob("*/*") if p.is_file()}
        self.assertEqual(sorted(present - listed), [])


#: The long owner-public programs. They run only with `PROGRAM_CHECKS_LONG=1`: a minute or
#: more each in the subprocess on a slow machine, and the short programs hold the same rules.
LONG_PROGRAMS = {
    "fanuc-gcode/5X_MILLING.NC": [],
    "heidenhain-klartext/5X_MILLING.H": [],
    "heidenhain-klartext/5X_MILLING_VECTOR.H": [],
    "okuma-osp/5X_MILLING.min": [(13, "machineReading", "info")],
    "sinumerik-mill/5X_Milling.mpf": [],
}


@unittest.skipUnless(os.environ.get("PROGRAM_CHECKS_LONG") == "1", "set PROGRAM_CHECKS_LONG=1")
class TestLongPrograms(unittest.TestCase):
    def test_the_long_owner_public_programs(self) -> None:
        mod = script_module()
        for relative, expected in LONG_PROGRAMS.items():
            with self.subTest(program=relative):
                text = decode(OWNER_PUBLIC / relative)
                context = helpers.effective_context(relative.split("/")[0])
                lines = text.split("\n")
                context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
                run = mod.Run(context, lines)
                mod.walk(run)
                rows = sorted(run.rows, key=lambda r: (r[0], r[1], r[2]))
                self.assertEqual([(r[3]["line"], r[3]["checkId"], r[3]["severity"]) for r in rows], expected)


# ---------------------------------------------------------------------------
# Rules a golden alone does not prove
# ---------------------------------------------------------------------------

MARK = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)"


def program(*lines: str) -> str:
    return "\n".join((MARK,) + lines) + "\n"


class TestSpindle(unittest.TestCase):
    def test_a_rapid_written_f_max_is_a_rapid_as_fmax_is(self) -> None:
        # The owner's Klartext posts write `L A+0 C+0 R0 F MAX M126` with the spindle stopped.
        def rows(move: str) -> List[int]:
            text = program("0 BEGIN PGM T MM", "1 TOOL CALL 1 Z S3000", "2 M5", move, "9 END PGM T MM")
            return lines_of(run_text(text, "heidenhain-klartext"), "spindleOff")

        self.assertEqual(rows("3 L X+10 R0 F MAX"), [])
        self.assertEqual(rows("3 L X+10 R0 FMAX"), [])
        self.assertEqual(rows("3 L X+10 R0 F200"), [5])

    def test_an_m_code_the_database_does_not_know_makes_the_spindle_state_unknown(self) -> None:
        # M123 may be a builder's spindle start: the cut after it is not judged.
        text = program("O1", "S1000 M3", "G1 X10. F100.", "M5", "M123", "G1 X20.", "M30")
        self.assertEqual(lines_of(run_text(text), "spindleOff"), [])
        without = program("O1", "S1000 M3", "G1 X10. F100.", "M5", "G1 X20.", "M30")
        self.assertEqual(lines_of(run_text(without), "spindleOff"), [6])

    def test_a_program_that_starts_no_spindle_is_a_subprogram_and_not_blamed(self) -> None:
        sub = program("O2", "G91 G1 Z-2. F300.", "X20.", "G90", "M99")
        self.assertEqual(findings(run_text(sub)), [])
        main = program("O1", "G1 Z-2. F300.", "S1000 M3", "X20.", "M30")
        self.assertEqual(lines_of(run_text(main), "spindleOff"), [3])

    def test_a_rapid_with_the_spindle_stopped_is_no_cut(self) -> None:
        text = program("O1", "S1000 M3", "G1 X10. F100.", "M5", "G0 Z50.", "G28 G91 Z0.", "M30")
        self.assertEqual(findings(run_text(text)), [])

    def test_a_turret_change_does_not_stop_the_spindle(self) -> None:
        text = program("O1", "G50 S2000", "T0101", "G96 S200 M3", "G1 X40. Z-5. F0.2", "T0202", "G1 X30. Z-10. F0.2", "M30")
        self.assertEqual(ids(run_text(text, "fanuc-lathe")), [])

    def test_without_the_data_the_spindle_is_not_checked_and_the_report_says_so(self) -> None:
        text = program("O1", "T1 M6", "G1 X10. F100.", "M30")
        # A database that does not say which code starts the spindle or moves at rapid: a
        # user database that lacks the `sets` members.
        context = helpers.effective_context("fanuc-gcode")
        for entry in context["codes"]:
            sets = {k: v for k, v in (entry.get("sets") or {}).items() if k not in ("spindle", "toolSpindle", "motion")}
            if sets:
                entry["sets"] = sets
            else:
                entry.pop("sets", None)
        lines = text.split("\n")
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
        result = helpers.run_script(SCRIPT, text, context)
        self.assertTrue(result.ok, result.stderr)
        report = result.json()
        self.assertEqual(lines_of(report, "toolChangeSpindle"), [])
        self.assertEqual(len(report["findings"]), 1)
        self.assertIn("does not say which codes start and stop the spindle", report["findings"][0]["message"])
        self.assertEqual(lines_of(run_text(text), "toolChangeSpindle"), [4])

    def test_a_check_switched_off_writes_no_row(self) -> None:
        text = program("O1", "T1 M6", "G1 X10. F100.", "M30")
        self.assertEqual(lines_of(run_text(text, params={"toolChangeSpindle": False})), [])


class TestReferenceProgram(unittest.TestCase):
    """P4d (plan §6.6 rule 8): a reference rule whose ``program`` is ``called`` or ``caller``
    names a block of another program (``M98 P1000 Q30``, ``M99 P30``). Its value is never a
    jump inside the program it stands in, so the jump check does not look for it there,
    also when the rule no longer says ``rewrite: false``."""

    TEXT = program("O1", "N10 G0 X0.", "N20 M99 P30")

    def report_with(self, member: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        context = helpers.effective_context("fanuc-gcode")
        profile = json.loads(json.dumps(context["profile"]))
        rules = profile["numbering"]["references"]
        returns = [rule for rule in rules if "99" in rule["trigger"]]
        self.assertEqual(len(returns), 1, "the Fanuc profile has one M99 P rule")
        returns[0].pop("rewrite", None)
        # Since P4.19 the shipped rule says `program: caller`; `None` means "no member".
        returns[0].pop("program", None)
        if member is not None:
            returns[0].update(member)
        return run_text(self.TEXT, "fanuc-gcode", profile=profile)

    def test_a_return_into_the_caller_is_not_looked_for_in_its_own_program(self) -> None:
        self.assertEqual(lines_of(self.report_with({"program": "caller"}), "jumpTargets"), [])

    def test_a_rule_that_names_its_own_program_is_still_a_jump(self) -> None:
        # The control the test above needs: without `program` the same rule is a local jump,
        # and N30 is missing from O1.
        self.assertEqual(lines_of(self.report_with(None), "jumpTargets"), [4])
        self.assertEqual(lines_of(self.report_with({"program": "own"}), "jumpTargets"), [4])


class TestUnclosedStringsAndBrackets(unittest.TestCase):
    """B1: an unclosed string or ``[`` runs to the end of its line in both tokenizers and in
    the mask, and the report says so in plain words, never as a stray ``)`` of the comment
    the bracket swallowed."""

    def messages(self, profile_id: str, *lines: str) -> List[Tuple[int, str]]:
        report = run_text(program(*lines), profile_id)
        return [(row["line"], row["message"]) for row in findings(report, "brackets")]

    def test_an_unclosed_bracket_with_a_comment_behind_it_on_fanuc(self) -> None:
        self.assertEqual(
            self.messages("fanuc-gcode", "O1", "#1=[#2+1 (NOTE)", "#3=[#4 (A) +1] (B)", "G1 X10)", "M30"),
            [
                (3, "#1=[#2+1 (NOTE): a [ is opened and not closed on its line"),
                (5, "G1 X10): a ) with no ( before it"),
            ],
        )

    def test_two_unclosed_brackets_are_counted(self) -> None:
        self.assertEqual(
            self.messages("fanuc-gcode", "O1", "#1=[[#2+1", "M30"),
            [(3, "#1=[[#2+1: 2 [ are opened and not closed on its line")],
        )

    def test_an_unclosed_bracket_and_string_on_sinumerik(self) -> None:
        self.assertEqual(
            self.messages("sinumerik", "R1=[R2+3 ;NOTE", 'MSG("A;B', "R1=(R2+3", "M30"),
            [
                (2, "R1=[R2+3 ;NOTE: a [ is opened and not closed on its line"),
                (3, 'MSG("A;B: a string is opened with " and not closed on its line'),
                (4, "R1=(R2+3: a ( is opened and not closed on its line"),
            ],
        )

    def test_an_unclosed_string_on_klartext(self) -> None:
        self.assertEqual(
            self.messages("heidenhain-klartext", "0 BEGIN PGM T MM", '1 TOOL CALL "D10 Z S1000 ; NOTE', "2 END PGM T MM"),
            [(3, '1 TOOL CALL "D10 Z S1000 ; NOTE: a string is opened with " and not closed on its line')],
        )


class TestToolWordsAndMoves(unittest.TestCase):
    def test_a_fanuc_lathe_tool_word_with_or_without_its_leading_zero_is_one_form(self) -> None:
        # The tool rule takes 1 to 5 digits: T101 and T0101 are the same station and offset.
        text = program("O1", "G50 S2000", "T0101", "G96 S200 M3", "G1 X40. Z-5. F0.2", "T101", "G1 X30. F0.2", "M30")
        self.assertEqual(lines_of(run_text(text, "fanuc-lathe"), "toolWordFormat"), [])

    def test_an_undescribed_tool_word_is_reported_only_where_the_machine_states_the_form(self) -> None:
        # A machining-centre program opened with the lathe profile writes `T1 M6` (R7, R9).
        text = "\n".join(["O1", "T1 M6", "S1000 M3", "G1 X10 F100", "M02"])
        self.assertEqual(lines_of(run_text(text, "okuma-osp"), "toolWordFormat"), [])

    def test_a_six_digit_okuma_tool_word_under_three_digit_offsets_is_reported(self) -> None:
        # T086, owner 2026-10-22: under the three-digit-offset reading a six-digit word is no
        # tool change, and the machine states that form, so Check Program says so.
        text = "\n".join(["O0103", "G00 T2000", "G01 Z-20. F0.2", "G00 T010101", "G01 Z-30. F0.15", "M02"])
        report = run_text(text, "okuma-osp", variant=("toolWord", "offset3"))
        self.assertEqual(
            [(row["line"], row["message"]) for row in findings(report, "toolWordFormat")],
            [(4, "T010101: not a tool word this machine's tool-word format describes (6 digits)")],
        )

    def test_a_klartext_path_keyword_without_its_own_words_moves_nothing(self) -> None:
        text = "\n".join(
            [
                "0 BEGIN PGM K MM",
                "1 TOOL CALL 1 Z S3000",
                "2 L Z+50 R0 FMAX M3",
                "3 M5",
                "4 L R0 F500",
                "5 LP PR+10 PA+45 F300",
                "6 END PGM K MM",
            ]
        )
        self.assertEqual(lines_of(run_text(text, "heidenhain-klartext"), "spindleOff"), [6])


class TestConflicts(unittest.TestCase):
    def test_a_conflict_is_judged_after_the_other_codes_of_its_block(self) -> None:
        on = program("O1", "T1 M6", "S1000 M3", "G41 D1 G1 X5. Y5. F500.", "G68.2 X0 Y0 Z0 I0 J45. K0", "M30")
        self.assertEqual(lines_of(run_text(on), "stateConflicts"), [6])
        same_block = program("O1", "T1 M6", "S1000 M3", "G41 D1 G1 X5. Y5. F500.", "G40 G68.2 X0 Y0 Z0 I0 J45. K0", "M30")
        self.assertEqual(lines_of(run_text(same_block), "stateConflicts"), [])
        written_with = program("O1", "T1 M6", "S1000 M3", "G41 G68.2 X0 Y0 Z0 I0 J45. K0", "M30")
        self.assertEqual(lines_of(run_text(written_with), "stateConflicts"), [5])

    def test_an_okuma_plane_change_under_nose_radius_compensation_is_reported(self) -> None:
        # B1 fix NC (NC-09, owner question 15): OSP-P200L, cutter radius compensation: G17, G18
        # or G119 written while G41/G42 is in force is an alarm.
        text = program("O1", "G0 X50. Z5.", "G41 G1 X40. Z0 F0.2", "G17", "G40 G0 X60. Z5.", "G18", "M02")
        # Line 1 is the marker: the G17 under G41 is line 5; the G18 after G40 is no conflict.
        self.assertEqual(lines_of(run_text(text, "okuma-osp"), "stateConflicts"), [5])
        for code in ("G18", "G119"):
            text = program("O1", "G0 X50. Z5.", "G42 G1 X40. Z0 F0.2", code, "G40 G0 X60. Z5.", "M02")
            self.assertEqual(lines_of(run_text(text, "okuma-osp"), "stateConflicts"), [5], code)

    def test_nc_5_an_okuma_turret_wait_under_nose_radius_compensation_is_reported(self) -> None:
        # D2-4 (b): OSP-P300 programming manual, simultaneous machining: M100 during nose radius
        # compensation is an alarm. The second M100, after G40, is no conflict.
        text = program("O1", "G13", "G42 G1 X40. Z0 F0.2", "M100", "G40 G0 X100.", "G14", "M100", "M02")
        rows = findings(run_text(text, "okuma-osp"), "stateConflicts")
        self.assertEqual([(r["line"], r["severity"]) for r in rows], [(5, "warning")])
        self.assertEqual(rows[0]["message"], "M100: the control refuses it while radius compensation is on (G42, line 4)")

    def test_code_10_a_negated_code_condition_names_the_code(self) -> None:
        # `!code:G68`: the code is taken only while G68 is in force; the sentence names G68,
        # never the raw condition text.
        context = helpers.effective_context("fanuc-gcode")
        codes = json.loads(json.dumps(context["codes"]))
        for entry in codes:
            if entry.get("code") == "G69":
                entry["conflicts"] = ["!code:G68"]
        rows = findings(run_text(program("O1", "T1 M6", "S1000 M3", "G69", "M30"), codes=codes), "stateConflicts")
        self.assertEqual([r["line"] for r in rows], [5])
        self.assertIn("only while G68 is in force", rows[0]["message"])
        self.assertNotIn("code:", rows[0]["message"])

    def test_the_frame_a_code_opens_itself_is_not_its_own_conflict(self) -> None:
        text = program("O1", "T1 M6", "S1000 M3", "G68.2 X0 Y0 Z0 I0 J45. K0", "G53.1", "G69", "M30")
        self.assertEqual(lines_of(run_text(text), "stateConflicts"), [])


class TestManualCheckLathe(unittest.TestCase):
    """The manual-check fix round, batch B2 (owner decisions of 2026-10-25)."""

    def test_d5_5_a_block_without_a_move_under_a_single_pass_runs_it_again(self) -> None:
        # An empty block, or one with only M, S or T, while G90 is in force: the control runs
        # the pass again (with the M, S or T function).
        text = program("O1", "G50 S2000", "G96 S180 M3", "G0 X62. Z2.", "G90 X56. Z-30. F0.25", "X52.", "M8", "", "T0100", "S150", "G0 X100. Z100.", "M5", "M30")
        self.assertEqual(lines_of(run_text(text, "fanuc-lathe"), "passRepeat"), [8, 9, 10, 11])
        # G00 or G01 before it ends the pass mode; nothing is reported then.
        text = program("O1", "G50 S2000", "G96 S180 M3", "G0 X62. Z2.", "G90 X56. Z-30. F0.25", "G0 X100. Z100.", "M8", "M30")
        self.assertEqual(lines_of(run_text(text, "fanuc-lathe"), "passRepeat"), [])

    def test_d5_5_a_one_shot_code_clears_the_pass_and_a_dwell_runs_none(self) -> None:
        # A one-shot code other than a dwell clears the values the passes share: the next empty
        # block runs nothing. A dwell block runs no pass but leaves the values.
        text = program("O1", "G0 X62. Z2.", "G94 X20. Z-1. F0.2", "G50 S1800", "M8", "G0 X100.", "M30")
        self.assertEqual(lines_of(run_text(text, "fanuc-lathe"), "passRepeat"), [])
        text = program("O1", "G0 X62. Z2.", "G92 X39.2 Z-20. F1.5", "G4 X0.5", "M9", "G0 X100.", "M30")
        self.assertEqual(lines_of(run_text(text, "fanuc-lathe"), "passRepeat"), [6])
        # A block that writes only the taper runs the pass again on purpose; F alone runs it too
        # (NC-2, owner 2026-10-26), so that block warns.
        text = program("O1", "G0 X62. Z2.", "G90 X56. Z-30. R-2. F0.25", "R-3.", "F0.2", "G0 X100.", "M30")
        self.assertEqual(lines_of(run_text(text, "fanuc-lathe"), "passRepeat"), [6])

    def test_nc_2_a_feed_or_a_modal_code_alone_runs_the_pass_again(self) -> None:
        # 0i-F Plus lathe manual, restrictions on canned cycles: a block with no move command
        # runs the single pass again; the decision of 2026-10-26 widens D5-5 to F alone and to
        # blocks of modal codes. A dwell runs none, a one-shot code clears the pass.
        for block in ("F0.15", "G40", "G97", "G99", "G96 S200", "G40 M8"):
            with self.subTest(block=block):
                text = program("O1", "G0 X62. Z2.", "G90 X56. Z-30. F0.25", block, "G0 X100.", "M30")
                rows = findings(run_text(text, "fanuc-lathe"), "passRepeat")
                self.assertEqual([r["line"] for r in rows], [5])
                self.assertTrue(rows[0]["message"].startswith("%s: the single pass G90 is still in force" % block), rows[0]["message"])
        for block in ("G04 X1.", "G50 S2000", "G28 U0"):
            with self.subTest(block=block):
                text = program("O1", "G0 X62. Z2.", "G90 X56. Z-30. F0.25", block, "G0 X100.", "M30")
                self.assertEqual(lines_of(run_text(text, "fanuc-lathe"), "passRepeat"), [])

    def test_nc_7_okuma_thread_cycles_are_not_judged_as_fanuc_single_passes(self) -> None:
        # The rule is the Fanuc lathe's; no Okuma source says a block without a move runs the
        # fixed thread cycle G33 again, so neither M08 nor an empty line warns there.
        text = program("O1", "G00 X40. Z5.", "G33 X38.5 Z-20. F1.5", "M08", "", "(NEXT PASS)", "X38.", "F1.5", "G00 X100.", "M02")
        self.assertEqual(lines_of(run_text(text, "okuma-osp", preset="okuma-1mm"), "passRepeat"), [])
        # On the Fanuc lathe the blank line and the comment-only line still warn (an EOB-only block).
        text = program("O1", "G0 X62. Z2.", "G90 X56. Z-30. F0.25", "", "X52.", "(NEXT PASS)", "G0 X100.", "M30")
        self.assertEqual(lines_of(run_text(text, "fanuc-lathe"), "passRepeat"), [5, 7])

    def test_code_12_a_word_of_neither_tool_word_form_is_no_form(self) -> None:
        # A rule with two forms (3 to 5 digits, and 7 digits) whose ignore pattern also takes
        # the one-digit `T0`: that word is of neither form. Its length (1) is no form index, so
        # it neither warns as a mix nor hides the real mix of the 7-digit word after it.
        context = helpers.effective_context("okuma-osp", variant=("toolWord", "offset3"))
        profile = json.loads(json.dumps(context["profile"]))
        profile["toolCall"]["ignore"] = "(?<![A-Z])T0(?!\\d)|" + profile["toolCall"]["ignore"]
        text = "\n".join(["O0103", "G00 T100", "G01 Z-20. F0.2", "T0", "G00 T0102003", "G01 Z-30. F0.15", "M02"])
        rows = findings(run_text(text, "okuma-osp", variant=("toolWord", "offset3"), profile=profile), "toolWordFormat")
        self.assertEqual([(r["line"], r["message"]) for r in rows], [(5, "T0102003: a 7-digit tool word after 3-digit ones (line 2); one file should keep to one form")])

    def test_d5_5_in_g_code_system_b_too(self) -> None:
        text = program("O1", "G0 X62. Z2.", "G77 X56. Z-30. F0.25", "M5", "G0 X100.", "M30")
        self.assertEqual(lines_of(run_text(text, "fanuc-lathe", variant=("gcodeSystem", "B")), "passRepeat"), [5])
        # A mill has no single pass: nothing.
        self.assertEqual(lines_of(run_text(program("O1", "G90 G0 X10. Y10.", "M8", "M30")), "passRepeat"), [])

    def test_d5_4_a_program_in_g_code_system_c_is_named_once(self) -> None:
        text = program("O1", "G71", "G0 X62. Z2.", "G20 X56. Z-30. F0.25", "G0 X100.", "M30")
        rows = findings(run_text(text, "fanuc-lathe"), "gcodeSystemC")
        self.assertEqual([(r["line"], r["severity"]) for r in rows], [(3, "warning")])
        self.assertIn("G-code system C", rows[0]["message"])
        text = program("O1", "G0 X62. Z2.", "G20 X56. Z-30. F0.25", "G0 X100.", "M30")
        rows = findings(run_text(text, "fanuc-lathe"), "gcodeSystemC")
        self.assertEqual([r["line"] for r in rows], [4])
        self.assertIn("G20 written with X and Z and F", rows[0]["message"])
        # A system-A program: G71 with its words, G21 alone, G70 with P and Q.
        text = program(
            "O1", "G21 G40 G99", "G0 X62. Z2.", "G71 U1.5 R0.5", "G71 P10 Q20 U0.2 W0.1 F0.25",
            "N10 G0 X40.", "G1 Z-20.", "N20 X62.", "G70 P10 Q20", "G0 X100.", "M30",
        )
        self.assertEqual(lines_of(run_text(text, "fanuc-lathe"), "gcodeSystemC"), [])
        # A profile with no G-code systems says nothing.
        self.assertEqual(lines_of(run_text(program("O1", "G71", "M30")), "gcodeSystemC"), [])

    def test_d3_4a_a_tool_changer_lathe_describes_its_tool_words(self) -> None:
        # With `toolChange: atc` the trigger is M6; the tool words are still described by the
        # tool rule, so a stated tool word format does not warn on every T word.
        context = helpers.effective_context("fanuc-lathe", variant=("toolChange", "atc"))
        machine = json.loads(json.dumps(context["machine"]))
        machine["source"]["variants"]["toolWord"] = "machine"
        text = program("O1", "T0101", "M6", "G50 S2000", "G96 S180 M3", "G0 X62. Z2.", "G1 Z-10. F0.2", "T123456 M6", "M30")
        rows = findings(run_text(text, "fanuc-lathe", variant=("toolChange", "atc"), machine=machine), "toolWordFormat")
        self.assertEqual([(r["line"], r["message"]) for r in rows], [(9, "T123456: not a tool word this machine's tool-word format describes (6 digits)")])

    def test_d3_4c_a_t_on_the_m6_line_that_is_the_next_tool_never_says_same_tool(self) -> None:
        # v1.2.0 manual-check fix round (D3-4c): under "T on the M6 line is the next tool" the
        # second `M6 T2` loads tool 2 (preselected by the first), so the spindle stops there.
        text = program("O1", "T1", "M6 T2", "S1000 M3", "G1 X10. F100.", "M6 T2", "G1 X20.", "M30")
        self.assertEqual(lines_of(run_text(text), "toolChangeSpindle"), [])
        rows = lines_of(run_text(text, variant=("toolOnChangeLine", "next")), "toolChangeSpindle")
        self.assertEqual(len(rows), 1)

    def test_d6_3_shipped_tool_centre_point_and_rotation_refuse_each_other_in_both_orders(self) -> None:
        # Integration of D6-3: the shipped G43.4/G43.5 name `code:G68`; G68 names `tcp`. So
        # G68 then G43.4 and G43.4 then G68 both warn, while the tilted plane G68.2 meets
        # neither (B1 dropped its tcp conflict).
        rows = lambda *lines: lines_of(run_text(program("O1", "T1 M6", "S1000 M3", *lines, "M30")), "stateConflicts")  # noqa: E731
        for tcp in ("G43.4 H1", "G43.5 H1"):
            with self.subTest(tcp=tcp):
                self.assertEqual(rows("G68 X0 Y0 R30.", tcp, "G49", "G69"), [6])
                self.assertEqual(rows(tcp, "G68 X0 Y0 R30.", "G69", "G49"), [6])
                self.assertEqual(rows("G68.2 X0 Y0 Z0 I0 J45. K0", tcp, "G49", "G69"), [])
                self.assertEqual(rows(tcp, "G68.2 X0 Y0 Z0 I0 J45. K0", "G69", "G49"), [])

    def test_g68_4_tilts_again_under_g68_2_without_a_warning(self) -> None:
        # 30i-B operator's manual 22.6.2.2: G68.4 sets a feature coordinate system on top of the
        # one in force, so it is written under G68.2; under the rotation G68 it still warns.
        rows = lambda *lines: lines_of(run_text(program("O1", "T1 M6", "S1000 M3", *lines, "M30")), "stateConflicts")  # noqa: E731
        self.assertEqual(rows("G68.2 X0 Y0 Z0 I0 J90. K0", "G53.1", "G68.4 X0 Y0 Z0 I90. J90. K-90.", "G53.1", "G69"), [])
        self.assertEqual(rows("G68 X0 Y0 R30.", "G68.4 X0 Y0 Z0 I90. J90. K-90.", "G69"), [6])

    def test_d3_2_each_run_of_tool_word_lengths_is_one_form(self) -> None:
        # Handed over by batch B3: a rule that reads 3, 4, 5 and 7 digits (Okuma three-digit
        # offsets) has two forms, without and with a nose-radius set; 3 to 5 digits are one form
        # (leading zeros optional), so only the 7-digit word after them is the mix.
        text = "\n".join(["O0103", "G00 T100", "G01 Z-20. F0.2", "G00 T2000", "G01 Z-30. F0.15", "G00 T0102003", "M02"])
        rows = findings(run_text(text, "okuma-osp", variant=("toolWord", "offset3")), "toolWordFormat")
        self.assertEqual([(r["line"], r["message"]) for r in rows], [(6, "T0102003: a 7-digit tool word after 3-digit ones (line 2); one file should keep to one form")])

    def test_d6_3_a_tool_centre_point_offset_is_no_plain_length_offset(self) -> None:
        # Handed over by batch B1: the lengthComp condition of G68.2 is not met by G43.4, whose
        # offset is tool centre point control; under G43 the sentence says it is machine-dependent.
        text = program("O1", "T1 M6", "S1000 M3", "G43 H1 Z100.", "G68.2 X0 Y0 Z0 I0 J45. K0", "G69", "M30")
        rows = findings(run_text(text), "stateConflicts")
        self.assertEqual([r["line"] for r in rows], [6])
        self.assertIn("unless your control allows a tilted plane under tool length compensation", rows[0]["message"])
        text = program("O1", "T1 M6", "S1000 M3", "G43.4 H1", "G68.2 X0 Y0 Z0 I0 J45. K0", "G69", "M30")
        rows = findings(run_text(text), "stateConflicts")
        self.assertFalse(any("tool length offset" in r["message"] for r in rows), rows)

    def test_d6_3_a_code_condition_names_one_code(self) -> None:
        # `code:G68`: G68 itself in force, not G68.2, which shares its frame group.
        context = helpers.effective_context("fanuc-gcode")
        codes = json.loads(json.dumps(context["codes"]))
        for entry in codes:
            if entry.get("code") == "G43.4":
                entry["conflicts"] = ["code:G68"]
        rows = lambda *lines: lines_of(run_text(program(*lines), codes=codes), "stateConflicts")  # noqa: E731
        self.assertEqual(rows("O1", "T1 M6", "S1000 M3", "G68 X0 Y0 R30.", "G43.4 H1", "G49", "G69", "M30"), [6])
        self.assertEqual(rows("O1", "T1 M6", "S1000 M3", "G68.2 X0 Y0 Z0 I0 J45. K0", "G43.4 H1", "G49", "G69", "M30"), [])


class TestToolChangeInCycle(unittest.TestCase):
    """The cycle must have been in force before the block with the tool word (two owner lathe
    posts write a tool word in the block that starts a thread cycle)."""

    def rows(self, *lines: str, profile: str = "fanuc-gcode") -> List[int]:
        return lines_of(run_text(program("O1", "S500 M3", *lines, "M30"), profile), "toolChangeInCycle")

    def test_a_tool_change_after_the_cycle_started_is_reported(self) -> None:
        self.assertEqual(self.rows("G81 X0. Y0. Z-5. R2. F100.", "T2 M6", "X10."), [5])

    def test_the_block_that_starts_the_cycle_is_no_tool_change_inside_it(self) -> None:
        self.assertEqual(self.rows("T2 M6 G81 X0. Y0. Z-5. R2. F100.", "X10.", "G80"), [])

    def test_the_block_that_cancels_the_cycle_is_none_either(self) -> None:
        self.assertEqual(self.rows("G81 X0. Y0. Z-5. R2. F100.", "G80 T2 M6"), [])


class TestRigidTapping(unittest.TestCase):
    """`M29` is a tapping call only when a tapping cycle follows it (found on the owner's lathe
    programs at the M10 integration: an M number that means something else there, and a tapping
    cycle hundreds of lines later, made twelve errors in a correct program)."""

    def rows(self, *lines: str) -> List[int]:
        return lines_of(run_text(program("O1", "T1 M6", "S500 M3", *lines, "M30")), "rigidTapping")

    def test_a_speed_between_the_call_and_the_cycle_is_reported_at_the_speed(self) -> None:
        self.assertEqual(self.rows("M29 S500", "S600", "G84 Z-10. R2. F750."), [6])

    def test_a_move_between_the_call_and_the_cycle_is_reported_at_the_move(self) -> None:
        self.assertEqual(self.rows("M29 S500", "G0 X10.", "G84 Z-10. R2. F750."), [6])

    def test_no_cycle_after_the_call_no_finding(self) -> None:
        self.assertEqual(self.rows("M29 S500", "G0 X10.", "G1 X20. F100."), [])

    def test_a_tool_call_ends_the_call_before_a_later_cycle(self) -> None:
        self.assertEqual(self.rows("M29", "G0 X10.", "T2 M6", "G0 X20.", "G84 Z-10. R2. F750."), [])

    def test_a_new_call_announces_the_cycle_itself(self) -> None:
        self.assertEqual(self.rows("M29", "G0 X10.", "M29 S500", "G84 Z-10. R2. F750."), [])

    def test_the_call_with_its_cycle_next_is_clean(self) -> None:
        self.assertEqual(self.rows("M29 S500", "G84 Z-10. R2. F750.", "G80"), [])


class TestSelectionPriming(unittest.TestCase):
    """A selection is the middle of a sentence: the lines above it decide the state."""

    ABOVE = [MARK, "%", "O1", "T1 M6", "S1000 M3", "G1 X0. F100.", "M5"]
    SELECTED = ["G1 X10.", "X20.", "M30"]

    def context(self, primed: bool) -> Dict[str, Any]:
        context = helpers.effective_context("fanuc-gcode")
        start = len(self.ABOVE) + 1
        context["input"] = {"scope": "selection", "startLine": start, "endLine": start + len(self.SELECTED) - 1}
        if primed:
            context["input"]["precedingLines"] = list(self.ABOVE)
        return context

    def report(self, primed: bool) -> Dict[str, Any]:
        result = helpers.run_script(SCRIPT, "\n".join(self.SELECTED), self.context(primed))
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_a_stop_above_the_selection_is_in_force_in_it(self) -> None:
        report = self.report(True)
        self.assertEqual(lines_of(report, "spindleOff"), [8])
        self.assertIn("M5 on line 7", findings(report, "spindleOff")[0]["message"])

    def test_without_the_lines_above_the_state_is_not_known_and_nothing_is_guessed(self) -> None:
        report = self.report(False)
        self.assertEqual(lines_of(report, "spindleOff"), [])
        self.assertTrue(any("were not sent" in f["message"] for f in report["findings"]))

    def test_a_selection_never_judges_the_program_frame(self) -> None:
        report = self.report(True)
        self.assertEqual(lines_of(report, "programFrame"), [])
        self.assertTrue(any("need the whole program" in f["message"] for f in report["findings"]))


class TestProgramStructure(unittest.TestCase):
    def test_a_label_behind_a_jump_does_not_define_it(self) -> None:
        # `GOTO NLOOP` names the sequence name NLOOP; it is defined once, at the head of line 6.
        report = run_text(decode(helpers.FIXTURES_DIR / "nc" / "okuma" / "o04-sub.SUB"), "okuma-osp")
        self.assertEqual(lines_of(report, "jumpTargets"), [])

    def test_a_reference_into_another_program_is_not_looked_up_here(self) -> None:
        # `M98 P2005 Q500` jumps to N500 of program 2005; only `M98 Q500` is local.
        report = run_text(decode(helpers.FIXTURES_DIR / "nc" / "fanuc-lathe" / "l04-references.nc"), "fanuc-lathe")
        self.assertEqual(lines_of(report, "jumpTargets"), [12, 13])

    def test_a_conditional_end_is_no_end(self) -> None:
        text = program("%", "O1", "S1000 M3", "IF [#1 EQ 1] THEN M30", "G0 X10.", "M30", "%")
        self.assertEqual(lines_of(run_text(text), "programFrame"), [])

    def test_a_skipped_end_is_no_end(self) -> None:
        text = program("%", "O1", "S1000 M3", "/M30", "G0 X10.", "M30", "%")
        self.assertEqual(lines_of(run_text(text), "programFrame"), [])

    def test_a_klartext_label_after_m30_still_runs(self) -> None:
        text = "\n".join(
            [
                "0 BEGIN PGM SUBS MM",
                "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
                "2 CALL LBL 1",
                "3 M30",
                "4 LBL 1",
                "5 L X+10 FMAX",
                "6 LBL 0",
                "7 END PGM SUBS MM",
            ]
        )
        self.assertEqual(lines_of(run_text(text, "heidenhain-klartext"), "programFrame"), [])

    def test_a_block_after_the_end_that_a_jump_names_still_runs(self) -> None:
        text = program("%", "O1", "S1000 M3", "GOTO 100", "M30", "N100 G0 X10.", "M30", "%")
        self.assertEqual(lines_of(run_text(text), "programFrame"), [])
        unnamed = program("%", "O1", "S1000 M3", "M30", "N100 G0 X10.", "%")
        self.assertEqual(lines_of(run_text(unnamed), "programFrame"), [6])

    def test_a_label_after_the_end_starts_code_that_can_run(self) -> None:
        text = "\n".join(["; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE", "N10 GOTOF SUB_1", "N20 M30", "SUB_1: G0 X10", "N30 G0 X20", "N40 GOTOB N20"])
        self.assertEqual(lines_of(run_text(text, "sinumerik-mill"), "programFrame"), [])

    def test_text_after_end_pgm_never_runs(self) -> None:
        text = "\n".join(["0 BEGIN PGM X MM", "1 L X+0 FMAX", "2 END PGM X MM", "3 L X+10 FMAX"])
        self.assertEqual(lines_of(run_text(text, "heidenhain-klartext"), "programFrame"), [4])

    def test_the_nul_leader_of_a_tape_is_no_code(self) -> None:
        text = "\0\0\0\n%\nO1\nS1000 M3\nM30\n%\n\0\0"
        self.assertEqual(findings(run_text(text)), [])


class TestNumbers(unittest.TestCase):
    def test_a_word_with_a_point_is_read_alike_by_every_fanuc_preset(self) -> None:
        self.assertEqual(findings(run_text(program("O1", "G0 X50. Z0", "M30"))), [])

    def test_a_point_less_word_is_listed_with_every_reading(self) -> None:
        rows = findings(run_text(program("O1", "G0 X50", "M30")), "machineReading")
        self.assertEqual(len(rows), 1)
        self.assertIn("0.05 mm by 'Increments of 0.001 mm (IS-B)' (the assumed default)", rows[0]["message"])

    def test_a_unit_system_is_said_once_for_the_program(self) -> None:
        text = "\n".join(["O1", "G0 X50 Z2.", "G1 X40 Z-10. F0.2", "M02"])
        rows = findings(run_text(text, "okuma-osp"), "machineReading")
        self.assertEqual(len(rows), 1)
        self.assertIn("the unit system decides every value", rows[0]["message"])

    def test_the_digit_limit_holds_under_every_reading_before_it_is_reported(self) -> None:
        # 12345.678 is 8 digits on an IS-B machine and under the calculator reading: fine.
        self.assertEqual(lines_of(run_text(program("O1", "G0 X12345.678", "M30")), "wordDigits"), [])
        self.assertEqual(lines_of(run_text(program("O1", "G0 X123456.789", "M30")), "wordDigits"), [3])
        # A count without a point is its own digits.
        self.assertEqual(lines_of(run_text(program("O1", "G4 P123456789", "M30")), "wordDigits"), [3])

    def test_is_a_stays_out_of_the_digit_check_with_no_machine(self) -> None:
        # T083 (owner, 2026-10-19). X123456.789 is 9 digits on IS-B and as written and 10 on
        # IS-C, but only 8 on IS-A (steps of 0.01 mm). With IS-A among the readings the word
        # would pass, on every machine of the dialect; the preset is marked out of the check.
        text = program("O1", "G0 X123456.789", "M30")
        self.assertEqual(lines_of(run_text(text), "wordDigits"), [3])
        self.assertEqual(lines_of(run_text(text, "fanuc-lathe"), "wordDigits"), [3])
        # A machine set to IS-A is read as IS-A: there the word fits.
        self.assertEqual(lines_of(run_text(text, "fanuc-gcode", preset="is-a"), "wordDigits"), [])
        self.assertEqual(lines_of(run_text(text, "fanuc-gcode", preset="is-b"), "wordDigits"), [3])
        # Its readings are still listed with the others for a point-less word.
        rows = findings(run_text(program("O1", "G0 X50", "M30")), "machineReading")
        self.assertIn("0.5 mm by 'Increments of 0.01 mm (IS-A)'", rows[0]["message"])

    def test_the_digits_of_a_feed_follow_the_machine_point_less_feeds_choice(self) -> None:
        # T084: the Digits check converts a feed with a point to the machine's steps. On the
        # documented default a feed per minute counts in 1 mm/min, so F123456.789 is 6 digits;
        # on a machine whose feed per minute counts in 0.001 mm/min it is 9, one too many.
        # (The Machine reading check reads dimension words only, lengths and angles, so the
        # option does not reach it.)
        # Manual-check fix D4-2: on the lathe, which states its own choices (the mill has no
        # per-minute choice since then).
        text = program("O1", "G98 G1 X10. F123456.789", "M30")
        self.assertEqual(lines_of(run_text(text, "fanuc-lathe", preset="is-b"), "wordDigits"), [])
        plain = helpers.effective_context("fanuc-lathe", preset="is-b")
        for choice, expected in (("per-minute", [3]), ("series-15", []), ("both", [3])):
            context = helpers.with_pointless_feeds(plain, choice)
            context["params"] = {}
            context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
            result = helpers.run_script(SCRIPT, text, context)
            self.assertTrue(result.ok, result.stderr)
            self.assertEqual(lines_of(result.json(), "wordDigits"), expected, choice)
            self.assertEqual(findings(result.json(), "machineReading"), [], choice)

    def test_a_block_longer_than_the_control_takes(self) -> None:
        long_line = "G01 X10 Z-10 F0.2 " + "(" + "A" * 150 + ")"
        report = run_text("\n".join(["O1", long_line, "M02"]), "okuma-osp", machine_params=None)
        self.assertEqual(lines_of(report, "characters"), [2])


class TestFb2ToolDirection(unittest.TestCase):
    """v1.2.0 review round X, FB-2 (WX-NC-5): under Fanuc `G43.5`, `G41.6` and `G42.6` I, J and
    K are the tool direction, a count every machine reads alike, also in the blocks that do
    not write the code again. Read as arc centres they got "I1: 0.001 mm" rows on IS-B."""

    def rows(self, *lines: str) -> List[Tuple[int, str]]:
        report = run_text(program(*lines), "fanuc-gcode", preset="is-b")
        return [(row["line"], row["message"].split(":")[0]) for row in findings(report, "machineReading")]

    def test_no_reading_rows_for_the_tool_direction_under_g43_5(self) -> None:
        rows = self.rows(
            "O1000", "G90 G17 G54 G0 X0. Y0.", "G43.5 X0. Y0. Z10. I0 J0 K1. H1", "G1 X10. Y5. I1 J0 K1 F500.",
            "G49", "G2 X20. Y5. I5 J0", "M30",
        )
        # After G49 I is an arc centre again: its point-less 5 is 0.005 mm on IS-B.
        self.assertEqual(rows, [(7, "I5")])

    def test_no_reading_rows_for_the_tool_direction_under_g41_6(self) -> None:
        rows = self.rows("O1000", "G90 G17 G54 G0 X0. Y0.", "G41.6 X5. Y5. I0 J0 K1 D1", "G1 X10. I1 J0 K0", "G40 G1 X20.", "M30")
        self.assertEqual(rows, [])


class TestLargeReports(unittest.TestCase):
    """A report is cut at the app's row limit, here, so a long program cannot lose it whole."""

    #: 2,600 lines of three point-less dimension words each: 7,800 `machineReading` rows
    #: with no machine chosen (the Fanuc presets read a point-less number differently).
    POINTLESS = program("O1", "G0 X0 Y0", *(["G1 X1000 Y2000 Z-500 F100"] * 2600), "M30")

    def test_the_limit_is_the_apps(self) -> None:
        source = (helpers.REPO_ROOT / "src" / "lib" / "core" / "scripting" / "apply.ts").read_text(encoding="utf-8")
        found = re.search(r"export const MAX_ROWS = (\d+);", source)
        self.assertIsNotNone(found)
        self.assertEqual(script_module().MAX_ROWS, int(found.group(1)))

    def test_a_program_with_thousands_of_readings_is_listed_up_to_the_limit_and_says_so(self) -> None:
        report = run_text(self.POINTLESS)
        limit = script_module().MAX_ROWS
        self.assertEqual(len(report["rows"]), limit)
        notes = [f for f in report.get("findings", []) if "not listed" in f["message"]]
        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]["severity"], "warning")
        # 7,800 readings: the walk keeps 5,000 of them and counts the rest.
        self.assertIn("2800 findings are not listed", notes[0]["message"])
        self.assertIn(str(limit), notes[0]["message"])

    def test_a_report_inside_the_limit_has_no_note(self) -> None:
        report = run_text(program("O1", "G0 X50", "M30"))
        self.assertEqual([f for f in report.get("findings", []) if "not listed" in f["message"]], [])

    def test_errors_are_kept_before_information_and_the_rows_stay_in_line_order(self) -> None:
        mod = script_module()
        rows = (
            [{"line": n, "severity": "info"} for n in range(1, 11)]
            + [{"line": 11, "severity": "error"}, {"line": 12, "severity": "warning"}, {"line": 13, "severity": "error"}]
        )
        kept, cut = mod.cap_rows(rows, 5)
        self.assertEqual(cut, 8)
        self.assertEqual([r["line"] for r in kept], [1, 2, 11, 12, 13])
        self.assertEqual([r["severity"] for r in kept], ["info", "info", "error", "warning", "error"])
        same, none = mod.cap_rows(rows, 13)
        self.assertEqual((same, none), (rows, 0))

    def test_an_error_on_the_last_line_survives_a_flood_of_readings(self) -> None:
        text = self.POINTLESS.rstrip("\n") + "\nG1 X[1+2\n"
        report = run_text(text)
        self.assertEqual(len(report["rows"]), script_module().MAX_ROWS)
        self.assertIn("brackets", ids(report))

    def test_the_output_stays_far_below_what_the_app_can_read(self) -> None:
        # 7,800 rows were 2.2 MB; the cut keeps the output bounded whatever the program is.
        context = helpers.effective_context("fanuc-gcode")
        context["params"] = {}
        lines = self.POINTLESS.split("\n")
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
        result = helpers.run_script(SCRIPT, self.POINTLESS, context)
        self.assertTrue(result.ok, result.stderr)
        self.assertLess(len(result.stdout.encode("utf-8")), 2_000_000)


class TestNumberReadingIsRemembered(unittest.TestCase):
    """The class of an address and the readings of a literal are asked once, not per word."""

    def test_one_class_per_combination_and_one_reading_per_literal(self) -> None:
        mod = script_module()
        context = helpers.effective_context("fanuc-gcode")
        lines = program("O1", "G0 X0 Y0", *(["G1 X1000 Y2000 Z-500 F100"] * 400), "M30").split("\n")
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
        context["params"] = {}
        run = mod.Run(context, lines)
        classes = {"count": 0}
        readings = {"count": 0}
        real_class, real_resolve = mod.gedit_nc.number_class_of, mod.gedit_nc.resolve_value

        def counting_class(*args: Any, **kwargs: Any) -> Any:
            classes["count"] += 1
            return real_class(*args, **kwargs)

        def counting_resolve(*args: Any, **kwargs: Any) -> Any:
            readings["count"] += 1
            return real_resolve(*args, **kwargs)

        mod.gedit_nc.number_class_of, mod.gedit_nc.resolve_value = counting_class, counting_resolve
        try:
            mod.walk(run)
        finally:
            mod.gedit_nc.number_class_of, mod.gedit_nc.resolve_value = real_class, real_resolve
        # 402 blocks: without the memo each asks for the class of every word that could be a
        # dimension (more than 1,200 times), and the reading of each of its three literals.
        self.assertLess(classes["count"], 40)
        self.assertLess(readings["count"], 10)
        self.assertEqual(len(run.reading_rows), 400 * 3)


class TestShippedData(unittest.TestCase):
    """The members the checks read are in the shipped, resolved data, as `data-pins.json` says."""

    @staticmethod
    def entry(database: str, code: str) -> Optional[Dict[str, Any]]:
        key = gedit_nc.normalize_code(code)
        for entry in helpers.resolved_codes(database):
            if gedit_nc.normalize_code(entry["code"]) == key:
                return entry
        return None

    def test_every_pinned_code_carries_its_members(self) -> None:
        for database, members in PINS["codes"].items():
            for code, patch in members.items():
                with self.subTest(database=database, code=code):
                    entry = self.entry(database, code)
                    self.assertIsNotNone(entry)
                    for member, value in patch.items():
                        if member == "sets":
                            for key, item in value.items():
                                self.assertEqual((entry.get("sets") or {}).get(key), item, key)
                        else:
                            self.assertEqual(entry.get(member), value, member)

    def test_the_added_entries_are_there(self) -> None:
        for database, entries in PINS["add"].items():
            for added in entries:
                with self.subTest(database=database, code=added["code"]):
                    entry = self.entry(database, added["code"])
                    self.assertIsNotNone(entry)
                    for member, value in added.items():
                        self.assertEqual(entry.get(member), value, member)

    def test_the_profile_syntax_members(self) -> None:
        for profile_id, patch in PINS["profiles"].items():
            for key, value in patch["syntax"].items():
                with self.subTest(profile=profile_id, member=key):
                    self.assertEqual(helpers.resolved_profile(profile_id)["syntax"].get(key), value)
        # The lathe reads the Fanuc limit through `extends`.
        self.assertEqual(helpers.resolved_profile("fanuc-lathe")["syntax"].get("maxWordDigits"), 8)

    def test_every_member_reads_the_way_the_script_reads_it(self) -> None:
        mod = script_module()
        values = {
            "spindle": ("on", "off"), "toolSpindle": ("on", "off"), "motion": ("rapid", "feed"),
            "radiusComp": ("on", "off"), "lengthComp": ("on", "off"), "exitSpeed": ("zero",),
            "language": ("iso", "native"),
        }
        for database, members in PINS["codes"].items():
            groups = {e.get("group") for e in helpers.resolved_codes(database)}
            for code, patch in members.items():
                with self.subTest(database=database, code=code):
                    self.assertTrue(set(patch) <= {"sets", "conflicts", "alone", "requires", "contour"}, patch)
                    for key, value in patch.get("sets", {}).items():
                        self.assertIn(value, values[key])
                    for condition in patch.get("conflicts", []):
                        name = condition.lstrip("!")
                        if name.startswith("frame:"):
                            self.assertIn(name.split(":", 1)[1], groups)
                        elif name.startswith("code:"):
                            # D6-3: one code by name; it has to be a code of that database.
                            codes = {e.get("code") for e in helpers.resolved_codes(database)}
                            self.assertIn(name.split(":", 1)[1], codes)
                        else:
                            self.assertIn(name, mod.CONDITIONS)
                    if "alone" in patch:
                        self.assertIs(patch["alone"], True)
                    if "contour" in patch:
                        self.assertIn(patch["contour"], ("open", "close"))


    @staticmethod
    def unknown_code_conditions(entries: List[Dict[str, Any]]) -> List[str]:
        """The `code:X` and `!code:X` conditions of `conflicts` whose code is no code of the
        resolved database (its own entries and those of the family it extends)."""
        known = {gedit_nc.normalize_code(e.get("code")) for e in entries if isinstance(e.get("code"), str)}
        out: List[str] = []
        for entry in entries:
            for condition in entry.get("conflicts") or []:
                name = condition.lstrip("!") if isinstance(condition, str) else ""
                if name.startswith("code:") and gedit_nc.normalize_code(name.split(":", 1)[1]) not in known:
                    out.append("%s: %s" % (entry.get("code"), condition))
        return out

    def test_code_11_every_code_condition_names_a_code_of_its_database(self) -> None:
        # A `code:` condition with a typo would never hold, and nobody would be told. Every
        # shipped database, not only the codes data-pins.json lists.
        for dialect in ("fanuc", "fanuc-lathe", "fanuc-lathe-b", "heidenhain", "okuma", "sinumerik"):
            with self.subTest(dialect=dialect):
                self.assertEqual(self.unknown_code_conditions(helpers.resolved_codes(dialect)), [])
        # The check itself finds a typo.
        typo = json.loads(json.dumps(helpers.resolved_codes("fanuc")))
        for entry in typo:
            if entry.get("code") == "G43.4":
                entry["conflicts"] = ["!code:G86.2"]
        self.assertEqual(self.unknown_code_conditions(typo), ["G43.4: !code:G86.2"])


# ---------------------------------------------------------------------------
# The machine's limits (P4.10, plan §6.4 rule 7)
# ---------------------------------------------------------------------------

MILL_LIMITS = {
    "units": "mm",
    "spindle": {"main": 10000},
    "travel": {
        "X": {"min": -800, "max": 0},
        "Y": {"min": -500, "max": 0},
        "Z": {"min": -600, "max": 0},
        "B": {"min": -120, "max": 120},
    },
}
LATHE_LIMITS = {
    "units": "mm",
    "spindle": {"main": 4000},
    "travel": {"X": {"min": 0, "max": 600}, "Z": {"min": -800, "max": 0}},
}


def run_limits(
    text: str, profile_id: str = "fanuc-gcode", limits: Optional[Dict[str, Any]] = None, params: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """The report for ``text`` on a profile's defaults with ``limits`` as the machine's
    limits block (``context.machine.limits``, as ``buildContext`` passes it)."""
    context = helpers.effective_context(profile_id)
    context["params"] = dict(params or {})
    lines = text.split("\n")
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
    context["machine"] = dict(context["machine"])
    if limits is not None:
        context["machine"]["limits"] = limits
    result = helpers.run_script(SCRIPT, text, context)
    if not result.ok:
        raise AssertionError("program_checks failed:\n" + result.stderr)
    return result.json()


#: The marker of a synthetic program where a comment starts with `;` (Sinumerik).
SEMI_MARK = "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE"


def nc(*lines: str) -> str:
    """A program as written, its first line first (``program`` puts the ``( )`` marker first)."""
    return "\n".join(lines) + "\n"


def rows_of(report: Dict[str, Any], check: str) -> List[Tuple[int, str, str]]:
    return [(r["line"], r["severity"], r["message"]) for r in findings(report, check)]


def notes_of(report: Dict[str, Any]) -> List[str]:
    return [f["message"] for f in report["findings"]]


class TestLimitsData(unittest.TestCase):
    def test_the_checks_load_no_geometry_module(self) -> None:
        # Plan §6.4 rule 8: the limits come through `_nc_cycles`, which imports gedit_nc only.
        import subprocess
        import sys

        code = (
            "import sys; sys.path.insert(0, %r); import program_checks; "
            "print(' '.join(sorted(m for m in sys.modules if m.startswith('_nc_'))))" % str(helpers.SCRIPTS_DIR)
        )
        out = subprocess.run([sys.executable, "-B", "-S", "-c", code], capture_output=True, text=True, check=True).stdout.split()
        self.assertIn("_nc_cycles", out)
        for module in ("_nc_path", "_nc_geom", "_nc_run"):
            self.assertNotIn(module, out)

    def test_without_a_limits_block_both_checks_say_nothing(self) -> None:
        text = program("%", "O1", "G90 G54", "S90000 M3", "G0 X-5000. Y-5000. Z500.", "G53 Z-9000.", "M30", "%")
        report = run_limits(text, limits=None)
        self.assertEqual(findings(report, "speedLimit") + findings(report, "travelLimit"), [])
        self.assertEqual(report["findings"], [])

    def test_two_checks_and_no_travel_time_check(self) -> None:
        # T085: the SINUMERIK manuals give G931 only in the G-group tables and keep a feed in
        # force until the next one, so a travel-time block without its own F is no finding.
        self.assertIn("speedLimit", check_ids())
        self.assertIn("travelLimit", check_ids())
        self.assertNotIn("travelTime", check_ids())
        text = nc(SEMI_MARK, "N10 G90 G94 G71", "N20 G931 G1 X-10 F5", "N30 X-20", "N40 M30")
        report = run_limits(text, "sinumerik-mill", limits=MILL_LIMITS)
        self.assertEqual(report["rows"], [])

    def test_a_check_switched_off_writes_no_row_and_no_note(self) -> None:
        text = program("%", "O1", "G90 G54", "S90000 M3", "G0 X-5000. W1.", "M30", "%")
        report = run_limits(text, limits={"spindle": {"main": 1000}}, params={"speedLimit": False, "travelLimit": False})
        self.assertEqual(report["rows"], [])
        self.assertEqual(report["findings"], [])


class TestSpeedLimit(unittest.TestCase):
    def test_a_speed_above_the_top_speed_is_a_warning_naming_both(self) -> None:
        report = run_limits(program("%", "O1", "G97 S12000 M3", "S10000", "M30", "%"), limits=MILL_LIMITS)
        self.assertEqual(rows_of(report, "speedLimit"), [(4, "warning", "S12000 is above the top speed of this machine, 10000 rpm")])

    def test_a_speed_under_constant_surface_speed_is_not_rpm(self) -> None:
        text = program("%", "O1", "G50 S3000", "G96 S5000 M3", "G0 X50. Z2.", "G97 S4500", "M30", "%")
        report = run_limits(text, "fanuc-lathe", limits=LATHE_LIMITS)
        self.assertEqual(lines_of(report, "speedLimit"), [7])

    def test_a_speed_before_any_speed_unit_is_read_as_rpm_and_says_so(self) -> None:
        report = run_limits(program("%", "O1", "S12000 M3", "M30", "%"), limits=MILL_LIMITS)
        self.assertEqual(
            rows_of(report, "speedLimit"),
            [(4, "warning", "S12000 is above the top speed of this machine, 10000 rpm (read as rpm: no speed unit is set before it)")],
        )

    def test_a_speed_without_an_rpm_code_in_the_database_says_nothing_of_its_reading(self) -> None:
        # NC-14 (fix batch 2): Klartext has a surface speed (`VC`) but no code that sets rpm:
        # `TOOL CALL … S` is always rpm, so the row does not say it was read as rpm.
        text = program("0 BEGIN PGM S MM", "1 TOOL CALL 1 Z S12000", "2 END PGM S MM")
        self.assertEqual(
            rows_of(run_limits(text, "heidenhain-klartext", limits=MILL_LIMITS), "speedLimit"),
            [(3, "warning", "S12000 is above the top speed of this machine, 10000 rpm")],
        )

    def test_a_clamp_above_the_top_speed_is_a_warning(self) -> None:
        report = run_limits(program("%", "O1", "G50 S6000", "M30", "%"), "fanuc-lathe", limits=LATHE_LIMITS)
        self.assertEqual(
            rows_of(report, "speedLimit"), [(4, "warning", "G50 S6000: the speed clamp is above the top speed of this machine, 4000 rpm")]
        )

    def test_a_dwell_and_a_lower_limit_are_no_speed(self) -> None:
        text = nc(SEMI_MARK, "N10 G18 G90 G95 G97", "N20 G4 S9000", "N30 G25 S9000", "N40 M30")
        self.assertEqual(findings(run_limits(text, "sinumerik", limits=LATHE_LIMITS), "speedLimit"), [])

    def test_the_main_spindle_by_number_and_the_other_spindles(self) -> None:
        limits = {"spindle": {"main": 4000, "S2": 6000}}
        text = nc(SEMI_MARK, "N10 G18 G90 G95 G97", "N20 S1=4500 S2=6500", "N30 S[2]=7000 LIMS[2]=6100", "N40 M30")
        self.assertEqual(
            rows_of(run_limits(text, "sinumerik", limits=limits), "speedLimit"),
            [
                (3, "warning", "S1=4500 is above the top speed of this machine, 4000 rpm"),
                (3, "warning", "S2=6500 is above the top speed of spindle S2 on this machine, 6000 rpm"),
                (4, "warning", "S[2]=7000 is above the top speed of spindle S2 on this machine, 6000 rpm"),
                (4, "warning", "LIMS[2]=6100: the speed clamp is above the top speed of spindle S2 on this machine, 6000 rpm"),
            ],
        )

    def test_the_limit_of_the_exact_address_wins_over_main(self) -> None:
        limits = {"spindle": {"main": 5000, "S1": 3000}}
        text = nc(SEMI_MARK, "N10 G18 G90 G95 G97", "N20 S1=4000", "N30 S4000", "N40 M30")
        self.assertEqual(
            rows_of(run_limits(text, "sinumerik", limits=limits), "speedLimit"),
            [(3, "warning", "S1=4000 is above the top speed of spindle S1 on this machine, 3000 rpm")],
        )

    def test_another_address_is_a_spindle_only_where_the_limits_name_it(self) -> None:
        text = program("$O1", "G97 S3000 M3", "SB=5000 M13", "M02")
        self.assertEqual(lines_of(run_limits(text, "okuma-osp", limits={"spindle": {"main": 4000, "SB": 4000}}), "speedLimit"), [4])
        report = run_limits(text, "okuma-osp", limits={"spindle": {"main": 4000}})
        self.assertEqual(findings(report, "speedLimit"), [])
        self.assertEqual(notes_of(report), [])

    def test_a_spindle_the_machine_has_no_top_speed_for_is_a_note(self) -> None:
        text = nc(SEMI_MARK, "N10 G18 G90 G95 G97", "N20 S3000 M3", "N30 S2=2500", "N40 M30")
        report = run_limits(text, "sinumerik", limits={"spindle": {"main": 4000}})
        self.assertEqual(notes_of(report), ["Spindle speed limit: no top speed is set for spindle S2 on this machine, so its speeds are not checked."])
        report = run_limits(text, "sinumerik", limits={"travel": {}, "units": "mm"})
        self.assertEqual(notes_of(report), ["Spindle speed limit: no top spindle speed is set for this machine, so the speeds are not checked."])


class TestTravelLimit(unittest.TestCase):
    def test_a_machine_position_outside_the_travel_is_an_error(self) -> None:
        report = run_limits(program("%", "O1", "G90", "G53 Z-650.", "G53 Z-10.", "M30", "%"), limits=MILL_LIMITS)
        self.assertEqual(
            rows_of(report, "travelLimit"),
            [(5, "error", "Z-650. is outside the travel of this machine, Z -600 to 0 mm (in machine coordinates, G53)")],
        )

    def test_work_positions_wider_apart_than_the_travel_are_one_warning_per_axis(self) -> None:
        # CODE-10, the owner's answer to Q3 (2026-10-21): the work offset is not known, so no
        # single position is judged; X spans -990 to 10, 1000 mm on 800 mm of travel, so no work
        # offset brings them all inside. The row is on the line where the span first passes
        # 800 (line 8), Y and Z span less than their travel.
        text = program("%", "O1", "G90 G54", "G0 X-850. Y-10. Z50.", "X-990.", "X-900.", "X10.", "Z-500.", "M30", "%")
        self.assertEqual(
            rows_of(run_limits(text, limits=MILL_LIMITS), "travelLimit"),
            [(8, "warning", "X-990. (line 6) to X10. (line 8): the positions of X in work coordinates span 1000 mm, more than the travel of this machine, X -800 to 0 mm (800 mm), so no work offset brings them all inside")],
        )

    def test_work_positions_outside_the_travel_that_fit_it_are_no_row(self) -> None:
        # The common program (CODE-10): Z from -200 to 5 lies outside a travel of -600 to 0, and
        # a work offset puts it inside. A span exactly as long as the travel fits too.
        text = program("%", "O1", "G90 G54", "G0 X0. Y0. Z5.", "G1 Z-200. F100.", "G0 Z5.", "X-800.", "M30", "%")
        report = run_limits(text, limits=MILL_LIMITS)
        self.assertEqual(findings(report, "travelLimit"), [])
        self.assertEqual(report["findings"], [])

    def test_a_machine_position_is_not_part_of_the_work_span(self) -> None:
        # G53 Z-650. is an error of its own; with it, the work positions Z50. and Z-500. would
        # span 700 mm, but a machine position is no work position.
        text = program("%", "O1", "G90 G54", "G0 Z50.", "G53 Z-650.", "G0 Z-500.", "M30", "%")
        self.assertEqual([(line, severity) for line, severity, _ in rows_of(run_limits(text, limits=MILL_LIMITS), "travelLimit")], [(6, "error")])

    def test_each_program_of_a_file_has_its_own_rows(self) -> None:
        text = program("%", "O1", "G90 G54", "G0 X-990.", "X10.", "M30", "O2", "G90 G54", "G0 X-990.", "X10.", "M30", "O3", "G90 G54", "G0 X10.", "M30", "%")
        self.assertEqual(lines_of(run_limits(text, limits=MILL_LIMITS), "travelLimit"), [6, 11])

    def test_a_rotary_axis_is_compared_in_degrees(self) -> None:
        report = run_limits(program("%", "O1", "G90", "G53 B-130.", "G0 B150.", "B-100.", "M30", "%"), limits=MILL_LIMITS)
        rows = rows_of(report, "travelLimit")
        self.assertEqual([(line, severity) for line, severity, _ in rows], [(5, "error"), (7, "warning")])
        self.assertIn("B -120° to 120°", rows[0][2])
        self.assertIn("span 250°, more than the travel of this machine, B -120° to 120° (240°)", rows[1][2])

    def test_a_length_is_converted_to_the_units_of_the_travel(self) -> None:
        limits = {"units": "inch", "travel": {"Z": {"min": -20, "max": 0}}}
        report = run_limits(program("%", "O1", "G21 G90", "G53 Z-600.", "G53 Z-500.", "M30", "%"), limits=limits)
        self.assertEqual(
            rows_of(report, "travelLimit"),
            [(5, "error", "Z-600. (-23.622 inch) is outside the travel of this machine, Z -20 to 0 inch (in machine coordinates, G53)")],
        )

    def test_incremental_words_are_not_compared(self) -> None:
        text = program("%", "O1", "G91 G0 X-900.", "G90", "G91 G28 Z0.", "M30", "%")
        self.assertEqual(findings(run_limits(text, limits=MILL_LIMITS), "travelLimit"), [])
        lathe = program("%", "O1", "G0 X100. Z0.", "U900. W-900.", "M30", "%")
        self.assertEqual(findings(run_limits(lathe, "fanuc-lathe", limits=LATHE_LIMITS), "travelLimit"), [])

    def test_a_distance_mode_not_known_is_a_note_not_a_row(self) -> None:
        # The X10. of line 4 is not counted (else X would span 1000 mm from line 5 on): X spans
        # -990 to -100 from line 6.
        report = run_limits(program("%", "O1", "G0 X10.", "G90 X-990.", "X-100.", "M30", "%"), limits=MILL_LIMITS)
        self.assertEqual(lines_of(report, "travelLimit"), [6])
        self.assertEqual(
            notes_of(report),
            ["Travel: at line 4 it is not known whether the positions are absolute or incremental, so they are compared only where the program sets it."],
        )

    def test_data_blocks_frames_and_tool_centre_point_control_are_no_positions(self) -> None:
        text = program(
            "%", "O1", "G90 G54",
            "G10 L2 P1 X-900. Y-900. Z-900.", "G92 X-900.", "G52 X-900.",
            "G68 X0 Y0 R30.", "G0 X-950.", "G69",
            "G43.4 H1", "G0 X-950.", "G49",
            "M30", "%",
        )
        self.assertEqual(findings(run_limits(text, limits=MILL_LIMITS), "travelLimit"), [])

    def test_a_reference_return_names_an_intermediate_point_in_work_coordinates(self) -> None:
        # `G28`'s parameters describe its axis words as an intermediate point in the program's
        # coordinates, so it is no machine position: with Z-600. it spans 650 mm, a warning.
        report = run_limits(program("%", "O1", "G90 G28 Z50.", "G0 Z-600.", "M30", "%"), limits=MILL_LIMITS)
        self.assertEqual([(line, severity) for line, severity, _ in rows_of(report, "travelLimit")], [(5, "warning")])

    def test_a_contour_definition_is_no_position(self) -> None:
        text = program("$O1", "NAT01 G81", "G01 X900 Z0", "Z-20", "G80", "G00 X82 Z5", "M02")
        self.assertEqual(findings(run_limits(text, "okuma-osp", limits=LATHE_LIMITS), "travelLimit"), [])

    def test_a_word_the_machine_reads_differently_is_not_compared(self) -> None:
        # No machine chosen: the presets read `Z-650000` as -650 mm or -650000 mm, so nothing
        # is compared (`machineReading` lists the readings).
        report = run_limits(program("%", "O1", "G90", "G53 Z-650000", "M30", "%"), limits=MILL_LIMITS)
        self.assertEqual(findings(report, "travelLimit"), [])

    def test_a_diameter_written_as_a_radius_is_doubled(self) -> None:
        text = nc(SEMI_MARK, "N10 G18 G90 G95", "N20 DIAMOF", "N30 SUPA G0 X350", "N40 DIAMON", "N50 SUPA X350", "N60 M30")
        self.assertEqual(
            rows_of(run_limits(text, "sinumerik", limits=LATHE_LIMITS), "travelLimit"),
            [(4, "error", "X350 (700 mm) is outside the travel of this machine, X (diameter) 0 to 600 mm (in machine coordinates, SUPA)")],
        )

    def test_an_axis_without_travel_is_a_note(self) -> None:
        limits = {"units": "mm", "travel": {"X": {"min": -800, "max": 0}}}
        report = run_limits(program("%", "O1", "G90", "G0 X-10. Y-10. Z5.", "M30", "%"), limits=limits)
        self.assertEqual(findings(report, "travelLimit"), [])
        self.assertEqual(notes_of(report), ["Travel: no travel is set for Y and Z on this machine, so their positions are not checked."])


class TestRunEnvironment(unittest.TestCase):
    def test_without_a_context_it_says_what_it_needs_and_writes_nothing_to_stdout(self) -> None:
        result = helpers.run_script(SCRIPT, stdin="T1 M6\n", context=None)
        self.assertFalse(result.ok)
        self.assertEqual(result.stdout, "")
        self.assertIn("profile", result.stderr)

    def test_a_profile_it_cannot_compile_is_a_message_and_not_a_traceback(self) -> None:
        profile = helpers.load_profile("fanuc-gcode")
        profile["toolCall"]["trigger"] = "M0*6(?!\\d"
        context = helpers.make_context(profile=profile, codes=[])
        result = helpers.run_script(SCRIPT, stdin="T1 M6\n", context=context)
        self.assertFalse(result.ok)
        self.assertIn("toolCall.trigger", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_an_empty_document_has_no_findings(self) -> None:
        report = run_text("")
        self.assertEqual(report["rows"], [])
        self.assertTrue(report["message"].startswith("No findings."))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
