"""`address_arithmetic.py` (plan §6 M10 WP10.4; roadmap R3, R6 and R8), against the golden
cases in ``tests/fixtures/scripts/address_arithmetic/`` and the rules of its README.

Each case is a folder: `input.nc` (stdin), `params.json` (the form), the optional
`case.json` (profile, machine, machineName) and `preceding.nc` (the lines above a
selection), and the two goldens `expected.nc` (byte for byte) and `envelope.json` (the
`message` and `findings`). A case with a `machine` runs against the generated
`tests/fixtures/resolved/effective/**` entry; Python never merges a machine.

The programs are synthetic, written for gEdit, and carry the `WRITTEN FOR GEDIT` marker.

What the cases cover, in the plan's words (WP10.4 Tests):

* `Z1000` → `Z500` under IS-B, `Z999.5` under the calculator reading, left and reported
  with no machine, and `Z10.` → `Z9.5` in all three (`fanuc-z-is-b`, `fanuc-z-calculator`,
  `fanuc-z-no-machine`);
* `Z1000` + 0.0005 under IS-B → `Z1001`, reported as rounded (`fanuc-rounded-is-b`);
* an Okuma 10 µm machine: `Z1000` − 0.5 → `Z950`, `Z10.` − 0.5 → `Z-40.` (`okuma-10um`);
* a lathe `Z` − 0.5 with `W` words reported (`lathe-z-shift`);
* Okuma `X=V1+2` skipped (`okuma-expression`);
* multiply by 2 on a `G83 … K3` block leaves `K3` alone (`fanuc-multiply-g83`);
* a Sinumerik `DIAMOF` section: +0.5 as a diameter moves the `DIAMON` words by 0.5 and the
  `DIAMOF` words by 0.25 (`sinumerik-diamof`);
* R8: a Klartext `CYCL DEF 200` whose `Q203` moves with the `Z` words, `CYCL CALL POS`
  refused, a definition the database lacks refused with its call, a `Q203` written as a
  variable refused with its call (`klartext-cycles`, `klartext-modal-call`); a Sinumerik
  `CYCLE83` with its trailing arguments at 0 moved and one with `_AMODE=1` refused
  (`sinumerik-cycle83`); `CYCLE800` and the blocks under it refused (`sinumerik-cycle800`);
  a `TRAORI` section judged and the same `A`/`C` move without it refused, `SUPA` refused
  (`sinumerik-traori`); the `R` plane of a Fanuc drilling cycle moved, a cycle that cannot
  move in one piece refused with every block that runs it, `G53`/`G28` refused, a frame, an
  unknown code (`fanuc-drilling`); a cycle started above a selection (`fanuc-selection-primed`).
"""

from __future__ import annotations

import json
import unittest
from decimal import Decimal

from tests.python import helpers

SCRIPT = "address_arithmetic.py"

try:  # Python 3.11 and newer
    import tomllib  # noqa: F401

    HAS_TOMLLIB = True
except ImportError:  # pragma: no cover - Python 3.9 and 3.10
    HAS_TOMLLIB = False

#: The cases the plan names (WP10.4 Tests and H10 `m10-arith`).
REQUIRED_CASES = [
    "fanuc-z-is-b",
    "fanuc-z-calculator",
    "fanuc-z-no-machine",
    "fanuc-rounded-is-b",
    "okuma-10um",
    "okuma-expression",
    "lathe-z-shift",
    "fanuc-multiply-g83",
    "sinumerik-diamof",
    "klartext-cycles",
    "klartext-modal-call",
    "sinumerik-cycle83",
    "sinumerik-cycle800",
    "sinumerik-traori",
    "fanuc-drilling",
    "fanuc-selection-primed",
    # The M10 review.
    "klartext-polar",
    "sinumerik-arc-geometry",
    "fanuc-rotary-state",
    "fanuc-polar-g16",
    "sinumerik-mill-x-shift",
    "fanuc-multiply-rule",
    # B1 fix NC: the lathe turret mirror apart from the rotation (NC-02), FK points (NC-03).
    "lathe-frames",
    "klartext-fk",
    # The Sinumerik milling cycles, SLOT2 and CYCLE72 among them (2026-10-12).
    "sinumerik-milling-cycles",
    # P4a review NC-16: the values of the Fanuc lathe's G71-G76.
    "b4-lathe-cycle-values",
    "b4-lathe-cycle-multiply",
]

#: The vocabulary of the README: block reasons, word reasons, notes and run notes.
BLOCK_REASONS = {
    "pole",
    "arc-geometry",
    "not-scaled",
    "unknown-code",
    "machine-position",
    "frame",
    "rotary-without-tcp",
    "cycle-outside",
    "cycle-not-reviewed",
    "cycle-position",
    "cycle-mode",
    "cycle-plane",
    "cycle-expression",
    "cycle-unresolved",
    "cycle-empty",
    "cycle-level-outside",
}
WORD_REASONS = {"unreadable", "data", "incremental", "expression", "machine-dependent", "count", "fk-point", "process-value"}
NOTE_REASONS = {"rounded"}
RUN_REASONS = {"selection", "no-database", "unknown-code-note"}


def context_of(case):
    """The context a case runs with: the effective profile and machine (as `test_scale_feed`)."""
    context = case.context()
    if isinstance(case.options.get("machine"), dict):
        effective = helpers.effective_context(golden=case.directory / "case.json")
    else:
        effective = helpers.effective_context(case.profile_id)
    context["profile"] = effective["profile"]
    context["codes"] = effective["codes"]
    context["machine"] = dict(effective["machine"])
    name = case.options.get("machineName")
    if isinstance(name, str) and name != "":
        context["machine"]["id"] = name.lower().replace(" ", "-")
        context["machine"]["name"] = name
    context.pop("machineName", None)
    return context


def run_case(case, **changes):
    context = context_of(case)
    for key, value in changes.items():
        context[key] = value
    return helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)


def envelope_of(case):
    return helpers.load_json(case.directory / "envelope.json")


def case_named(name):
    for case in helpers.script_cases("address_arithmetic"):
        if case.name == name:
            return case
    raise AssertionError("no case %s" % name)


def run(text, profile="fanuc-gcode", preset=None, name=None, variant=None, **params):
    """Runs the script on a program written inline, with the given form values."""
    context = helpers.effective_context(profile, preset=preset, variant=variant) if preset or variant else helpers.effective_context(profile)
    if name is not None:
        context["machine"]["id"] = name.lower()
        context["machine"]["name"] = name
    context["params"] = dict({"operation": "add", "operand": 0.5}, **params)
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    result = helpers.run_script(SCRIPT, stdin=text, context=context)
    if not result.ok:
        raise AssertionError(result.stderr)
    return result.json()


class TestPointlessFeedsT084(unittest.TestCase):
    """T084: a feed word chosen as an address is read with the machine's "Point-less feeds"
    choice. Adding 10 mm/min to F200 is F210 on the documented default (1 mm/min steps) and
    F10200 on a machine that counts the feed per minute in 0.001 mm/min (0.2 + 10 = 10.2)."""

    def run_on(self, context, text, **params):
        context = dict(context)
        context["params"] = dict({"operation": "add", "operand": 10, "addresses": ["F"]}, **params)
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
        result = helpers.run_script(SCRIPT, stdin=text, context=context)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_the_feed_is_read_with_the_machine_choice(self):
        # Manual-check fix round (D4-2): the per-minute thousandths (parameter 1404 bit 2) are a
        # choice of the lathe now; the mill offers standard and per-revolution thousandths.
        text = "G98 G1 X10. F200\n"
        plain = helpers.effective_context("fanuc-lathe", preset="is-b")
        self.assertEqual(lines_of(self.run_on(plain, text))[0], "G98 G1 X10. F210")
        fine = helpers.with_pointless_feeds(plain, "per-minute")
        self.assertEqual(lines_of(self.run_on(fine, text))[0], "G98 G1 X10. F10200")
        # A factor is unit-free: both machines write the same count.
        self.assertEqual(lines_of(self.run_on(fine, text, operation="multiply", operand=0.9))[0], "G98 G1 X10. F180")


class TestFkContour(unittest.TestCase):
    """B1 fix NC (NC-03): the absolute points of a Klartext FK contour were left and listed.
    v1.2.0 Wave Y (T121): with every FK word classified (TNC 640 Klartext manual 2019, free
    contour programming, p.175-189), a shift moves them with their axis; a scale, or a block with
    a word nobody classified, still leaves them and lists them."""

    PROGRAM = "\n".join([
        "0 BEGIN PGM FK MM",
        "1 L X+10 Y+10 R0 FMAX",
        "2 FL X+80 Y+20 AN+0",
        "3 FC DR+ R30 CCX+50 CCY+50 P1X+70 P1Y+60",
        "4 FCT DR- R15 P1X+30 P1Y+40 P2X+40 P2Y+50",
        "5 END PGM FK MM",
    ])

    def test_an_x_shift_moves_the_x_points(self):
        payload = run(self.PROGRAM, profile="heidenhain-klartext", operation="add", operand=5, addresses=["X"])
        text = lines_of(payload)
        self.assertEqual(text[2], "2 FL X+85 Y+20 AN+0")
        self.assertEqual(text[3], "3 FC DR+ R30 CCX+55 CCY+50 P1X+75 P1Y+60")
        self.assertEqual(text[4], "4 FCT DR- R15 P1X+35 P1Y+40 P2X+45 P2Y+50")
        self.assertEqual([f for f in payload["findings"] if f["reason"] == "fk-point"], [])

    def test_a_y_shift_moves_the_y_points_only(self):
        payload = run(self.PROGRAM, profile="heidenhain-klartext", operation="add", operand=5, addresses=["Y"])
        self.assertEqual(lines_of(payload)[3], "3 FC DR+ R30 CCX+50 CCY+55 P1X+70 P1Y+65")

    def test_the_relative_polar_and_beside_the_contour_words(self):
        program = "\n".join([
            "0 BEGIN PGM FK MM", "1 FPOL X+10 Y+10", "2 FL PR+20 PA+20", "3 FL AN+45",
            "4 FCT IX+20 DR- R20 CCA+90 RX 3", "5 FLT AN-70 PDX+50 PDY+53 D10", "6 FL PAR 5 DP 12.5", "7 FSELECT 2",
            "8 FC DR- R10 CCA+0 ICCX+20 ICCY-15 RCCX12 RCCY14", "9 END PGM FK MM",
        ])
        payload = run(program, profile="heidenhain-klartext", operation="add", operand=5, addresses=["X", "Y"])
        text = lines_of(payload)
        self.assertEqual((text[1], text[5]), ("1 FPOL X+15 Y+15", "5 FLT AN-70 PDX+55 PDY+58 D10"))
        self.assertEqual(text[2:5] + text[6:9], program.split("\n")[2:5] + program.split("\n")[6:9])
        self.assertEqual([f for f in payload["findings"] if f["reason"] == "fk-point"], [])

    def test_a_scale_or_a_word_nobody_classified_leaves_them_and_says_so(self):
        payload = run(self.PROGRAM, profile="heidenhain-klartext", operation="multiply", operand=2, addresses=["X"])
        fk = [(f["line"], f["message"].split(":")[0], f["severity"]) for f in payload["findings"] if f["reason"] == "fk-point"]
        self.assertEqual(fk, [(4, "CCX+50", "warning"), (4, "P1X+70", "warning"), (5, "P1X+30", "warning"), (5, "P2X+40", "warning")])
        unclassified = self.PROGRAM.replace("P1Y+60", "P1Y+60 XYZ5")
        payload = run(unclassified, profile="heidenhain-klartext", operation="add", operand=5, addresses=["X"])
        self.assertIn("3 FC DR+ R30 CCX+50 CCY+50 P1X+70 P1Y+60 XYZ5", lines_of(payload))
        self.assertIn((4, "CCX+50"), [(f["line"], f["message"].split(":")[0]) for f in payload["findings"] if f["reason"] == "fk-point"])

    def test_a_z_shift_touches_no_fk_point(self):
        payload = run(self.PROGRAM, profile="heidenhain-klartext", operation="add", operand=5, addresses=["Z"])
        self.assertEqual([f for f in payload["findings"] if f["reason"] == "fk-point"], [])


class TestFkContourInASelectionD4(unittest.TestCase):
    """v1.2.0 Wave Y, D4 (the skeptic of T121): a selection moves the FK points of a contour only
    when the whole contour lies in it: the FPOL in force at its first FK block, its first to its
    last FK block, and every block a relative reference names. Otherwise its points are left with
    the `fk-point` warning, as before T121: `FL PR+30 PA+0` and `CCPR+20 CCPA+90` stay about the
    unmoved FPOL, and moving `CCX`/`P1X` alone would bend the contour (probe t121a)."""

    PROGRAM = "\n".join([
        "0 BEGIN PGM FK MM",
        "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
        "2 TOOL CALL 1 Z S2000",
        "3 L Z+100 R0 FMAX",
        "4 L X+10 Y+10 R0 FMAX",
        "5 L Z-5 R0 F500",
        "6 APPR CT X+20 Y+20 CCA90 R+5 RL F300",
        "7 FPOL X+50 Y+50",
        "8 FL PR+30 PA+0",
        "9 FC DR+ R30 CCX+50 CCY+50 P1X+70 P1Y+60",
        "10 FCT DR- R15 CCPR+20 CCPA+90",
        "11 FLT P1X+20 P1Y+80",
        "12 L X+20 Y+20",
        "13 DEP CT CCA90 R+5 F1000",
        "14 L Z+100 R0 FMAX",
        "15 END PGM FK MM",
    ])

    def run_on(self, start, end, program=None, below=True):
        lines = (program or self.PROGRAM).split("\n")
        context = helpers.effective_context("heidenhain-klartext")
        context["params"] = {"operation": "add", "operand": 5, "addresses": ["X"]}
        context["input"] = {"scope": "selection", "startLine": start, "endLine": end, "precedingLines": lines[: start - 1]}
        if below:
            context["input"]["followingLines"] = lines[end:]
        result = helpers.run_script(SCRIPT, stdin="\n".join(lines[start - 1 : end]), context=context)
        if not result.ok:
            raise AssertionError(result.stderr)
        return result.json()

    def fk_points(self, payload):
        return [(f["line"], f["message"].split(":")[0], f["severity"]) for f in payload["findings"] if f["reason"] == "fk-point"]

    def test_the_fpol_above_the_selection_leaves_every_fk_point(self):
        payload = self.run_on(9, 12)
        self.assertEqual(payload["text"], "\n".join(self.PROGRAM.split("\n")[8:12]))
        self.assertEqual(self.fk_points(payload), [(10, "CCX+50", "warning"), (10, "P1X+70", "warning"), (12, "P1X+20", "warning")])

    def test_a_selection_with_the_whole_contour_moves_it(self):
        for end in (12, 13):
            payload = self.run_on(8, end)
            text = lines_of(payload)
            self.assertEqual((text[0], text[2], text[4]), ("7 FPOL X+55 Y+50", "9 FC DR+ R30 CCX+55 CCY+50 P1X+75 P1Y+60", "11 FLT P1X+25 P1Y+80"))
            self.assertEqual(self.fk_points(payload), [])

    def test_a_contour_that_runs_on_below_the_selection_is_left(self):
        payload = self.run_on(8, 11)
        self.assertEqual(lines_of(payload)[2], "9 FC DR+ R30 CCX+50 CCY+50 P1X+70 P1Y+60")
        self.assertEqual([p[0] for p in self.fk_points(payload)], [10, 10])
        # Without the lines below, a contour still open at the selection's end may run on.
        payload = self.run_on(8, 12, below=False)
        self.assertEqual([p[0] for p in self.fk_points(payload)], [10, 10, 12])

    def test_a_reference_to_a_block_above_the_selection_leaves_the_contour(self):
        program = "\n".join([
            "0 BEGIN PGM FK MM", "1 L X+10 Y+10 R0 FMAX", "2 L X+30 Y+10", "3 FPOL X+50 Y+50", "4 FL PR+20 PA+20",
            "5 FC DR+ R10 CCX+60 CCY+50 RX 2", "6 FLT P1X+40 P1Y+70", "7 L X+0 Y+0", "8 END PGM FK MM",
        ])
        payload = self.run_on(4, 8, program)
        self.assertEqual([p[:2] for p in self.fk_points(payload)], [(6, "CCX+60"), (7, "P1X+40")])
        # The same contour with the block it names in the selection moves.
        payload = self.run_on(3, 8, program)
        self.assertEqual(lines_of(payload)[3], "5 FC DR+ R10 CCX+65 CCY+50 RX 2")
        self.assertEqual(self.fk_points(payload), [])


def lines_of(payload):
    return payload["text"].split("\n")


def reasons(payload):
    return [finding["reason"] for finding in payload["findings"]]


def finding_at(payload, line):
    found = [f for f in payload["findings"] if f["line"] == line]
    if len(found) != 1:
        raise AssertionError("expected one finding at line %d, got %r" % (line, found))
    return found[0]


def shape_of(lines, cp):
    """The tokens of a program with the values blanked: kinds and addresses must survive."""
    gedit_nc = helpers.import_gedit_nc()
    out = []
    state = None
    for line in lines:
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        out.append(
            [
                (token.kind, token.address, "<value>" if token.kind in ("word", "call") else token.text)
                for token in tokens
            ]
        )
    return out


class TestGoldenCases(unittest.TestCase):
    def setUp(self):
        self.cases = helpers.script_cases("address_arithmetic")

    def test_the_fixture_folder_holds_the_cases_the_plan_names(self):
        self.assertTrue(self.cases, "no address_arithmetic fixtures found")
        names = sorted(case.name for case in self.cases)
        self.assertEqual([name for name in REQUIRED_CASES if name not in names], [])

    def test_every_case_produces_its_expected_text_and_envelope(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                result = run_case(case)
                self.assertTrue(result.ok, result.stderr)
                self.assertEqual(result.stderr, "")
                payload = result.json()
                self.assertEqual(sorted(payload), ["findings", "message", "text"])
                self.assertEqual(payload["text"], case.expected_text())
                self.assertEqual({"message": payload["message"], "findings": payload["findings"]}, envelope_of(case))

    def test_the_output_differs_from_the_input_only_inside_values(self):
        gedit_nc = helpers.import_gedit_nc()
        for case in self.cases:
            with self.subTest(case=case.name):
                cp = gedit_nc.compile_profile(context_of(case)["profile"])
                self.assertEqual(shape_of(case.expected_text().split("\n"), cp), shape_of(case.input_lines(), cp))

    def test_the_trailing_newline_survives(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                self.assertEqual(case.expected_text().endswith("\n"), case.input_text().endswith("\n"))

    def test_every_finding_carries_a_reason_of_the_vocabulary_and_a_line_of_the_selection(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                envelope = envelope_of(case)
                first = len(case.preceding_lines()) + 1
                last = first + len(case.input_lines()) - 1
                for finding in envelope["findings"]:
                    self.assertEqual(sorted(finding), ["line", "message", "reason", "severity"])
                    reason = finding["reason"]
                    if reason in BLOCK_REASONS:
                        self.assertEqual(finding["severity"], "warning")
                    elif reason in ("unreadable", "fk-point"):
                        self.assertEqual(finding["severity"], "warning")  # M13 review NC-5, B1 fix NC (NC-03)
                    elif reason in WORD_REASONS or reason in NOTE_REASONS:
                        self.assertEqual(finding["severity"], "info")
                    else:
                        self.assertIn(reason, RUN_REASONS)
                    self.assertTrue(first <= finding["line"] <= last, finding)

    def test_a_refused_block_gets_exactly_one_finding_and_no_word_finding(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                findings = envelope_of(case)["findings"]
                blocks = [f["line"] for f in findings if f["reason"] in BLOCK_REASONS]
                self.assertEqual(len(blocks), len(set(blocks)))
                words = [f["line"] for f in findings if f["reason"] in WORD_REASONS | NOTE_REASONS]
                self.assertEqual([line for line in words if line in blocks], [])

    def test_the_message_ends_with_the_machine(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                message = envelope_of(case)["message"]
                name = case.options.get("machineName")
                if name:
                    self.assertIn("Machine '%s': " % name, message)
                else:
                    self.assertTrue(message.endswith("No machine chosen: words whose reading depends on the machine are left alone."))


class TestPlanCases(unittest.TestCase):
    """The plan's own numbers, read from the goldens' outputs line by line."""

    def text_of(self, name):
        result = run_case(case_named(name))
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_z1000_reads_as_the_machine_reads_it_and_z10_point_is_the_same_everywhere(self):
        for name, z1000 in (("fanuc-z-is-b", "G1 Z500 F200."), ("fanuc-z-calculator", "G1 Z999.5 F200.")):
            with self.subTest(case=name):
                lines = lines_of(self.text_of(name))
                self.assertEqual(lines[6], z1000)
                self.assertEqual(lines[7], "G1 Z9.5")
        payload = self.text_of("fanuc-z-no-machine")
        self.assertEqual(lines_of(payload)[6], "G1 Z1000 F200.")
        self.assertEqual(lines_of(payload)[7], "G1 Z9.5")
        self.assertEqual(finding_at(payload, 7)["reason"], "machine-dependent")
        self.assertIn("choose a machine", finding_at(payload, 7)["message"])

    def test_a_rounded_result_is_written_and_reported(self):
        payload = self.text_of("fanuc-rounded-is-b")
        self.assertEqual(lines_of(payload)[4], "G1 Z1001 F200.")
        self.assertEqual(finding_at(payload, 5)["reason"], "rounded")

    def test_an_okuma_unit_scales_a_word_with_a_point_too(self):
        lines = lines_of(self.text_of("okuma-10um"))
        self.assertEqual(lines[4], "G1 Z950 F0.2")
        self.assertEqual(lines[5], "G1 Z-40.")

    def test_a_lathe_shift_reports_the_w_words(self):
        payload = self.text_of("lathe-z-shift")
        self.assertEqual(lines_of(payload)[6], "G1 Z-10.5 F0.2")
        self.assertEqual(lines_of(payload)[7], "W-5.")
        self.assertEqual(finding_at(payload, 8)["reason"], "incremental")

    def test_an_okuma_expression_is_left(self):
        payload = self.text_of("okuma-expression")
        self.assertEqual(lines_of(payload)[3], "G90 G0 X=V1+2 Z10.5")
        self.assertEqual([f["reason"] for f in payload["findings"] if f["line"] == 4], ["expression"])

    def test_multiply_leaves_the_count_of_a_g83_alone(self):
        payload = self.text_of("fanuc-multiply-g83")
        self.assertEqual(lines_of(payload)[6], "G81 X10. Y10. Z-10. R4. F100. K3")
        self.assertEqual(finding_at(payload, 7)["reason"], "count")
        # M10 review (CODE-8): the peck depth Q is a distance a multiply does not scale, so
        # the G83 and its positions are left whole and listed.
        self.assertEqual(lines_of(payload)[9], "G83 X30. Y10. Z-5. R2. Q1. F100.")
        self.assertEqual([finding_at(payload, line)["reason"] for line in (10, 11)], ["not-scaled"] * 2)
        # Only Z is chosen, so only its centre word K is an arc centre here; I and J stay.
        self.assertEqual(lines_of(payload)[12], "G2 X10. Y0. I5. J0. Z-4.")
        # An incremental distance scales like a position.
        self.assertEqual(lines_of(payload)[13], "G91 G1 Z-2.")

    def test_a_diamof_section_moves_by_half_the_diameter(self):
        lines = lines_of(self.text_of("sinumerik-diamof"))
        self.assertEqual(lines[3], "N20 G0 X50.5 Z2")
        self.assertEqual(lines[6], "N50 G1 X20.25 Z-20")
        self.assertEqual(lines[8], "N70 G1 X30.5 Z-25")

    def test_klartext_q203_moves_with_z_and_a_call_with_its_own_position_is_refused(self):
        payload = self.text_of("klartext-cycles")
        lines = lines_of(payload)
        self.assertEqual(lines[12], "  Q203=+0.5 ;SURFACE ~")
        self.assertEqual(lines[24], "  Q203=-2 ;SURFACE ~")
        self.assertEqual(finding_at(payload, 29)["reason"], "cycle-position")
        self.assertEqual(finding_at(payload, 19)["reason"], "cycle-position")

    def test_sinumerik_cycle_positions_move_unless_a_mode_says_otherwise(self):
        payload = self.text_of("sinumerik-cycle83")
        lines = lines_of(payload)
        self.assertEqual(lines[4], "N40 CYCLE81(10.5,0.5,2,-29.5,,1)")
        self.assertEqual(lines[5], "N50 MCALL CYCLE83(10.5, 0.5, 2, -29.5, , -4.5, , 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0)")
        self.assertEqual(finding_at(payload, 10)["reason"], "cycle-mode")

    def test_the_blocks_of_a_cycle800_frame_are_refused(self):
        payload = self.text_of("sinumerik-cycle800")
        self.assertEqual([finding_at(payload, line)["reason"] for line in (6, 7, 8)], ["frame"] * 3)
        self.assertEqual(lines_of(payload)[4], "N40 G0 Z50.5")
        self.assertEqual(lines_of(payload)[9], "N90 G0 Z100.5")

    def test_a_rotary_move_is_judged_under_traori_and_refused_without_it(self):
        payload = self.text_of("sinumerik-traori")
        # The first block that writes A and C ends at A0 C0, where Z is a height above the part.
        self.assertEqual(lines_of(payload)[2], "N20 G0 X0 Y0 Z100.5 A0 C0")
        self.assertEqual(lines_of(payload)[4], "N40 G1 X10 Y0 Z5.5 A30 C45 F500")
        self.assertEqual(finding_at(payload, 7)["reason"], "rotary-without-tcp")
        self.assertEqual(finding_at(payload, 9)["reason"], "machine-position")


class TestRules(unittest.TestCase):
    def test_only_the_chosen_address_changes(self):
        payload = run("G90 G17\nG1 X10. Y10. Z5. F100.\n", addresses=["Z"])
        self.assertEqual(lines_of(payload)[1], "G1 X10. Y10. Z5.5 F100.")

    def test_a_comment_is_never_touched(self):
        payload = run("G90 G17\nG1 Z5. (Z10.)\n")
        self.assertEqual(lines_of(payload)[1], "G1 Z5.5 (Z10.)")

    def test_the_operations(self):
        program = "G90 G17\nG1 Z10.\n"
        expected = {"add": "G1 Z10.5", "subtract": "G1 Z9.5", "multiply": "G1 Z5.", "divide": "G1 Z20."}
        for operation, line in expected.items():
            with self.subTest(operation=operation):
                self.assertEqual(lines_of(run(program, operation=operation, operand=0.5))[1], line)

    def test_a_negative_factor_flips_the_sign(self):
        self.assertEqual(lines_of(run("G90 G17\nG1 Z10.\n", operation="multiply", operand=-1))[1], "G1 Z-10.")

    def test_arc_centres_are_left_when_adding_and_included_when_multiplying(self):
        program = "G90 G17\nG2 X10. Y0. I5. J0.\n"
        self.assertEqual(lines_of(run(program, addresses=["X"]))[1], "G2 X10.5 Y0. I5. J0.")
        self.assertEqual(lines_of(run(program, addresses=["X"], arcCentres="yes"))[1], "G2 X10.5 Y0. I5.5 J0.")
        # NCR-8 (v1.2.0): an arc is scaled only with both axes of its plane.
        self.assertEqual(lines_of(run(program, operation="multiply", operand=2, addresses=["X", "Y"]))[1], "G2 X20. Y0. I10. J0.")
        self.assertEqual(lines_of(run(program, operation="multiply", operand=2, addresses=["X", "Y"], arcCentres="no"))[1], "G2 X20. Y0. I5. J0.")

    def test_the_centre_word_of_a_diameter_axis_moves_as_a_radius(self):
        payload = run("G18 G90\nG2 X50. Z-10. I2. K0.\n", profile="fanuc-lathe", addresses=["X"], arcCentres="yes")
        self.assertEqual(lines_of(payload)[1], "G2 X50.5 Z-10. I2.25 K0.")

    def test_a_count_chosen_explicitly_is_changed(self):
        payload = run("G90 G17\nG83 X10. Y10. Z-5. R2. Q1. F100. K3\nG80\n", operation="multiply", operand=2, addresses=["K"])
        self.assertEqual(lines_of(payload)[1], "G83 X10. Y10. Z-5. R2. Q1. F100. K6")

    def test_the_r_plane_moves_with_z_and_alone_when_r_is_chosen(self):
        program = "G90 G17\nG81 X10. Y10. Z-5. R2. F100.\nX20. R3.\nG80\n"
        self.assertEqual(lines_of(run(program))[1:3], ["G81 X10. Y10. Z-4.5 R2.5 F100.", "X20. R3.5"])
        self.assertEqual(lines_of(run(program, addresses=["R"]))[1:3], ["G81 X10. Y10. Z-5. R2.5 F100.", "X20. R3.5"])
        self.assertEqual(lines_of(run(program, addresses=["X"]))[1:3], ["G81 X10.5 Y10. Z-5. R2. F100.", "X20.5 R3."])

    def test_an_incremental_cycle_block_moves_nothing(self):
        payload = run("G90 G17\nG91 G81 X10. Z-7. R-48. F100.\nG90 G80\n")
        self.assertEqual(lines_of(payload)[1], "G91 G81 X10. Z-7. R-48. F100.")
        self.assertEqual(reasons(payload), ["incremental", "incremental"])

    def test_a_cycle_is_moved_in_one_piece_or_not_at_all(self):
        payload = run("G90 G17\nG81 X10. Y10. Z-5. R2. F100.\nX20. Y20.\nX30. Y30. Z#1\nG80\nG1 Z5.\n")
        self.assertEqual(lines_of(payload)[1], "G81 X10. Y10. Z-5. R2. F100.")
        self.assertEqual(lines_of(payload)[5], "G1 Z5.5")
        self.assertEqual(reasons(payload), ["cycle-expression"] * 3)
        self.assertIn("same cycle as line 4", finding_at(payload, 2)["message"])

    def test_a_zero_every_preset_reads_alike_is_still_written_differently_by_each(self):
        # `Z0` is 0 mm on every Fanuc preset, but 0.5 mm is `Z500` in IS-B and `Z0.5` as
        # written: with no machine chosen the word is left, never written the default's way.
        payload = run("G90 G17\nG1 Z0\n")
        self.assertEqual(lines_of(payload)[1], "G1 Z0")
        self.assertEqual(reasons(payload), ["machine-dependent"])
        self.assertEqual(lines_of(run("G90 G17\nG1 Z0\n", preset="is-b", name="Mill"))[1], "G1 Z500")

    def test_a_point_less_cycle_position_without_a_machine_refuses_the_cycle(self):
        payload = run("G90 G17\nG81 X10. Y10. Z-5. R2 F100.\nG80\n")
        self.assertEqual(lines_of(payload)[1], "G81 X10. Y10. Z-5. R2 F100.")
        self.assertEqual(reasons(payload), ["cycle-unresolved"])

    def test_a_cycle_parameter_nobody_reviewed_refuses_the_block(self):
        payload = run("G90 G17\nG81 X10. Y10. Z-5. R2. F100. E5.\nG80\n")
        self.assertEqual(reasons(payload), ["cycle-not-reviewed"])

    def test_a_plane_other_than_xy_refuses_a_cycle_with_a_tool_axis_position(self):
        payload = run("G90 G18\nG81 X10. Y10. Z-5. R2. F100.\nG80\n")
        self.assertEqual(reasons(payload), ["cycle-plane"])
        payload = run("G90\nG81 X10. Y10. Z-5. R2. F100.\nG80\n")
        self.assertEqual(reasons(payload), ["cycle-plane"])

    def test_a_modal_macro_call_refuses_its_positions(self):
        payload = run("G90 G17\nG66 P9001 Z-5.\nX10. Y10.\nG67\nG1 Z5.\n")
        self.assertEqual(reasons(payload), ["cycle-not-reviewed", "cycle-not-reviewed"])
        self.assertEqual(lines_of(payload)[4], "G1 Z5.5")

    def test_machine_positions_are_refused(self):
        payload = run("G90 G17\nG53 Z0.\nG28 G91 Z0.\n")
        self.assertEqual(reasons(payload), ["machine-position", "machine-position"])
        payload = run("0 BEGIN PGM T MM\n1 L Z-5 R0 FMAX M91\n2 END PGM T MM\n", profile="heidenhain-klartext")
        self.assertEqual(reasons(payload), ["machine-position"])

    def test_a_frame_refuses_the_blocks_inside_it_until_it_closes(self):
        payload = run("G90 G17\nG68 X0. Y0. R30.\nG1 Z-1.\nG69\nG1 Z-2.\n")
        self.assertEqual(reasons(payload), ["frame", "frame"])
        self.assertEqual(lines_of(payload)[4], "G1 Z-1.5")

    def test_a_scaling_frame_is_not_closed_by_the_rotation_close(self):
        payload = run("G90 G17\nG51 X0. Y0. Z0. P2.\nG69\nG1 Z-2.\nG50\nG1 Z-3.\n")
        self.assertEqual(reasons(payload), ["frame", "frame"])
        self.assertEqual(lines_of(payload)[5], "G1 Z-2.5")

    def test_an_unknown_g_code_refuses_its_block(self):
        payload = run("G90 G17\nG100 Z-3.\n")
        self.assertEqual(reasons(payload), ["unknown-code"])

    def test_data_words_are_left_and_the_rest_of_the_block_changed(self):
        payload = run("G90 G17\nG92 X0. Y0. Z0.\nG52 Z5.\nG10 L2 P1 Z-100.\n")
        self.assertEqual(reasons(payload), ["data", "data", "data"])
        self.assertEqual(lines_of(payload)[1:4], ["G92 X0. Y0. Z0.", "G52 Z5.", "G10 L2 P1 Z-100."])

    def test_an_unknown_distance_mode_leaves_every_word(self):
        payload = run("G17\nG1 Z5.\n")
        self.assertEqual(reasons(payload), ["incremental"])
        self.assertIn("not known", payload["findings"][0]["message"])

    def test_a_rotary_move_without_tcp_is_refused_and_judged_under_it(self):
        program = "G90 G17\nG1 Z5. B30.\nG43.4 H1\nG1 Z5. B30.\nG49\nG1 Z5. B30.\n"
        payload = run(program)
        self.assertEqual([f["line"] for f in payload["findings"]], [2, 6])
        self.assertEqual(lines_of(payload)[3], "G1 Z5.5 B30.")
        # A rotary move that does not move a chosen axis is no shift at all.
        self.assertEqual(run("G90 G17\nG1 X5. B30.\n")["findings"], [])

    def test_klartext_q203_is_absolute_and_its_decimal_comma_survives(self):
        program = "0 BEGIN PGM T MM\n1 TOOL CALL 1 Z S3000\n2 CYCL DEF 200 DRILLING ~\n  Q203=+0,5 ;SURFACE ~\n  Q204=50 ;2ND\n3 L X+10 Y+10 Z+5 R0 FMAX M99\n4 END PGM T MM\n"
        payload = run(program, profile="heidenhain-klartext")
        self.assertEqual(lines_of(payload)[3], "  Q203=+1,0 ;SURFACE ~")
        self.assertEqual(lines_of(payload)[5], "3 L X+10 Y+10 Z+5.5 R0 FMAX M99")

    def test_klartext_without_a_tool_axis_refuses_the_cycle(self):
        program = "0 BEGIN PGM T MM\n1 CYCL DEF 200 DRILLING ~\n  Q203=+0 ;SURFACE\n2 L X+10 Y+10 Z+5 R0 FMAX M99\n3 END PGM T MM\n"
        payload = run(program, profile="heidenhain-klartext")
        self.assertEqual(reasons(payload), ["cycle-plane", "cycle-plane"])
        self.assertEqual(lines_of(payload)[3], "2 L X+10 Y+10 Z+5 R0 FMAX M99")

    def test_klartext_a_call_with_no_cycle_defined_is_refused(self):
        payload = run("0 BEGIN PGM T MM\n1 TOOL CALL 1 Z S3000\n2 L X+10 Y+10 Z+5 R0 FMAX M99\n3 END PGM T MM\n", profile="heidenhain-klartext")
        self.assertEqual(reasons(payload), ["cycle-not-reviewed"])

    def test_klartext_r0_is_a_code_and_never_a_value(self):
        # A corner rounding of a chosen R is changed as asked (an arc radius no longer is under a
        # shift, NCR-5); the R0 of the move beside it is a code.
        payload = run("0 BEGIN PGM T MM\n1 L X+10 R0 FMAX\n2 RND R5\n3 L X+20 Y+0\n4 END PGM T MM\n", profile="heidenhain-klartext", addresses=["R"])
        self.assertEqual(lines_of(payload)[1:3], ["1 L X+10 R0 FMAX", "2 RND R5.5"])

    def test_sinumerik_cycle_positions_are_absolute_under_g91(self):
        payload = run("N10 G17 G91\nN20 CYCLE81(10,0,2,-30)\n", profile="sinumerik-mill")
        self.assertEqual(lines_of(payload)[1], "N20 CYCLE81(10.5,0.5,2,-29.5)")

    def test_sinumerik_extra_arguments_are_not_reviewed(self):
        payload = run("N10 G17 G90\nN20 CYCLE87(10,0,2,-30,,3,7)\n", profile="sinumerik-mill")
        self.assertEqual(reasons(payload), ["cycle-not-reviewed"])

    def test_sinumerik_a_variable_tool_axis_position_refuses_the_call_on_a_z_shift_only(self):
        program = "N10 G17 G90\nN20 CYCLE81(10,R1,2,-30)\n"
        self.assertEqual(reasons(run(program, profile="sinumerik-mill")), ["cycle-expression"])
        self.assertEqual(run(program, profile="sinumerik-mill", addresses=["X"])["findings"], [])

    def test_a_lathe_cycle_is_refused_and_listed(self):
        # Manual-check fix round (D5-8, B2): the lathe's drilling cycles are reviewed now, and in
        # G-code system B the R word follows G90/G91 (other), so the cycle is refused for its
        # positions and listed.
        payload = run("G18 G90\nG83 X0 Z-20. R2. Q5000 F0.1\nG80\n", profile="fanuc-lathe", variant=("gcodeSystem", "B"))
        self.assertEqual(reasons(payload), ["cycle-position"])

    def test_the_x_operand_as_a_radius_doubles_on_a_diameter_word(self):
        payload = run("G18 G90\nG0 X50. Z2.\n", profile="fanuc-lathe", addresses=["X"], xOperand="radius")
        self.assertEqual(lines_of(payload)[1], "G0 X51. Z2.")

    def test_the_decimals_option(self):
        payload = run("G90 G17\nG1 Z1.\n", operation="divide", operand=3, decimals="3")
        self.assertEqual(lines_of(payload)[1], "G1 Z0.333")
        self.assertEqual(reasons(payload), ["rounded"])
        payload = run("G90 G17\nG1 Z1.\n", operation="divide", operand=3)
        self.assertEqual(lines_of(payload)[1], "G1 Z0.3333")

    def test_as_written_adds_the_decimals_the_result_needs(self):
        self.assertEqual(lines_of(run("G90 G17\nG1 Z10.\n", operand=0.125))[1], "G1 Z10.125")
        self.assertEqual(lines_of(run("G90 G17\nG1 Z10.1234\n", operand=0.5))[1], "G1 Z10.6234")

    def test_adding_zero_changes_nothing(self):
        program = "G90 G17\nG81 X10. Y10. Z-5. R2. F100.\nG80\nG1 Z1.\n"
        payload = run(program, operand=0)
        self.assertEqual(payload["text"], program)
        self.assertTrue(payload["message"].startswith("Changed nothing."))

    def test_the_message_names_what_was_done_and_left(self):
        payload = run("G90 G17\nG1 Z1.\nG53 Z0.\nG1 Z#1\n", name="Mill 1", preset="is-b")
        self.assertEqual(
            payload["message"],
            "Added 0.5 to Z in 1 word on 1 block. Left 1 block and 1 word as written: 1 machine position, "
            "1 variable or expression. Machine 'Mill 1': numbers without a point are increments of 0.001 mm.",
        )


class TestSelectionPriming(unittest.TestCase):
    def setUp(self):
        self.case = case_named("fanuc-selection-primed")

    def test_a_cycle_started_above_the_selection_refuses_its_blocks_in_it(self):
        payload = run_case(self.case).json()
        self.assertEqual(reasons(payload), ["cycle-outside", "cycle-outside"])
        self.assertEqual(lines_of(payload)[3], "G0 Z50.5")

    def test_without_the_lines_above_it_the_selection_says_what_it_cannot_see(self):
        context = context_of(self.case)
        context["input"] = dict(context["input"])
        context["input"].pop("precedingLines")
        result = helpers.run_script(SCRIPT, stdin=self.case.input_text(), context=context)
        payload = result.json()
        self.assertEqual(payload["findings"][0]["reason"], "selection")
        self.assertEqual(lines_of(payload)[3], "G0 Z50.")
        self.assertNotIn("cycle-outside", reasons(payload))

    def test_preceding_lines_that_are_not_all_the_lines_above_are_refused(self):
        context = context_of(self.case)
        context["input"] = dict(context["input"])
        context["input"]["precedingLines"] = context["input"]["precedingLines"][1:]
        payload = helpers.run_script(SCRIPT, stdin=self.case.input_text(), context=context).json()
        self.assertEqual(payload["findings"][0]["reason"], "selection")


#: The dialect of each folder of `tests/fixtures/nc/`.
FIXTURE_PROFILES = {
    "fanuc": "fanuc-gcode",
    "fanuc-lathe": "fanuc-lathe",
    "heidenhain": "heidenhain-klartext",
    "okuma": "okuma-osp",
    "sinumerik": "sinumerik",
    "sinumerik-mill": "sinumerik-mill",
}

#: Programs longer than this are left to the runtime scenario `m10-perf` (H10).
FIXTURE_MAX_LINES = 10000


def fixture_programs():
    """``(profile, path)`` of every committed NC fixture short enough for a unit test."""
    root = helpers.FIXTURES_DIR / "nc"
    out = []
    for folder, profile in FIXTURE_PROFILES.items():
        out += [(profile, path) for path in sorted((root / folder).iterdir()) if path.is_file()]
    for folder in sorted((root / "owner-public").iterdir()):
        out += [(folder.name, path) for path in sorted(folder.iterdir()) if path.is_file()]
    return out


def fixture_text(path):
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp1252")
    return text.replace("\r\n", "\n").replace("\r", "\n")


class TestFixturePrograms(unittest.TestCase):
    """Every committed program, synthetic and the owner's public ones: adding zero changes
    nothing, and a shift changes nothing but values (the invariant that matters most)."""

    def test_adding_zero_hands_every_program_back_unchanged_and_a_shift_only_changes_values(self):
        gedit_nc = helpers.import_gedit_nc()
        checked = 0
        for profile, path in fixture_programs():
            text = fixture_text(path)
            if text.count("\n") > FIXTURE_MAX_LINES or not text.strip():
                continue
            with self.subTest(program="%s/%s" % (path.parent.name, path.name)):
                zero = run(text, profile=profile, operand=0, addresses=["X", "Y", "Z"])
                self.assertEqual(zero["text"], text)
                shifted = run(text, profile=profile, operand=0.5, addresses=["X", "Z"])
                cp = gedit_nc.compile_profile(helpers.effective_context(profile)["profile"])
                self.assertEqual(shape_of(shifted["text"].split("\n"), cp), shape_of(text.split("\n"), cp))
                for finding in shifted["findings"]:
                    self.assertIn(finding["reason"], BLOCK_REASONS | WORD_REASONS | NOTE_REASONS | RUN_REASONS)
                checked += 1
        self.assertGreater(checked, 30)


class TestHeader(unittest.TestCase):
    PARAMS = ["operation", "operand", "addresses", "arcCentres", "xOperand", "decimals"]
    FIELD_TYPES = ("number", "integer", "text", "bool", "choice", "file", "folder", "address-list")

    def header_source(self):
        lines = (helpers.SCRIPTS_DIR / SCRIPT).read_text(encoding="utf-8").split("\n")
        i = 1 if lines[0].startswith("#!") else 0
        self.assertEqual(lines[i].strip(), "# /// gedit")
        body = []
        i += 1
        while lines[i].strip() != "# ///":
            self.assertTrue(lines[i].startswith("#"), lines[i])
            body.append(lines[i][2:] if lines[i].startswith("# ") else lines[i][1:])
            i += 1
        return "\n".join(body)

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_the_header_is_the_toml_the_backend_expects(self):
        import tomllib

        meta = tomllib.loads(self.header_source())
        self.assertEqual(meta["name"], "Address arithmetic")
        self.assertEqual(meta["output"], "replace")
        self.assertEqual(meta["input"], "selection-or-document")
        self.assertIs(meta["envelope"], True)
        self.assertNotIn("profiles", meta)

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_the_form_ids_are_the_pinned_ones(self):
        import tomllib

        params = tomllib.loads(self.header_source())["params"]
        self.assertEqual([param["id"] for param in params], self.PARAMS)
        by_id = {param["id"]: param for param in params}
        self.assertEqual([c["value"] for c in by_id["operation"]["choices"]], ["add", "subtract", "multiply", "divide"])
        self.assertEqual(by_id["addresses"]["default"], ["Z"])
        self.assertEqual(by_id["addresses"]["type"], "address-list")
        offered = [c["value"] for c in by_id["addresses"]["choices"]]
        self.assertEqual([a for a in offered if a in ("G", "M", "N", "O", "T")], [])
        self.assertEqual([c["value"] for c in by_id["arcCentres"]["choices"]], ["auto", "yes", "no"])
        self.assertEqual([c["value"] for c in by_id["xOperand"]["choices"]], ["diameter", "radius"])
        self.assertEqual(by_id["xOperand"]["default"], "diameter")
        self.assertEqual([c["value"] for c in by_id["decimals"]["choices"]], ["keep", "0", "1", "2", "3", "4"])
        self.assertIs(by_id["operand"]["required"], True)
        for param in params:
            with self.subTest(param=param["id"]):
                self.assertIn(param["type"], self.FIELD_TYPES)
                self.assertTrue(param["label"])
                if param["type"] == "choice":
                    self.assertIn(param["default"], [c["value"] for c in param["choices"]])

    def test_the_declared_parameters_are_the_ones_the_script_reads(self):
        source = (helpers.SCRIPTS_DIR / SCRIPT).read_text(encoding="utf-8")
        body = source.split("# ///", 2)[-1]
        for name in self.PARAMS:
            with self.subTest(param=name):
                self.assertIn('"%s"' % name, body)


class TestRunEnvironment(unittest.TestCase):
    def test_without_a_context_it_says_what_it_needs_and_writes_nothing_to_stdout(self):
        result = helpers.run_script(SCRIPT, stdin="G1 Z1.\n", context=None)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("needs a dialect profile", result.stderr)

    def test_a_form_that_cannot_be_used_is_refused_rather_than_guessed(self):
        bad = [
            {"operation": "divide", "operand": 0},
            {"operation": "multiply", "operand": 0},
            {"operation": "add"},
            {"operation": "add", "operand": "abc"},
            {"operation": "power", "operand": 2},
            {"operation": "add", "operand": 1, "addresses": []},
            {"operation": "add", "operand": 1, "addresses": ["G"]},
            {"operation": "add", "operand": 1, "decimals": "11"},
        ]
        for params in bad:
            with self.subTest(params=params):
                context = helpers.effective_context("fanuc-gcode")
                context["params"] = params
                result = helpers.run_script(SCRIPT, stdin="G90\nG1 Z1.\n", context=context)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertTrue(result.stderr.startswith("Address arithmetic: "), result.stderr)

    def test_a_run_without_a_code_database_changes_nothing_and_says_so(self):
        context = helpers.effective_context("fanuc-gcode")
        context["codes"] = []
        context["params"] = {"operation": "add", "operand": 1}
        payload = helpers.run_script(SCRIPT, stdin="G90\nG1 Z1.\n", context=context).json()
        self.assertEqual(payload["text"], "G90\nG1 Z1.\n")
        self.assertEqual(reasons(payload), ["no-database"])

    def test_findings_are_capped_and_counted(self):
        program = "G91\n" + "G1 Z1.\n" * 600
        payload = run(program)
        self.assertEqual(len(payload["findings"]), 500)
        self.assertIn("100 further findings are not listed.", payload["message"])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()


def words_of(line, address):
    """The values of every ``address`` word of one line, as written (``X20.``: ``'20.'``)."""
    import re

    return re.findall(r"(?<![A-Z0-9_])%s(-?[0-9.]+)" % address, line)


class TestReviewFindings(unittest.TestCase):
    """The M10 review: each test fails without its fix."""

    def text_of(self, name):
        result = run_case(case_named(name))
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    # NC-1 ------------------------------------------------------------------

    def test_an_x_shift_on_a_milling_profile_moves_x_by_the_value_itself(self):
        path = helpers.FIXTURES_DIR / "nc" / "owner-public" / "sinumerik-mill" / "DRILLING.mpf"
        text = fixture_text(path)
        payload = run(text, profile="sinumerik-mill", operand=0.5, addresses=["X"])
        self.assertNotIn("diameter", payload["message"])
        moved = 0
        for old, new in zip(text.split("\n"), lines_of(payload)):
            if old == new:
                continue
            before, after = words_of(old, "X"), words_of(new, "X")
            self.assertEqual(len(before), len(after), old)
            for a, b in zip(before, after):
                self.assertEqual(Decimal(b) - Decimal(a), Decimal("0.5"), (old, new))
                moved += 1
        self.assertGreater(moved, 50)
        self.assertIn("N70 G0 G17 X20.5 Y20", lines_of(payload))

    def test_a_diamon_word_on_a_mill_moves_by_twice_the_value(self):
        payload = self.text_of("sinumerik-mill-x-shift")
        lines = lines_of(payload)
        self.assertEqual(lines[4], "N40 G0 X11 Y10 Z50")
        self.assertEqual(lines[8], "N80 G1 X42 Y10")
        self.assertNotIn("(as a", payload["message"])
        self.assertNotIn("radius", payload["message"])

    def test_a_lathe_still_reads_the_operand_as_a_diameter(self):
        lines = lines_of(self.text_of("sinumerik-diamof"))
        self.assertEqual(lines[6], "N50 G1 X20.25 Z-20")

    # NC-2 ------------------------------------------------------------------

    def test_an_absolute_klartext_pole_moves_with_x_and_y_and_an_incremental_one_does_not(self):
        payload = self.text_of("klartext-polar")
        lines = lines_of(payload)
        self.assertEqual(lines[7], "7 CC X+55 Y+55")
        self.assertEqual(lines[11], "11 C X+55 Y+65 DR-")
        self.assertEqual(lines[12], "12 CC IX+10 IY+0")
        self.assertNotIn("not a position", " ".join(f["message"] for f in payload["findings"] if f["line"] == 8))

    def test_a_pole_that_cannot_be_moved_is_refused_with_the_moves_around_it(self):
        payload = self.text_of("klartext-polar")
        self.assertEqual([finding_at(payload, line)["reason"] for line in (15, 16, 17)], ["pole"] * 3)
        self.assertEqual(lines_of(payload)[16], "16 C X+70 Y+50 DR+")

    def test_a_z_shift_leaves_the_pole_alone(self):
        case = case_named("klartext-polar")
        payload = run(case.input_text(), profile="heidenhain-klartext", operand=5, addresses=["Z"])
        self.assertEqual(lines_of(payload)[7], "7 CC X+50 Y+50")
        self.assertNotIn("pole", reasons(payload))

    def test_a_multiply_refuses_the_contour_around_a_pole(self):
        case = case_named("klartext-polar")
        payload = run(case.input_text(), profile="heidenhain-klartext", operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[7], "7 CC X+50 Y+50")
        self.assertEqual(finding_at(payload, 8)["reason"], "pole")

    # NC-3 ------------------------------------------------------------------

    def test_absolute_arc_centres_and_intermediate_points_move_with_the_end_point(self):
        lines = lines_of(self.text_of("sinumerik-arc-geometry"))
        self.assertEqual(lines[6], "N60 G2 X75 Y55 I=AC(55) J=AC(55)")
        self.assertEqual(lines[7], "N70 G3 X35 Y55 I-20 J0")
        self.assertEqual(lines[8], "N80 CIP X75 Y55 I1=55 J1=75")
        self.assertEqual(lines[9], "N90 CIP X35 Y55 I1=AC(55) J1=AC(35)")
        self.assertEqual(lines[10], "N100 G91 CIP X10 Y10 I1=5 J1=8")
        self.assertEqual(lines[11], "N110 G90 G1 Z=AC(8.25)")

    def test_an_arc_whose_geometry_cannot_be_computed_is_refused_whole(self):
        payload = self.text_of("sinumerik-arc-geometry")
        self.assertEqual([finding_at(payload, line)["reason"] for line in (13, 14)], ["arc-geometry"] * 2)
        self.assertEqual(lines_of(payload)[12], "N120 G2 X70 Y50 I=AC(R1) J=AC(50)")

    def test_a_multiply_scales_an_absolute_centre_too(self):
        payload = run("G17 G90\nG2 X70 Y50 I=AC(50) J=AC(50)\n", profile="sinumerik-mill", operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[1], "G2 X140 Y100 I=AC(100) J=AC(100)")

    # NC-4 ------------------------------------------------------------------

    def test_a_tilted_rotary_axis_refuses_the_linear_words_it_turns_until_it_is_zero(self):
        payload = self.text_of("fanuc-rotary-state")
        lines = lines_of(payload)
        self.assertEqual([finding_at(payload, line)["reason"] for line in (7, 10, 11, 12, 13, 21)], ["rotary-without-tcp"] * 6)
        self.assertEqual(lines[9], "G0 X0. Y0. Z50.")
        self.assertEqual(lines[14], "G0 X20. Y20. Z50.5")  # B0 C30: C does not turn Z
        self.assertEqual(lines[18], "G1 X5. Y5. Z5.5 B30. C10.")  # under G43.4

    def test_the_owner_public_five_axis_program_keeps_every_z_of_its_toolpath(self):
        path = helpers.FIXTURES_DIR / "nc" / "owner-public" / "fanuc-gcode" / "5-Axis.NC"
        text = fixture_text(path)
        payload = run(text, operand=0.5, addresses=["Z"])
        self.assertEqual(payload["text"], text)
        self.assertEqual(set(reasons(payload)), {"rotary-without-tcp"})

    def test_a_cycle_position_under_a_turned_rotary_axis_is_refused(self):
        payload = run("G90 G17\nG0 B90. C0.\nG81 X10. Y10. R3. F100.\nG80\n", operand=0.5, addresses=["Z"])
        self.assertEqual(lines_of(payload)[2], "G81 X10. Y10. R3. F100.")
        self.assertEqual(reasons(payload), ["rotary-without-tcp"])
        self.assertEqual(lines_of(run("G90 G17\nG0 B0. C0.\nG81 X10. Y10. R3. F100.\nG80\n", operand=0.5, addresses=["Z"]))[2], "G81 X10. Y10. R3.5 F100.")

    def test_a_c_axis_lathe_still_shifts_z_and_x(self):
        program = "G18 G90\nG0 X50. Z5. C0.\nG0 C90.\nG1 X40. Z-5. F0.2\n"
        payload = run(program, profile="fanuc-lathe", operand=0.5, addresses=["X", "Z"], xOperand="radius")
        self.assertEqual(lines_of(payload)[3], "G1 X41. Z-4.5 F0.2")
        self.assertEqual(payload["findings"], [])

    # NC-5 ------------------------------------------------------------------

    def test_a_fanuc_polar_coordinate_command_is_a_frame(self):
        payload = self.text_of("fanuc-polar-g16")
        lines = lines_of(payload)
        self.assertEqual(lines[9], "G0 X50. Y45.")
        self.assertEqual(lines[11], "X50. Y135.")
        self.assertEqual(lines[13], "G0 X15. Y15.")
        self.assertEqual([finding_at(payload, line)["reason"] for line in (9, 10, 12)], ["frame"] * 3)

    def test_an_unknown_code_in_a_block_with_nothing_to_change_is_noted(self):
        payload = self.text_of("fanuc-polar-g16")
        note = finding_at(payload, 15)
        self.assertEqual((note["reason"], note["severity"]), ("unknown-code-note", "warning"))
        self.assertTrue(note["message"].startswith("G123: "))

    # NC-6 ------------------------------------------------------------------

    def test_a_macro_call_with_a_chosen_word_is_refused(self):
        program = "G90 G17\nG0 X0. Y0.\nG43 H1 Z50.\nG65 P9810 Z5. F1000.\nG65 P9811 Z0. S1.\nG65 P9000 A1.\nG0 Z50.\n"
        payload = run(program, operand=0.5, addresses=["Z"])
        self.assertEqual([finding_at(payload, line)["reason"] for line in (4, 5)], ["cycle-not-reviewed"] * 2)
        self.assertEqual(lines_of(payload)[3:6], ["G65 P9810 Z5. F1000.", "G65 P9811 Z0. S1.", "G65 P9000 A1."])
        self.assertEqual(lines_of(payload)[2], "G43 H1 Z50.5")
        # The data codes keep their info finding.
        self.assertEqual(reasons(run("G90 G17\nG52 Z5.\n")), ["data"])

    # CODE-8 ------------------------------------------------------------------

    def test_a_multiply_scales_incremental_distances_and_refuses_a_shift(self):
        payload = self.text_of("fanuc-multiply-rule")
        lines = lines_of(payload)
        self.assertEqual(lines[4], "G1 X2. Y4. Z6. F100.")  # before G90: the mode does not matter
        self.assertEqual(lines[7], "G91 G1 X2. Y4. Z-6.")
        self.assertEqual([finding_at(payload, line)["reason"] for line in (10, 12)], ["not-scaled"] * 2)
        self.assertNotIn("shift does not apply", " ".join(f["message"] for f in payload["findings"]))

    def test_an_absolute_value_function_is_moved_and_an_incremental_one_is_left(self):
        payload = run("G17 G90\nG1 Z=AC(3.25)\nG1 Z=IC(2)\n", profile="sinumerik-mill", operand=1, addresses=["Z"])
        self.assertEqual(lines_of(payload)[1:3], ["G1 Z=AC(4.25)", "G1 Z=IC(2)"])
        self.assertEqual(reasons(payload), ["incremental"])


class TestM13ReviewUnreadable(unittest.TestCase):
    """M13 review NC-5: a word whose value cannot be read is reported and counted."""

    PROGRAM = "G00 X10. Z\u20135.\nG00 Z\u22125.\nG01 Z-5. F0.1\n"

    def test_a_dash_pasted_for_the_minus_sign_is_named_and_counted(self):
        payload = run(self.PROGRAM, profile="fanuc-lathe", operation="subtract", operand=0.5, addresses=["Z"])
        self.assertEqual(lines_of(payload)[:3], ["G00 X10. Z\u20135.", "G00 Z\u22125.", "G01 Z-5.5 F0.1"])
        self.assertEqual([(f["line"], f["reason"], f["severity"]) for f in payload["findings"]], [(1, "unreadable", "warning"), (2, "unreadable", "warning")])
        self.assertIn("U+2013 EN DASH, not the ASCII minus sign -", payload["findings"][0]["message"])
        self.assertIn("U+2212 MINUS SIGN", payload["findings"][1]["message"])
        self.assertIn("Left 2 words as written: 2 words that cannot be read.", payload["message"])

    def test_an_address_that_is_not_chosen_says_nothing(self):
        payload = run(self.PROGRAM, profile="fanuc-lathe", operation="subtract", operand=0.5, addresses=["X"])
        self.assertEqual(payload["findings"], [])


class TestP4aReviewLatheCycleValues(unittest.TestCase):
    """P4a review NC-16: since the Fanuc lathe's `G70`-`G76` carry roles (Phase 4 plan §7
    #305), their reviewed values (`position: 'none'`) are values of the cycle: a shift leaves
    them and lists them, and a multiply or divide never scales such a cycle in part."""

    HEAD = "G21 G18 G99\nG0 X50. Z5.\n"

    def lathe(self, body, **params):
        return run(self.HEAD + body + "\nM30\n", profile="fanuc-lathe", **params)

    def test_a_shift_of_r_leaves_the_relief_the_allowance_and_the_taper(self):
        payload = self.lathe("G74 R1.\nG75 R1.\nG76 P020060 Q100 R0.05\nG76 X40. Z-20. R-2. P1000 Q300 F1.5", operand=1, addresses=["R"])
        self.assertEqual(
            lines_of(payload)[2:6],
            ["G74 R1.", "G75 R1.", "G76 P020060 Q100 R0.05", "G76 X40. Z-20. R-2. P1000 Q300 F1.5"],
        )
        self.assertEqual([(f["line"], f["reason"], f["severity"]) for f in payload["findings"]], [(3, "data", "info"), (4, "data", "info"), (5, "data", "info"), (6, "data", "info")])
        self.assertEqual(finding_at(payload, 6)["message"], "R-2.: a value of G76, not a position of this program.")

    def test_a_shift_of_x_and_r_moves_the_end_point_and_leaves_the_values(self):
        payload = self.lathe("G74 X20. Z-30. P3000 Q5000 R0.5 F0.1\nG76 X40. Z-20. R-2. P1000 Q300 F1.5", operand=1, addresses=["X", "R"])
        self.assertEqual(lines_of(payload)[2:4], ["G74 X21. Z-30. P3000 Q5000 R0.5 F0.1", "G76 X41. Z-20. R-2. P1000 Q300 F1.5"])
        self.assertEqual(reasons(payload), ["data", "data"])

    def test_an_arc_radius_outside_a_cycle_is_left_by_a_shift(self):
        # NCR-5 (owner decision 2026-10-18): moving an arc does not change its radius.
        payload = self.lathe("G2 X30. Z-15. R5.", operand=1, addresses=["R"])
        self.assertEqual(lines_of(payload)[2], "G2 X30. Z-15. R5.")
        self.assertEqual(
            [(f["line"], f["reason"], f["severity"], f["message"]) for f in payload["findings"]],
            [(3, "data", "info", "R5.: the radius of the arc of G2; a shift does not change a radius, so it is left as written.")],
        )

    def test_a_multiply_of_x_never_scales_a_thread_or_a_pecking_cycle_in_part(self):
        program = "G74 R1.\nG74 X20. Z-30. P3000 Q5000 F0.1\nG76 P020060 Q100 R0.05\nG76 X40. Z-20. R-2. P1000 Q300 F1.5"
        payload = self.lathe(program, operation="multiply", operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[1:6], ["G0 X100. Z5."] + program.split("\n"))
        self.assertEqual([finding_at(payload, line)["reason"] for line in (3, 4, 5, 6)], ["not-scaled"] * 4)
        self.assertIn("G76 writes R-2.", finding_at(payload, 6)["message"])

    def test_a_multiply_of_z_refuses_the_cycle_too(self):
        payload = self.lathe("G74 R1.\nG74 Z-30. Q5000 F0.1", operation="multiply", operand=2, addresses=["Z"])
        self.assertEqual(lines_of(payload)[3], "G74 Z-30. Q5000 F0.1")
        self.assertEqual(finding_at(payload, 4)["reason"], "not-scaled")

    def test_an_end_point_without_the_lengths_is_not_scaled_either(self):
        # The control takes Q and R from the first block or its own settings, unscaled.
        payload = self.lathe("G76 X40. Z-20. F1.5", operation="multiply", operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[2], "G76 X40. Z-20. F1.5")
        self.assertEqual(
            finding_at(payload, 3)["message"],
            "G76 X40. Z-20. F1.5: G76 has depths or distances of its own (Q and R) that a multiply or divide does not scale, so the cycle cannot be scaled in one piece.",
        )

    def test_an_incremental_end_point_is_refused_like_an_absolute_one(self):
        payload = self.lathe("G74 U-30. W-35. P3000 Q5000 F0.1", operation="multiply", operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[2], "G74 U-30. W-35. P3000 Q5000 F0.1")
        self.assertEqual(finding_at(payload, 3)["reason"], "not-scaled")

    def test_a_multiply_lists_a_roughing_cycle_as_not_scaled(self):
        payload = self.lathe("G71 U2. R0.5\nG71 P10 Q20 U0.4 W0.1 F0.25\nN10 G0 X20.\nN20 G1 Z-10.\nG70 P10 Q20", operation="multiply", operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[2:7], ["G71 U2. R0.5", "G71 P10 Q20 U0.4 W0.1 F0.25", "N10 G0 X40.", "N20 G1 Z-10.", "G70 P10 Q20"])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(3, "not-scaled"), (4, "not-scaled")])

    def test_a_multiply_of_r_alone_leaves_the_cycle_values(self):
        payload = self.lathe("G76 P020060 Q100 R0.05\nG76 X40. Z-20. R-2. P1000 Q300 F1.5", operation="multiply", operand=2, addresses=["R"])
        self.assertEqual(lines_of(payload)[2:4], ["G76 P020060 Q100 R0.05", "G76 X40. Z-20. R-2. P1000 Q300 F1.5"])
        self.assertEqual(reasons(payload), ["data", "data"])

    def test_a_shift_of_z_still_lists_the_w_of_plain_moves_beside_the_g71_allowance(self):
        # exit2-x8 after P4a: W stays the incremental twin of Z in a plain move (`G01 W-1.`,
        # a bare `W-2.` under G01) and is listed as such; only the W of a G71 block became a
        # value of the cycle. No machine: the profile's default G-code system names the twins.
        payload = self.lathe(
            "G01 W-1. F0.1\nW-2.\nG71 U1.5 R0.5\nG71 P10 Q20 U0.4 W0.1 F0.25\nN10 G0 X20.\nN20 G1 Z-10.\nG70 P10 Q20",
            operation="subtract",
            operand=0.5,
            addresses=["Z"],
        )
        self.assertEqual(lines_of(payload)[1:9], ["G0 X50. Z4.5", "G01 W-1. F0.1", "W-2.", "G71 U1.5 R0.5", "G71 P10 Q20 U0.4 W0.1 F0.25", "N10 G0 X20.", "N20 G1 Z-10.5", "G70 P10 Q20"])
        self.assertEqual(
            [(f["line"], f["reason"], f["message"]) for f in payload["findings"]],
            [
                (3, "incremental", "W-1.: W moves Z by a distance, so a shift does not apply to it."),
                (4, "incremental", "W-2.: W moves Z by a distance, so a shift does not apply to it."),
                (6, "data", "W0.1: a value of G71, not a position of this program."),
            ],
        )
        self.assertIn("1 data word, 2 incremental words", payload["message"])

    def test_the_no_machine_lathe_context_names_the_incremental_twins(self):
        # The bare resolved profile has no `addresses.incremental`: the twins come from the
        # default G-code system's overlay. A check built on the bare profile loses every W row.
        twins = helpers.import_gedit_nc().incremental_axes(helpers.effective_context("fanuc-lathe")["profile"])
        self.assertEqual(twins, {"U": "X", "W": "Z"})

    def test_a_mill_drilling_cycle_keeps_its_rules(self):
        # Its lengths lie on the tool axis: a multiply of X scales the hole positions.
        payload = run("G90 G17\nG83 X10. Y10. Z-5. R2. Q1. F100.\nG80\n", operation="multiply", operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[1], "G83 X20. Y10. Z-5. R2. Q1. F100.")
        self.assertEqual(reasons(payload), [])

    def test_cycle95_stays_refused_for_its_contour(self):
        program = 'N10 G18 G90 DIAMON\nN20 G0 X50 Z5\nN30 CYCLE95("KONTUR",2,0,0.2,0.1,0.3,0.2,0.1,1,0,0,0.5)\nN40 M30\n'
        for params in ({"operand": 1, "addresses": ["Z"]}, {"operation": "multiply", "operand": 2, "addresses": ["X"]}):
            with self.subTest(params=params):
                payload = run(program, profile="sinumerik", **params)
                self.assertEqual(lines_of(payload)[2], program.split("\n")[2])
                self.assertEqual(finding_at(payload, 3)["reason"], "cycle-position")


def run_lathe(text, system="A", preceding=None, **params):
    """A lathe program written inline, in G-code system A (`fanuc-lathe`) or B (its variant),
    as a whole document or as a selection below ``preceding``."""
    variant = ("gcodeSystem", "B") if system == "B" else None
    context = helpers.effective_context("fanuc-lathe", variant=variant) if variant else helpers.effective_context("fanuc-lathe")
    context["params"] = dict({"operation": "add", "operand": 0.5}, **params)
    lines = text.split("\n")
    if preceding is None:
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
    else:
        start = len(preceding) + 1
        context["input"] = {"scope": "selection", "startLine": start, "endLine": start + len(lines) - 1, "precedingLines": preceding}
    result = helpers.run_script(SCRIPT, stdin=text, context=context)
    if not result.ok:
        raise AssertionError(result.stderr)
    return result.json()


class TestNcFixSinglePassTaper(unittest.TestCase):
    """v1.2 NC fix round (T009): the taper `R` of the lathe's single passes (`G90`, `G92`, `G94`;
    system B `G77`, `G78`, `G79`) is a length along X (turning, threading) or Z (facing)
    (`CodeParam.lengthAlong`). A shift leaves it and lists it; a multiply or divide of its axis
    leaves the series of passes as written and says so, instead of scaling the end point and
    keeping the taper."""

    #: (G-code system, code, the axis its R lies along, the other axis, the feed or lead).
    PASSES = [
        ("A", "G90", "X", "Z", "F0.2"),
        ("A", "G92", "X", "Z", "F1.5"),
        ("A", "G94", "Z", "X", "F0.2"),
        ("B", "G77", "X", "Z", "F0.2"),
        ("B", "G78", "X", "Z", "F1.5"),
        ("B", "G79", "Z", "X", "F0.2"),
    ]
    HEAD = {"A": "G21 G18 G99\nG0 X50. Z5.\n", "B": "G21 G18 G90 G95\nG0 X50. Z5.\n"}

    def program(self, system, body):
        return self.HEAD[system] + body + "\nG0 X50.\nM30"

    def test_a_multiply_or_divide_of_the_taper_axis_leaves_the_pass(self):
        for system, code, along, _other, feed in self.PASSES:
            block = "%s X40. Z-20. R-2. %s" % (code, feed)
            for operation in ("multiply", "divide"):
                with self.subTest(code=code, operation=operation):
                    payload = run_lathe(self.program(system, block), system, operation=operation, operand=2, addresses=[along])
                    self.assertEqual(lines_of(payload)[2], block)
                    self.assertEqual(
                        finding_at(payload, 3)["message"],
                        "%s: %s writes R-2., a length along %s that is not scaled with %s, so the pass cannot be scaled in one piece."
                        % (block, code, along, along),
                    )
                    self.assertEqual(reasons(payload), ["not-scaled"])

    def test_a_multiply_of_the_other_axis_scales_the_pass_and_keeps_the_taper(self):
        for system, code, _along, other, feed in self.PASSES:
            with self.subTest(code=code):
                payload = run_lathe(self.program(system, "%s X40. Z-20. R-2. %s" % (code, feed)), system, operation="multiply", operand=2, addresses=[other])
                want = "%s X%s Z%s R-2. %s" % (code, "80." if other == "X" else "40.", "-40." if other == "Z" else "-20.", feed)
                self.assertEqual(lines_of(payload)[2], want)
                self.assertEqual(payload["findings"], [])

    def test_a_shift_of_r_leaves_the_taper_and_lists_it(self):
        for system, code, along, _other, feed in self.PASSES:
            with self.subTest(code=code):
                block = "%s X40. Z-20. R-2. %s" % (code, feed)
                payload = run_lathe(self.program(system, block + "\nR-1."), system, operand=1, addresses=[along, "R"])
                shifted = block.replace("X40.", "X41.") if along == "X" else block.replace("Z-20.", "Z-19.")
                self.assertEqual(lines_of(payload)[2:4], [shifted, "R-1."])
                self.assertEqual(
                    [(f["line"], f["reason"], f["severity"], f["message"]) for f in payload["findings"]],
                    [
                        (3, "data", "info", "R-2.: a value of %s, not a position of this program." % code),
                        (4, "data", "info", "R-1.: a value of %s, not a position of this program." % code),
                    ],
                )

    def test_the_taper_stays_in_force_for_the_next_passes(self):
        # The control keeps X, Z and R of the single passes until a block writes them again.
        payload = run_lathe(self.program("A", "G90 X40. Z-20. R-2. F0.2\nX38.\nX36."), operation="multiply", operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[2:5], ["G90 X40. Z-20. R-2. F0.2", "X38.", "X36."])
        self.assertEqual([finding_at(payload, line)["reason"] for line in (3, 4, 5)], ["not-scaled"] * 3)
        self.assertEqual(
            finding_at(payload, 4)["message"],
            "X38.: R-2. of line 3 is still in force for G90, a length along X that is not scaled with X, so the pass cannot be scaled in one piece.",
        )

    def test_a_block_that_runs_no_pass_is_not_listed(self):
        payload = run_lathe(self.program("A", "G90 X40. Z-20. R-2. F0.2\nM8\nX38."), operation="multiply", operand=2, addresses=["X"])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(3, "not-scaled"), (5, "not-scaled")])

    def test_a_taper_further_down_leaves_the_whole_series(self):
        payload = run_lathe(self.program("A", "G90 X40. Z-20. F0.2\nX38.\nX36. R-1."), operation="multiply", operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[1:6], ["G0 X100. Z5.", "G90 X40. Z-20. F0.2", "X38.", "X36. R-1.", "G0 X100."])
        self.assertEqual(
            finding_at(payload, 3)["message"],
            "G90 X40. Z-20. F0.2: part of the same series of passes as line 5, which is left as written (not scaled).",
        )

    def test_a_straight_series_is_scaled(self):
        for body in ("G90 X40. Z-20. F0.2\nX38.\nX36.", "G90 X40. Z-20. R0 F0.2\nX38.\nX36."):
            with self.subTest(body=body):
                payload = run_lathe(self.program("A", body), operation="multiply", operand=2, addresses=["X"])
                self.assertEqual([l.split(" Z")[0] for l in lines_of(payload)[2:5]], ["G90 X80.", "X76.", "X72."])
                self.assertEqual(payload["findings"], [])

    def test_an_arc_radius_is_no_taper(self):
        # The R of an arc is its radius, not a value of the passes, and no pass is in force.
        payload = run_lathe(self.program("A", "G1 X40. Z-20. F0.2\nG2 X50. Z-25. R5."), operation="multiply", operand=2, addresses=["X", "Z", "R"])
        self.assertEqual(lines_of(payload)[2:4], ["G1 X80. Z-40. F0.2", "G2 X100. Z-50. R10."])
        self.assertEqual(payload["findings"], [])

    def test_a_selection_below_a_taper_is_left(self):
        above = ["G21 G18 G99", "G0 X50. Z5.", "G90 X40. Z-20. R-2. F0.2"]
        payload = run_lathe("X38.\nX36.", preceding=above, operation="multiply", operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[:2], ["X38.", "X36."])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(4, "not-scaled"), (5, "not-scaled")])
        # Below straight passes, the passes of the selection are scaled on their own.
        payload = run_lathe("X38.\nX36.", preceding=above[:2] + ["G90 X40. Z-20. F0.2"], operation="multiply", operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[:2], ["X76.", "X72."])
        self.assertEqual(payload["findings"], [])


class TestNcFixKlartextPlaneLengths(unittest.TestCase):
    """v1.2 NC fix round (T012): the side lengths, diameters, corner radii and stock sizes of the
    Klartext pockets, slots and studs (cycles 251-257) lie in the working plane
    (`CodeParam.lengthAlong: 'plane'`). A multiply or divide of X or Y leaves the cycle and its
    calls as written instead of scaling the calls and keeping the sizes; a shift still moves the
    calls."""

    CODES = {e["code"]: e for e in helpers.resolved_codes("heidenhain")}

    def program(self, number, values=None):
        entry = self.CODES["CYCL DEF %d" % number]
        written = dict({p["address"]: "5" for p in entry["params"]}, Q203="+0", **(values or {}))
        body = " ~\n".join("  %s=%s ;X" % (p["address"], written[p["address"]]) for p in entry["params"])
        return "\n".join([
            "0 BEGIN PGM P MM",
            "1 TOOL CALL 1 Z S3000",
            "2 L Z+100 R0 FMAX M3",
            "3 CYCL DEF %d X ~" % number,
            body,
            "4 L X+50 Y+40 R0 FMAX M99",
            "5 L X+80 Y+40 R0 FMAX M99",
            "6 END PGM P MM",
        ])

    def calls(self, payload):
        return [line for line in lines_of(payload) if line.endswith("M99")]

    def test_a_multiply_or_divide_of_a_plane_axis_leaves_each_cycle_and_its_calls(self):
        first = {251: "Q218", 252: "Q223", 253: "Q218", 256: "Q218", 257: "Q223"}
        for number, length in first.items():
            for operation, axes in (("multiply", ["X", "Y"]), ("divide", ["X", "Y"]), ("multiply", ["X"]), ("multiply", ["Y"])):
                with self.subTest(cycle=number, operation=operation, axes=axes):
                    payload = run(self.program(number), profile="heidenhain-klartext", operation=operation, operand=2, addresses=axes)
                    self.assertEqual(self.calls(payload), ["4 L X+50 Y+40 R0 FMAX M99", "5 L X+80 Y+40 R0 FMAX M99"])
                    self.assertEqual(set(reasons(payload)), {"not-scaled"})
                    self.assertIn(
                        "CYCL DEF %d writes %s=5, a length in the working plane that is not scaled with %s, so the cycle cannot be scaled in one piece."
                        % (number, length, and_list(axes)),
                        finding_at(payload, 4)["message"],
                    )

    def test_the_circular_slot_stays_refused_for_its_centre(self):
        payload = run(self.program(254), profile="heidenhain-klartext", operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(self.calls(payload), ["4 L X+50 Y+40 R0 FMAX M99", "5 L X+80 Y+40 R0 FMAX M99"])
        self.assertEqual(set(reasons(payload)), {"cycle-position"})

    def test_every_size_of_the_cycle_is_read(self):
        # With the first size at zero, the next one still refuses: each plane length is read.
        for number, zero, length in ((251, "Q218", "Q219"), (256, "Q218", "Q424"), (257, "Q223", "Q222"), (253, "Q218", "Q219")):
            with self.subTest(cycle=number):
                payload = run(self.program(number, {zero: "0"}), profile="heidenhain-klartext", operation="multiply", operand=2, addresses=["X"])
                self.assertIn("writes %s=5, a length in the working plane" % length, finding_at(payload, 4)["message"])

    def test_a_shift_still_moves_the_calls(self):
        for number in (251, 252, 253, 256, 257):
            with self.subTest(cycle=number):
                payload = run(self.program(number), profile="heidenhain-klartext", operand=2, addresses=["X", "Y"])
                self.assertEqual(self.calls(payload), ["4 L X+52 Y+42 R0 FMAX M99", "5 L X+82 Y+42 R0 FMAX M99"])
                self.assertEqual(payload["findings"], [])



#: Every length along an axis or in the plane the shipped databases declare (`CodeParam.
#: lengthAlong`, v1.2 NC fix round T009, T012 and the NCF-A follow-up), by database and code.
#: A mark that goes missing would let a multiply or divide scale the position and keep the size.
LENGTHS_ALONG = {
    # NCF-C (owner decision 2026-10-18): the arc radius R, inherited by both lathe systems.
    "fanuc": {"G2": {"R": "plane"}, "G3": {"R": "plane"}},
    # v1.2.0 (NCR-4): system A reads G77-G79 as system B's single passes.
    "fanuc-lathe": {"G77": {"R": "X"}, "G78": {"R": "X"}, "G79": {"R": "Z"}, "G90": {"R": "X"}, "G92": {"R": "X"}, "G94": {"R": "Z"}},
    "fanuc-lathe-b": {"G77": {"R": "X"}, "G78": {"R": "X"}, "G79": {"R": "Z"}},
    "heidenhain": {
        # The corner and arc words of the contour (the last round of NCF-A): `CR … R`, `RND R`, `CHF 2`.
        "CR": {"R": "plane"},
        "RND": {"R": "plane"},
        "CHF": {"CHF": "plane"},
        "CYCL DEF 208": {"Q335": "plane", "Q342": "plane"},
        "CYCL DEF 240": {"Q344": "plane"},
        "CYCL DEF 262": {"Q335": "plane"},
        "CYCL DEF 251": {"Q218": "plane", "Q219": "plane", "Q220": "plane"},
        "CYCL DEF 252": {"Q223": "plane"},
        "CYCL DEF 253": {"Q218": "plane", "Q219": "plane"},
        "CYCL DEF 254": {"Q219": "plane", "Q375": "plane"},
        "CYCL DEF 256": {"Q218": "plane", "Q424": "plane", "Q219": "plane", "Q425": "plane", "Q220": "plane"},
        "CYCL DEF 257": {"Q223": "plane", "Q222": "plane"},
        # Wave Y (T093-T095): the pattern sizes, face milling and the rounding of cycle 20.
        "CYCL DEF 220": {"Q244": "plane"},
        "CYCL DEF 221": {"Q237": "plane", "Q238": "plane"},
        "CYCL DEF 233": {"Q218": "plane", "Q219": "plane", "Q220": "plane"},
        "CYCL DEF 20": {"Q8": "plane"},
    },
    "sinumerik": {
        "CYCLE61": {"_LENG": "plane", "_WID": "plane"},
        "POCKET3": {"_LENG": "plane", "_WID": "plane", "_CRAD": "plane", "_AP1": "plane", "_AP2": "plane", "_FS": "plane"},
        "POCKET4": {"_CDIAM": "plane", "_AP1": "plane", "_FS": "plane"},
        "SLOT1": {"LENG": "plane", "WID": "plane", "RAD": "plane", "_FS": "plane"},
        "SLOT2": {"WID": "plane", "RAD": "plane", "_FS": "plane"},
        "CYCLE72": {"_FS": "plane"},
        "CYCLE93": {"WIDG": "plane", "DIAG": "plane", "RCO1": "plane", "RCO2": "plane", "RCI1": "plane", "RCI2": "plane"},
        # FZ-7: the corner words, codes of their own whose parameter is their own value.
        "CHF": {"CHF": "plane"},
        "CHR": {"CHR": "plane"},
        "RND": {"RND": "plane"},
        "RNDM": {"RNDM": "plane"},
        "CR": {"CR": "plane"},
    },
    "okuma": {
        "G2": {"L": "plane"},
        "G3": {"L": "plane"},
        # Review round NC-6: the start shift K of G31/G33 (along Z) and I of G32 (along X).
        "G31": {"I": "X", "K": "Z", "L": "plane"},
        "G32": {"K": "Z", "I": "X", "L": "plane"},
        "G33": {"I": "X", "K": "Z", "L": "plane"},
        "G75": {"L": "plane"},
        "G76": {"L": "plane"},
        "G102": {"L": "plane"},
        "G103": {"L": "plane"},
        "G132": {"L": "plane"},
        "G133": {"L": "plane"},
    },
}


class TestNcFixLengthsAlongEveryDatabase(unittest.TestCase):
    """v1.2 NC fix round, NCF-A follow-up: every size in the plane or along an axis of the shipped
    databases is marked, and a multiply or divide of its axis leaves the block or the cycle as
    written instead of scaling only its position."""

    def test_the_databases_mark_exactly_the_listed_lengths(self):
        for dialect in ("fanuc", "fanuc-lathe", "fanuc-lathe-b", "heidenhain", "okuma", "sinumerik"):
            own = helpers.load_json(helpers.CODES_DIR / ("%s.json" % dialect))["codes"]
            found = {
                e["code"]: {p["address"]: p["lengthAlong"] for p in e.get("params") or [] if "lengthAlong" in p}
                for e in own
                if any("lengthAlong" in p for p in e.get("params") or [])
            }
            with self.subTest(dialect=dialect):
                self.assertEqual(found, LENGTHS_ALONG.get(dialect, {}))
                # And the loader keeps them, so the app hands them to the script.
                loaded = {e["code"]: e for e in helpers.resolved_codes(dialect)}
                for code, lengths in found.items():
                    got = {p["address"]: p.get("lengthAlong") for p in loaded[code]["params"] if p.get("lengthAlong")}
                    self.assertEqual(got, lengths, code)

    def test_klartext_bore_and_thread_milling_and_centring_are_left_on_a_multiply(self):
        for number, length in ((208, "Q335"), (262, "Q335"), (240, "Q344")):
            program = TestNcFixKlartextPlaneLengths.program(TestNcFixKlartextPlaneLengths(), number)
            for axes in (["X"], ["Y"], ["X", "Y"]):
                with self.subTest(cycle=number, axes=axes):
                    payload = run(program, profile="heidenhain-klartext", operation="multiply", operand=2, addresses=axes)
                    self.assertEqual([l for l in lines_of(payload) if l.endswith("M99")], ["4 L X+50 Y+40 R0 FMAX M99", "5 L X+80 Y+40 R0 FMAX M99"])
                    self.assertIn("CYCL DEF %d writes %s=5, a length in the working plane" % (number, length), finding_at(payload, 4)["message"])
            with self.subTest(cycle=number, operation="add"):
                payload = run(program, profile="heidenhain-klartext", operand=2, addresses=["X", "Y"])
                self.assertEqual([l for l in lines_of(payload) if l.endswith("M99")], ["4 L X+52 Y+42 R0 FMAX M99", "5 L X+82 Y+42 R0 FMAX M99"])

    OKUMA = "G50 S2000\nG0 X50. Z5.\nG1 X40. Z-10. F0.2\n"

    def okuma(self, body, **params):
        return run(self.OKUMA + body + "\nG0 X80.\nM02", profile="okuma-osp", **params)

    def test_okuma_radius_chamfer_and_round_lengths_leave_their_block(self):
        body = "G2 X60. Z-20. L10.\nG1 X40. G75 L2.\nG1 Z-30. G76 L1.\nG1 X70.\nG102 X50. C90. L15.\nG132 Z-40. C45. L8."
        payload = self.okuma(body, operation="multiply", operand=2, addresses=["X", "Z"])
        lines = lines_of(payload)
        self.assertEqual(lines[3:6], ["G2 X60. Z-20. L10.", "G1 X40. G75 L2.", "G1 Z-30. G76 L1."])
        self.assertEqual(lines[6], "G1 X140.")
        rows = [(f["line"], f["reason"]) for f in payload["findings"]]
        self.assertEqual(rows, [(4, "not-scaled"), (5, "not-scaled"), (6, "not-scaled"), (8, "not-scaled"), (9, "not-scaled")])
        self.assertEqual(
            finding_at(payload, 5)["message"],
            "G1 X40. G75 L2.: G75 writes L2., a length in the working plane that is not scaled with X and Z, so the block cannot be scaled in one piece.",
        )
        # A shift is no multiply: it refuses none of them (with no machine chosen the Okuma words
        # are left for their reading, which is another finding).
        payload = self.okuma(body, operand=1, addresses=["Z"])
        self.assertNotIn("not-scaled", reasons(payload))

    def test_okuma_thread_pass_taper_is_kept_for_the_next_passes(self):
        for code, taper, along, other in (("G33", "I-2.", "X", "Z"), ("G31", "I-2.", "X", "Z"), ("G32", "K-1.", "Z", "X")):
            body = "%s X40. Z-20. %s F1.5\nX39." % (code, taper) if along == "X" else "%s X0. Z-2. %s F1.5\nZ-2.5" % (code, taper)
            with self.subTest(code=code):
                payload = self.okuma(body, operation="multiply", operand=2, addresses=[along])
                self.assertEqual(lines_of(payload)[3:5], body.split("\n"))
                self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(4, "not-scaled"), (5, "not-scaled")])
                payload = self.okuma(body, operation="multiply", operand=2, addresses=[other])
                self.assertEqual(payload["findings"], [])

    def test_sinumerik_corner_words_leave_their_block(self):
        text = "N10 G17 G90 G71\nN20 G0 X0 Y0 Z5\nN30 G1 X10 Y0 RND=2 F200\nN40 G1 X10 Y10 CHR=1\nN50 G1 X0 Y10 RNDM=0\nN60 M30"
        payload = run(text, profile="sinumerik-mill", operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[2:5], ["N30 G1 X10 Y0 RND=2 F200", "N40 G1 X10 Y10 CHR=1", "N50 G1 X0 Y20 RNDM=0"])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(3, "not-scaled"), (4, "not-scaled")])
        self.assertEqual(
            finding_at(payload, 3)["message"],
            "N30 G1 X10 Y0 RND=2 F200: RND=2 is a length in the working plane that is not scaled with X and Y, so the block cannot be scaled in one piece.",
        )
        payload = run(text, profile="sinumerik-mill", operand=2, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[2], "N30 G1 X12 Y2 RND=2 F200")
        self.assertEqual(payload["findings"], [])

    SINUMERIK_RNDM = "\n".join([
        "N10 G17 G90 G71", "N20 G0 X0 Y0 Z5", "N30 G1 X10 Y0 RNDM=2 F200", "N40 G1 X10 Y10", "N50 G1 X0 Y10",
        "N60 G1 X0 Y0 RNDM=0", "N70 G1 X5 Y0", "N80 M30",
    ])

    def test_sinumerik_modal_rounding_leaves_every_block_it_rounds(self):
        payload = run(self.SINUMERIK_RNDM, profile="sinumerik-mill", operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[2:7], self.SINUMERIK_RNDM.split("\n")[2:6] + ["N70 G1 X10 Y0"])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(line, "not-scaled") for line in (3, 4, 5, 6)])
        self.assertEqual(
            finding_at(payload, 4)["message"],
            "N40 G1 X10 Y10: RNDM=2 of line 3 is still in force and rounds this block's corner, a length in the working plane that is not scaled with X and Y, so the block cannot be scaled in one piece.",
        )
        # From a selection below RNDM=2 too; a scale of the tool axis is not concerned.
        lines = self.SINUMERIK_RNDM.split("\n")
        context = helpers.effective_context("sinumerik-mill")
        context["params"] = {"operation": "multiply", "operand": 2, "addresses": ["X"]}
        context["input"] = {"scope": "selection", "startLine": 4, "endLine": 5, "precedingLines": lines[:3]}
        part = helpers.run_script(SCRIPT, stdin="\n".join(lines[3:5]), context=context).json()
        self.assertEqual([(f["line"], f["reason"]) for f in part["findings"]], [(4, "not-scaled"), (5, "not-scaled")])
        payload = run(self.SINUMERIK_RNDM, profile="sinumerik-mill", operation="multiply", operand=2, addresses=["Z"])
        self.assertEqual(payload["findings"], [])

    def test_sinumerik_arc_radius(self):
        text = "N10 G17 G90 G71\nN20 G0 X0 Y0 Z5\nN30 G2 X10 Y0 CR=5 F200\nN40 M30"
        payload = run(text, profile="sinumerik-mill", operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[2], "N30 G2 X10 Y0 CR=5 F200")
        self.assertEqual(finding_at(payload, 3)["reason"], "not-scaled")

    KLARTEXT_CORNERS = "\n".join([
        "0 BEGIN PGM K MM", "1 TOOL CALL 1 Z S3000", "2 L X+0 Y+0 R0 FMAX", "3 L X+20 Y+0 RL F200", "4 RND R2",
        "5 L X+20 Y+20", "6 CHF 3", "7 L X+0 Y+20", "8 CR X+0 Y+0 R+10 DR+", "9 END PGM K MM",
    ])

    def test_klartext_corner_and_arc_words_leave_their_block(self):
        payload = run(self.KLARTEXT_CORNERS, profile="heidenhain-klartext", operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual([lines_of(payload)[i] for i in (4, 6, 8)], ["4 RND R2", "6 CHF 3", "8 CR X+0 Y+0 R+10 DR+"])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(5, "not-scaled"), (7, "not-scaled"), (9, "not-scaled")])
        self.assertEqual(
            finding_at(payload, 7)["message"],
            "6 CHF 3: CHF writes CHF 3, a length in the working plane that is not scaled with X and Y, so the block cannot be scaled in one piece.",
        )
        self.assertEqual(
            finding_at(payload, 5)["message"],
            "4 RND R2: RND writes R2, a length in the working plane that is not scaled with X and Y, so the block cannot be scaled in one piece.",
        )

    def test_klartext_with_r_chosen_keeps_the_add_r_rule(self):
        # The form's rule: "When multiplying, add R if arcs are written with a radius" (NCF-C:
        # without it such a block is left as written). With R
        # chosen the radii are changed as before; the chamfer has no address and stays refused.
        payload = run(self.KLARTEXT_CORNERS, profile="heidenhain-klartext", operation="multiply", operand=2, addresses=["X", "Y", "R"])
        self.assertEqual([lines_of(payload)[i] for i in (4, 6, 8)], ["4 RND R4", "6 CHF 3", "8 CR X+0 Y+0 R+20 DR+"])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(7, "not-scaled")])
        # A shift changes the corner rounding as asked and leaves the arc radius (NCR-5).
        payload = run(self.KLARTEXT_CORNERS, profile="heidenhain-klartext", operand=2, addresses=["X", "Y", "R"])
        self.assertEqual([lines_of(payload)[i] for i in (4, 6, 8)], ["4 RND R4", "6 CHF 3", "8 CR X+2 Y+2 R+10 DR+"])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(9, "data")])

    def test_sinumerik_milling_cycles_stay_refused(self):
        # Their positions in the plane (_PA, _PO, _CPA, _CPO) refuse them already; the marked
        # sizes keep them refused should those positions ever be moved.
        program = "G17 G90 G71\nT1 D1\nG0 X0 Y0 Z50\nPOCKET3(50,0,2,-10,40,30,5,60,40,0,5,0.2,0.1,500,100,0,11,6,,,,,,0,1,,1101,12,111)\nM30"
        payload = run(program, profile="sinumerik-mill", operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[3], program.split("\n")[3])
        self.assertEqual(finding_at(payload, 4)["reason"], "cycle-position")

def and_list(words):
    return words[0] if len(words) == 1 else "%s and %s" % (", ".join(words[:-1]), words[-1])


class TestNcfcFanucArcRadius(unittest.TestCase):
    """v1.2.0 NC fix round, NCF-C (owner decision 2026-10-18): the radius R of a Fanuc arc is a
    length in the plane. A multiply or divide of a plane axis leaves an arc written with R as
    written and lists it, unless R is chosen; with R chosen the arc is scaled as before."""

    MILL = "G90 G17 G21\nG0 X0. Y0. Z5.\nG1 X10. Y0. F100.\nG2 X20. Y10. R10.\nG3 X30. Y20. I10. J0.\nG1 X40.\nM30"

    def test_a_mill_arc_with_r_is_left_when_r_is_not_chosen(self):
        payload = run(self.MILL, operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[3], "G2 X20. Y10. R10.")
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(4, "not-scaled")])
        self.assertEqual(
            finding_at(payload, 4)["message"],
            "G2 X20. Y10. R10.: G2 writes R10., a length in the working plane that is not scaled with X and Y, so the block cannot be scaled in one piece.",
        )
        # One axis of the plane is enough; the modal G2 of a block without its code too.
        payload = run("G90 G17 G21\nG0 X0. Y0.\nG2 X20. Y0. R10. F100.\nX40. R10.\nM30", operation="divide", operand=2, addresses=["X"])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(3, "not-scaled"), (4, "not-scaled")])

    def test_with_r_chosen_the_arc_is_scaled_as_before(self):
        payload = run(self.MILL, operation="multiply", operand=2, addresses=["X", "Y", "R"])
        self.assertEqual(lines_of(payload)[2:6], ["G1 X20. Y0. F100.", "G2 X40. Y20. R20.", "G3 X60. Y40. I20. J0.", "G1 X80."])
        self.assertEqual(payload["findings"], [])

    def test_the_tool_axis_and_a_shift_leave_the_radius_alone(self):
        # The radius lies in the XY plane: scaling Z (a helix's depth) does not touch it.
        payload = run("G90 G17 G21\nG0 X0. Y0. Z5.\nG2 X20. Y0. Z-2. R10. F100.\nM30", operation="multiply", operand=2, addresses=["Z"])
        self.assertEqual(lines_of(payload)[2], "G2 X20. Y0. Z-4. R10. F100.")
        self.assertEqual(payload["findings"], [])
        payload = run(self.MILL, operand=1, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[3], "G2 X21. Y11. R10.")
        self.assertEqual(payload["findings"], [])
        # A zero radius is no length to scale.
        payload = run("G90 G17 G21\nG0 X0. Y0.\nG2 X20. Y0. R0. F100.\nM30", operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(payload["findings"], [])

    def test_the_lathe_arc_in_both_systems(self):
        text = "G21 G18 G99\nG0 X40. Z2.\nG1 Z-10. F0.2\nG2 X60. Z-20. R10.\nG1 Z-30.\nM30"
        for variant in (None, ("gcodeSystem", "B")):
            with self.subTest(variant=variant):
                context = helpers.effective_context("fanuc-lathe", variant=variant) if variant else helpers.effective_context("fanuc-lathe")
                context["params"] = {"operation": "multiply", "operand": 2, "addresses": ["Z"]}
                context["input"] = {"scope": "document", "startLine": 1, "endLine": 6}
                payload = helpers.run_script(SCRIPT, stdin=text, context=context).json()
                self.assertEqual(lines_of(payload)[3], "G2 X60. Z-20. R10.")
                self.assertEqual(
                    finding_at(payload, 4)["message"],
                    "G2 X60. Z-20. R10.: G2 writes R10., a length in the working plane that is not scaled with Z, so the block cannot be scaled in one piece.",
                )
                context["params"]["addresses"] = ["X", "Z", "R"]
                payload = helpers.run_script(SCRIPT, stdin=text, context=context).json()
                self.assertEqual(lines_of(payload)[3], "G2 X120. Z-40. R20.")
                self.assertEqual(payload["findings"], [])


def run_selection(text, start, end, profile="fanuc-gcode", **params):
    """A selection of an inline program (lines ``start`` to ``end``), primed with the lines above."""
    lines = text.split("\n")
    context = helpers.effective_context(profile)
    context["params"] = dict({"operation": "add", "operand": 0.5}, **params)
    context["input"] = {"scope": "selection", "startLine": start, "endLine": end, "precedingLines": lines[: start - 1]}
    result = helpers.run_script(SCRIPT, stdin="\n".join(lines[start - 1 : end]), context=context)
    if not result.ok:
        raise AssertionError(result.stderr)
    return result.json()


class TestNcr1DrillingCycleAfterAnArc(unittest.TestCase):
    """v1.2.0 NC review, NCR-1 (a regression of NCF-C): the motion group still holds `G2` while a
    drilling cycle runs, but the cycle's `R` is its R plane, never the arc's radius. A block that
    runs a cycle written as a word reads no length of the motion code in force."""

    MILL = "\n".join([
        "%", "O1", "G90 G17 G0 X0 Y0 Z5.", "G1 X10 Y0 F100", "G2 X20 Y10 R10.",
        "G99 G81 X30 Y0 Z-5. R2. F100", "X40.", "G80", "M30", "%",
    ])

    def test_a_shift_of_z_moves_the_r_plane(self):
        payload = run(self.MILL, operand=5, addresses=["Z"])
        self.assertEqual(lines_of(payload)[5], "G99 G81 X30 Y0 Z0. R7. F100")
        self.assertEqual(payload["findings"], [])
        # The same from a selection that holds the Z the cycle starts at, and the arc.
        payload = run_selection(self.MILL, 3, 8, operand=5, addresses=["Z"])
        self.assertEqual(lines_of(payload)[3], "G99 G81 X30 Y0 Z0. R7. F100")
        self.assertEqual(payload["findings"], [])
        # v1.2.0 D4: a selection that starts at the cycle, with the arc and Z5. above it, starts
        # the cycle at the unmoved level (TestD4CycleStartLevel); it is left for that, never
        # for a value of G2.
        payload = run_selection(self.MILL, 6, 8, operand=5, addresses=["Z"])
        self.assertEqual(lines_of(payload)[0], "G99 G81 X30 Y0 Z-5. R2. F100")
        self.assertEqual({f["reason"] for f in payload["findings"]}, {"cycle-level-outside"})

    def test_a_multiply_of_z_scales_the_r_plane(self):
        payload = run(self.MILL, operation="multiply", operand=2, addresses=["Z"])
        self.assertEqual(lines_of(payload)[5], "G99 G81 X30 Y0 Z-10. R4. F100")
        self.assertEqual(payload["findings"], [])

    def test_a_peck_cycle_after_a_g3(self):
        text = self.MILL.replace("G2 X20", "G3 X20").replace("G99 G81 X30 Y0 Z-5. R2. F100", "G98 G83 X30 Y0 Z-15. R2. Q3. F100")
        payload = run(text, operand=5, addresses=["Z"])
        self.assertEqual(lines_of(payload)[5], "G98 G83 X30 Y0 Z-10. R7. Q3. F100")
        self.assertEqual(payload["findings"], [])

    def test_a_multiply_of_x_and_y_scales_the_cycle_and_leaves_only_the_arc(self):
        payload = run(self.MILL, operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[4:7], ["G2 X20 Y10 R10.", "G99 G81 X60 Y0 Z-5. R2. F100", "X80."])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(5, "not-scaled")])

    def test_an_arc_written_in_cycle_mode_and_after_g80_is_still_an_arc(self):
        # A G2 written under the cycle ends it; a block after G80 runs the modal G2 again.
        text = "\n".join([
            "%", "O1", "G90 G17 G0 X0 Y0 Z5.", "G1 X10 Y0 F100", "G2 X20 Y10 R10.",
            "G99 G81 X30 Y0 Z-5. R2. F100", "G2 X40. Y10. R10.", "G80", "X50. Y0 R10.", "M30", "%",
        ])
        payload = run(text, operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(5, "not-scaled"), (7, "not-scaled"), (9, "not-scaled")])
        self.assertEqual(lines_of(payload)[5], "G99 G81 X60 Y0 Z-5. R2. F100")

    def test_a_cycle_and_an_arc_in_one_block_are_left(self):
        for block in ("G2 G81 X10. Y0. Z-5. R2. F100.", "G81 G2 X10. Y0. Z-5. R2. F100."):
            with self.subTest(block=block):
                payload = run("G90 G17 G21\nG0 X0. Y0. Z5.\n%s\nG80\nM30" % block, operand=1, addresses=["Z"])
                self.assertEqual(lines_of(payload)[2], block)
                self.assertEqual(
                    finding_at(payload, 3)["message"],
                    "%s: writes the cycle G81 and the arc G2 in one block, so whether its words are the cycle's position and R plane or the arc's end point and radius is not certain." % block,
                )
                self.assertEqual(reasons(payload), ["cycle-mode"])

    def test_a_lathe_cycle_under_a_single_pass_writes_no_taper(self):
        # The relief R of G74 under the G90 mode is the cycle's, not a taper of the pass.
        text = "G21 G18 G99\nG0 X50. Z5.\nG90 X40. Z-20. F0.2\nG74 R1.\nX38.\nG0 X100.\nM30"
        payload = run(text, profile="fanuc-lathe", operation="multiply", operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[2:5], ["G90 X80. Z-20. F0.2", "G74 R1.", "X76."])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(4, "not-scaled")])
        payload = run(text, profile="fanuc-lathe", operand=1, addresses=["X", "R"])
        self.assertEqual(finding_at(payload, 4)["message"], "R1.: a value of G74, not a position of this program.")


class TestNcr8ArcsNeedBothAxes(unittest.TestCase):
    """v1.2.0 NC review, NCR-8: a multiply or divide of one axis of the plane but not the other
    would write an arc whose centre no longer fits its end points. Such an arc block is left."""

    MILL = "G90 G17 G21\nG0 X0 Y0 Z5.\nG1 X10 Y0 F100\nG2 X20 Y10 I0 J10.\nG0 Z50.\nM30"
    LATHE = "G21 G18 G99\nG0 X20. Z2.\nG1 Z-10. F0.2\nG2 X40. Z-20. I10. K0\nG0 X100.\nM30"

    def test_a_mill_arc_scaled_along_x_alone_is_left(self):
        payload = run(self.MILL, operation="multiply", operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[2:4], ["G1 X20 Y0 F100", "G2 X20 Y10 I0 J10."])
        self.assertEqual(
            finding_at(payload, 4)["message"],
            "G2 X20 Y10 I0 J10.: runs the arc of G2 in the XY plane, which this run scales along X but not along Y, so the arc cannot be scaled in one piece.",
        )
        self.assertEqual(reasons(payload), ["not-scaled"])
        # Also a block that writes no chosen word.
        payload = run("G90 G17 G21\nG0 X10. Y0.\nG2 Y20. J10. F100.\nM30", operation="divide", operand=2, addresses=["X"])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(3, "not-scaled")])

    def test_both_axes_of_the_plane_or_the_tool_axis_alone_are_scaled(self):
        payload = run(self.MILL, operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[3], "G2 X40 Y20 I0 J20.")
        self.assertEqual(payload["findings"], [])
        helix = "G90 G17 G21\nG0 X0 Y0 Z5.\nG1 X10 Y0 F100\nG2 X20 Y10 Z-2. I0 J10.\nM30"
        payload = run(helix, operation="multiply", operand=2, addresses=["Z"])
        self.assertEqual(lines_of(payload)[3], "G2 X20 Y10 Z-4. I0 J10.")
        self.assertEqual(payload["findings"], [])

    def test_a_lathe_arc(self):
        payload = run(self.LATHE, profile="fanuc-lathe", operation="multiply", operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[3], "G2 X40. Z-20. I10. K0")
        self.assertEqual(
            finding_at(payload, 4)["message"],
            "G2 X40. Z-20. I10. K0: runs the arc of G2 in the ZX plane, which this run scales along X but not along Z, so the arc cannot be scaled in one piece.",
        )
        payload = run(self.LATHE, profile="fanuc-lathe", operation="multiply", operand=2, addresses=["X", "Z"])
        self.assertEqual(lines_of(payload)[3], "G2 X80. Z-40. I20. K0")
        self.assertEqual(payload["findings"], [])

    def test_a_lathe_chamfer_written_with_i(self):
        text = "G21 G18 G99\nG0 X20. Z2.\nG1 Z-10. I2. F0.2\nX40.\nM30"
        payload = run(text, profile="fanuc-lathe", operation="multiply", operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[2], "G1 Z-10. I2. F0.2")
        self.assertEqual(
            finding_at(payload, 3)["message"],
            "G1 Z-10. I2. F0.2: writes I2., an arc centre or a chamfer of the path, in the ZX plane, which this run scales along X but not along Z, so the arc cannot be scaled in one piece.",
        )
        payload = run(text, profile="fanuc-lathe", operation="multiply", operand=2, addresses=["X", "Z"])
        self.assertEqual(lines_of(payload)[2], "G1 Z-20. I4. F0.2")
        self.assertEqual(payload["findings"], [])

    def test_a_sinumerik_arc(self):
        text = "N10 G90 G17 G0 X0 Y0\nN20 G1 X10 Y0 F100\nN30 G2 X20 Y10 I0 J10\nN40 M30"
        payload = run(text, profile="sinumerik-mill", operation="multiply", operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[2], "N30 G2 X20 Y10 I0 J10")
        self.assertEqual(reasons(payload), ["not-scaled"])

    def test_an_unknown_plane_counts_every_axis(self):
        payload = run("G90 G0 X0 Y0\nG1 X10 Y0 F100\nG2 X20 Y10 I0 J10.\nM30", operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(
            finding_at(payload, 3)["message"],
            "G2 X20 Y10 I0 J10.: runs the arc of G2 in a plane that is not known here, which this run scales along X and Y but not along Z, so the arc cannot be scaled in one piece.",
        )


class TestNcr6CornerWords(unittest.TestCase):
    """v1.2.0 NC review, NCR-6 (interim, owner decision 2026-10-18): a chamfer, a rounding or an
    angle written with a word no code describes keeps its size, so a multiply or divide of an
    axis of the plane leaves its block. A shift keeps them."""

    MILL = "%\nO1\nG90 G17 G0 X0. Y0. Z5.\nG1 X10. ,R2. F100\nY10. ,C1.\nX20. ,A30.\nM30\n%"

    def test_mill_comma_words_under_a_multiply_of_the_plane(self):
        payload = run(self.MILL, operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[3:6], ["G1 X10. ,R2. F100", "Y10. ,C1.", "X20. ,A30."])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(4, "not-scaled"), (5, "not-scaled"), (6, "not-scaled")])
        self.assertEqual(
            finding_at(payload, 4)["message"],
            "G1 X10. ,R2. F100: ,R2. is a chamfer, a rounding or an angle of the path, which is not scaled with X and Y, so the block cannot be scaled in one piece.",
        )

    def test_a_shift_or_a_scale_of_the_tool_axis_keeps_them(self):
        payload = run(self.MILL, operand=5, addresses=["X"])
        self.assertEqual(lines_of(payload)[3:6], ["G1 X15. ,R2. F100", "Y10. ,C1.", "X25. ,A30."])
        self.assertEqual(payload["findings"], [])
        payload = run(self.MILL, operation="multiply", operand=2, addresses=["Z"])
        self.assertEqual(lines_of(payload)[3:6], ["G1 X10. ,R2. F100", "Y10. ,C1.", "X20. ,A30."])
        self.assertEqual(payload["findings"], [])

    def test_lathe_corner_and_chamfer_of_a_straight_move(self):
        for word, message in (
            ("R2.", "R2. is a chamfer, a rounding or an angle of the path"),
            ("C2.", "C2. may be a chamfer of the path (or a move of the C axis, by a setting of the control)"),
            (",R2.", ",R2. is a chamfer, a rounding or an angle of the path"),
        ):
            with self.subTest(word=word):
                block = "G1 Z-10. %s F0.2" % word
                text = "%%\nO1\nG0 X20. Z2.\n%s\nX40.\nM30\n%%" % block
                payload = run(text, profile="fanuc-lathe", operation="multiply", operand=2, addresses=["X", "Z"])
                self.assertEqual(lines_of(payload)[3], block)
                self.assertEqual(
                    finding_at(payload, 4)["message"],
                    "%s: %s, which is not scaled with X and Z, so the block cannot be scaled in one piece." % (block, message),
                )
                payload = run(text, profile="fanuc-lathe", operand=1, addresses=["Z"])
                self.assertEqual(lines_of(payload)[3], block.replace("Z-10.", "Z-9."))
                self.assertEqual(payload["findings"], [])

    def test_a_rapid_c_axis_position_on_a_lathe_is_no_chamfer(self):
        # Guard: a chamfer or a rounding is written on a cutting move only.
        text = "G21 G18 G99\nG0 X20. Z2. C90.\nG1 Z-10. F0.2\nM30"
        payload = run(text, profile="fanuc-lathe", operation="multiply", operand=2, addresses=["X", "Z"])
        self.assertEqual(lines_of(payload)[1], "G0 X40. Z4. C90.")
        self.assertEqual(payload["findings"], [])

    def test_a_c_axis_move_on_a_mill_is_no_chamfer(self):
        # C is an axis of the milling profile: the block is judged as a rotary move, not a chamfer.
        payload = run("G90 G17 G21\nG0 X0. Y0. C0.\nG1 X10. C30. F100\nM30", operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(reasons(payload), ["rotary-without-tcp"])
        payload = run("G90 G17 G21\nG0 X0. Y0. C0.\nG1 Z-1. C30. F100\nM30", operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(payload["findings"], [])


class TestNcr9bEmptyToolAxisArgument(unittest.TestCase):
    """v1.2.0 NC review, NCR-9b: a Sinumerik cycle reads an empty argument as 0. A shift of the
    tool axis cannot move an empty position without writing a number into it, so the call is
    left, unless the empty depth is given by its twin (`DPR` for `DP`, `FDPR` for `FDEP`)."""

    HEAD = "N10 G90 G17 G0 X0 Y0 Z50\nN20 X10 Y10\n"

    def test_an_empty_reference_plane_is_left(self):
        payload = run(self.HEAD + "N30 CYCLE81(10,,2,-10)\nN40 M30", profile="sinumerik-mill", operand=5, addresses=["Z"])
        self.assertEqual(lines_of(payload)[2], "N30 CYCLE81(10,,2,-10)")
        self.assertEqual(
            finding_at(payload, 3)["message"],
            "N30 CYCLE81(10,,2,-10): RFP of CYCLE81 (argument 2) is empty, which the control reads as 0; a shift of Z cannot move it without writing a number there, so the cycle is left as written.",
        )
        self.assertEqual(reasons(payload), ["cycle-empty"])
        self.assertIn("1 cycle with an empty position on the tool axis", payload["message"])

    def test_a_depth_given_by_its_twin_is_moved(self):
        payload = run(self.HEAD + "N30 CYCLE81(10,0,2,,5)\nN40 CYCLE83(10,0,2,-30,,,5,1,0,0,1,0)\nN50 M30", profile="sinumerik-mill", operand=5, addresses=["Z"])
        self.assertEqual(lines_of(payload)[2:4], ["N30 CYCLE81(15,5,2,,5)", "N40 CYCLE83(15,5,2,-25,,,5,1,0,0,1,0)"])
        self.assertEqual(payload["findings"], [])

    def test_a_depth_left_out_with_its_twin_is_left(self):
        payload = run(self.HEAD + "N30 CYCLE81(10,0,2)\nN40 M30", profile="sinumerik-mill", operand=5, addresses=["Z"])
        self.assertEqual(
            finding_at(payload, 3)["message"],
            "N30 CYCLE81(10,0,2): DP of CYCLE81 (argument 4) is empty, which the control reads as 0, and DPR, which would give it instead, is empty too; a shift of Z cannot move it without writing a number there, so the cycle is left as written.",
        )

    def test_the_positions_under_mcall_are_left_with_their_call(self):
        text = self.HEAD + "N30 MCALL CYCLE81(10,,2,-10)\nN40 X20 Y20\nN50 MCALL\nN60 M30"
        payload = run(text, profile="sinumerik-mill", operand=5, addresses=["Z"])
        self.assertEqual(lines_of(payload)[2:4], ["N30 MCALL CYCLE81(10,,2,-10)", "N40 X20 Y20"])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(3, "cycle-empty"), (4, "cycle-empty")])


class TestEveryReasonHasItsWords(unittest.TestCase):
    """v1.2.0 D4 (item 4): every reason id the script can write has its words. The app shows a
    finding's message and severity and never maps the id to a label of its own, so the words of
    an id are the script's: the summary's count (`REASON_TEXT`) and, for a block reason, what a
    block of the same cycle says about the one that refused it (`SHORT`). The ids are the
    README's vocabulary, which the findings of every golden keep to (above)."""

    def test_every_block_and_word_reason_has_its_words(self):
        import importlib

        helpers.import_gedit_nc()  # puts the bundled scripts on sys.path
        module = importlib.import_module("address_arithmetic")
        self.assertEqual(set(module.BLOCK_REASONS), BLOCK_REASONS)
        self.assertEqual(set(module.WORD_REASONS), WORD_REASONS)
        self.assertEqual([r for r in list(module.BLOCK_REASONS) + list(module.WORD_REASONS) if not module.REASON_TEXT.get(r, (None,))[0]], [])
        self.assertEqual([r for r in module.BLOCK_REASONS if not module.SHORT.get(r)], [])


class TestD4CycleStartLevel(unittest.TestCase):
    """v1.2.0 NC fix round, batch D4: a cycle written as a word that starts a selection's holes
    while the tool axis still stands at the level of the lines above. A shift of the selection's
    Z words does not move that level: the cycle would move to its holes there and, in `G98`,
    return there. `G98` and `G99` are no data, so both refuse (`cycle-level-outside`), with the
    blocks of the cycle; a Z word of the selection before the cycle that the run moves gives it a
    moved level."""

    PROGRAM = ["%", "O1", "G21 G17 G90 G54", "G0 X0. Y0. Z50.", "%s G81 X10. Y10. Z-5. R2. F100.", "X20.", "G80", "G0 Z50.", "M30", "%"]

    def program(self, mode="G98"):
        return "\n".join((line % mode).strip() if "%s" in line else line for line in self.PROGRAM)

    def test_a_cycle_at_the_level_of_the_lines_above_is_left_with_its_blocks(self):
        for mode in ("G98", "G99", ""):
            with self.subTest(mode=mode):
                payload = run_selection(self.program(mode), 5, 8, operand=5, addresses=["Z", "R"])
                self.assertEqual(lines_of(payload)[:2], [("%s G81 X10. Y10. Z-5. R2. F100." % mode).strip(), "X20."])
                self.assertEqual(lines_of(payload)[3], "G0 Z55.")
                self.assertEqual([(f["line"], f["severity"], f["reason"]) for f in payload["findings"]], [(5, "warning", "cycle-level-outside"), (6, "warning", "cycle-level-outside")])
                self.assertIn("starts at the Z level the lines above the selection left the tool at, which this run does not change", payload["findings"][0]["message"])
                self.assertIn("2 cycles that start at the level of the lines above the selection", payload["message"])

    def test_a_z_word_of_the_selection_before_the_cycle_gives_it_a_moved_level(self):
        payload = run_selection(self.program(), 4, 8, operand=5, addresses=["Z", "R"])
        self.assertEqual(lines_of(payload)[:2], ["G0 X0. Y0. Z55.", "G98 G81 X10. Y10. Z0. R7. F100."])
        self.assertEqual(payload["findings"], [])

    def test_an_incremental_z_before_the_cycle_keeps_the_level_of_the_lines_above(self):
        text = "\n".join(["%", "O1", "G21 G17 G90 G54", "G0 X0. Y0. Z50.", "G91 G0 Z-10.", "G90 G98 G81 X10. Y10. Z-5. R2. F100.", "G80", "M30"])
        payload = run_selection(text, 5, 7, operand=5, addresses=["Z", "R"])
        self.assertIn((6, "cycle-level-outside"), [(f["line"], f["reason"]) for f in payload["findings"]])

    def test_guard_what_does_not_move_the_level_is_written(self):
        # A shift of X; a multiply (a level a scale would have to scale too, outside this rule);
        # the whole program; no Z written above the selection.
        payload = run_selection(self.program(), 5, 8, operand=5, addresses=["X"])
        self.assertEqual((payload["findings"], lines_of(payload)[0]), ([], "G98 G81 X15. Y10. Z-5. R2. F100."))
        payload = run_selection(self.program(), 5, 8, operation="multiply", operand=2, addresses=["Z", "R"])
        self.assertEqual((payload["findings"], lines_of(payload)[0]), ([], "G98 G81 X10. Y10. Z-10. R4. F100."))
        payload = run(self.program(), operand=5, addresses=["Z", "R"])
        self.assertEqual(payload["findings"], [])
        unwritten = "\n".join(["%", "O1", "G21 G17 G90 G54", "G0 X0. Y0.", "G98 G81 X10. Y10. Z-5. R2. F100.", "G80", "M30"])
        self.assertEqual(run_selection(unwritten, 5, 6, operand=5, addresses=["Z", "R"])["findings"], [])


class TestNcr5ArcRadius(unittest.TestCase):
    """v1.2.0 NC review, NCR-5 (owner decision 2026-10-18): a chosen R that is the radius of an
    arc is scaled with both axes of its plane, left and listed when neither is scaled or the run
    shifts, and refuses its block when only one of them is scaled."""

    MILL = "%\nO1\nG90 G17 G0 X0 Y0 Z5.\nG1 X10 Y0 F100\nG2 X20 Y10 Z-2. R10.\nG0 Z50.\nM30\n%"
    KLARTEXT = "\n".join([
        "0 BEGIN PGM T MM", "1 TOOL CALL 1 Z S3000", "2 L X+0 Y+0 Z+5 R0 FMAX", "3 L X+10 Y+0 RL F100",
        "4 CR X+20 Y+10 Z-2 R+10 DR+", "5 L X+30 R0", "6 END PGM T MM",
    ])

    def test_one_axis_of_the_plane_refuses(self):
        payload = run(self.MILL, operation="multiply", operand=2, addresses=["X", "R"])
        self.assertEqual(lines_of(payload)[4], "G2 X20 Y10 Z-2. R10.")
        self.assertEqual(
            finding_at(payload, 5)["message"],
            "G2 X20 Y10 Z-2. R10.: G2 writes R10., the radius of an arc in the XY plane, which this run scales along X but not along Y, so the arc cannot be scaled in one piece.",
        )

    def test_neither_axis_of_the_plane_leaves_and_lists_it(self):
        payload = run(self.MILL, operation="multiply", operand=2, addresses=["Z", "R"])
        self.assertEqual(lines_of(payload)[4], "G2 X20 Y10 Z-4. R10.")
        self.assertEqual(
            [(f["line"], f["reason"], f["severity"], f["message"]) for f in payload["findings"]],
            [(5, "data", "info", "R10.: the radius of the arc of G2 in the XY plane, which this run does not scale, so it is left as written.")],
        )

    def test_a_shift_leaves_and_lists_it(self):
        payload = run(self.MILL, operand=5, addresses=["Z", "R"])
        self.assertEqual(lines_of(payload)[4], "G2 X20 Y10 Z3. R10.")
        self.assertEqual(
            [(f["line"], f["reason"], f["message"]) for f in payload["findings"]],
            [(5, "data", "R10.: the radius of the arc of G2; a shift does not change a radius, so it is left as written.")],
        )

    def test_both_axes_of_the_plane_scale_it(self):
        payload = run(self.MILL, operation="multiply", operand=2, addresses=["X", "Y", "R"])
        self.assertEqual(lines_of(payload)[4], "G2 X40 Y20 Z-2. R20.")
        self.assertEqual(payload["findings"], [])

    def test_klartext_cr_the_same(self):
        def cr(payload):
            return lines_of(payload)[4]

        payload = run(self.KLARTEXT, profile="heidenhain-klartext", operation="multiply", operand=2, addresses=["X", "R"])
        self.assertEqual(cr(payload), "4 CR X+20 Y+10 Z-2 R+10 DR+")
        self.assertEqual(finding_at(payload, 5)["reason"], "not-scaled")
        payload = run(self.KLARTEXT, profile="heidenhain-klartext", operation="multiply", operand=2, addresses=["Z", "R"])
        self.assertEqual(cr(payload), "4 CR X+20 Y+10 Z-4 R+10 DR+")
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(5, "data")])
        payload = run(self.KLARTEXT, profile="heidenhain-klartext", operand=1, addresses=["Z", "R"])
        self.assertEqual(cr(payload), "4 CR X+20 Y+10 Z-1 R+10 DR+")
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(5, "data")])
        payload = run(self.KLARTEXT, profile="heidenhain-klartext", operation="multiply", operand=2, addresses=["X", "Y", "R"])
        self.assertEqual(cr(payload), "4 CR X+40 Y+20 Z-2 R+20 DR+")
        self.assertEqual(payload["findings"], [])


class TestNcr7ApproachSizes(unittest.TestCase):
    """v1.2.0 NC review, NCR-7 (owner decision 2026-10-18): the length and the radius of a Klartext
    approach or departure are process values. A multiply or divide of the plane scales the end
    points, keeps them and says so with a warning."""

    PROGRAM = "\n".join([
        "0 BEGIN PGM T MM", "1 TOOL CALL 1 Z S3000", "2 L X+0 Y+0 Z+5 R0 FMAX", "3 APPR LCT X+10 Y+0 R5 RL F100",
        "4 L X+10 Y+10", "5 DEP LCT X+70 Y+40 R5", "6 APPR LN X+10 Y+0 LEN15 RL", "7 L X+30 Y+0", "8 DEP LN LEN10",
        "9 END PGM T MM",
    ])

    def test_a_multiply_of_the_plane_keeps_them_with_a_warning(self):
        for addresses in (["X", "Y"], ["X", "Y", "R"]):
            with self.subTest(addresses=addresses):
                payload = run(self.PROGRAM, profile="heidenhain-klartext", operation="multiply", operand=2, addresses=addresses)
                self.assertEqual(
                    lines_of(payload)[3:9],
                    ["3 APPR LCT X+20 Y+0 R5 RL F100", "4 L X+20 Y+20", "5 DEP LCT X+140 Y+80 R5", "6 APPR LN X+20 Y+0 LEN15 RL", "7 L X+60 Y+0", "8 DEP LN LEN10"],
                )
                self.assertEqual(
                    [(f["line"], f["reason"], f["severity"]) for f in payload["findings"]],
                    [(4, "process-value", "warning"), (6, "process-value", "warning"), (7, "process-value", "warning"), (9, "process-value", "warning")],
                )
                self.assertEqual(finding_at(payload, 7)["message"], "LEN15: a size of APPR LN, kept; check the approach fits the scaled contour.")
                self.assertIn("4 approach or departure sizes", payload["message"])

    def test_a_shift_or_a_scale_of_z_lists_nothing(self):
        payload = run(self.PROGRAM, profile="heidenhain-klartext", operand=5, addresses=["X"])
        self.assertEqual(lines_of(payload)[6], "6 APPR LN X+15 Y+0 LEN15 RL")
        self.assertEqual(payload["findings"], [])
        payload = run(self.PROGRAM, profile="heidenhain-klartext", operation="multiply", operand=2, addresses=["Z"])
        self.assertEqual(payload["findings"], [])


class TestFb2ToolDirection(unittest.TestCase):
    """v1.2.0 review round X, FB-2 (WX-CODE-4, WX-NC-5): under Fanuc `G43.5` (and `G41.6`,
    `G42.6`) I, J and K are the tool direction, also in the blocks that do not write the code
    again. A multiply or divide must leave them as written: scaled, the tool would tilt."""

    PROGRAM = "\n".join([
        "O1000", "G90 G17 G54 G0 X0 Y0", "G43.5 X0 Y0 Z10. I0 J0 K1. H1", "G1 X10. Y5. I1. J0 K1. F500",
        "X20. I0.5 J0 K0.866", "G49", "G2 X30. Y5. I5. J0", "M30",
    ])

    def test_a_multiply_of_x_and_y_leaves_the_tool_direction_with_a_count_note(self):
        payload = run(self.PROGRAM, operation="multiply", operand=2, addresses=["X", "Y"])
        lines = lines_of(payload)
        self.assertEqual(lines[3], "G1 X20. Y10. I1. J0 K1. F500")
        self.assertEqual(lines[4], "X40. I0.5 J0 K0.866")
        for line in (4, 5):
            found = [f for f in payload["findings"] if f["line"] == line]
            self.assertEqual({f["reason"] for f in found}, {"count"}, found)
            self.assertIn("a parameter of G43.5, not an arc centre", found[0]["message"])
        # After G49 the same words are an arc centre again, scaled with the end point.
        self.assertEqual(lines[6], "G2 X60. Y10. I10. J0")

    def test_a_multiply_of_z_leaves_k(self):
        payload = run(self.PROGRAM, operation="multiply", operand=2, addresses=["Z"])
        self.assertEqual(lines_of(payload)[3], "G1 X10. Y5. I1. J0 K1. F500")
        self.assertEqual(lines_of(payload)[4], "X20. I0.5 J0 K0.866")
        self.assertEqual([f["reason"] for f in payload["findings"] if f["line"] in (4, 5)], ["count", "count"])

    def test_the_same_under_g41_6(self):
        text = "\n".join(["O1000", "G90 G17 G54 G0 X0 Y0", "G41.6 X5. Y5. I0 J0 K1. D1", "G1 X10. I1. J0 K0", "G40 G1 X20.", "M30"])
        payload = run(text, operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[3], "G1 X20. I1. J0 K0")
        found = [f for f in payload["findings"] if f["line"] == 4]
        self.assertEqual({f["reason"] for f in found}, {"count"}, found)
        self.assertIn("a parameter of G41.6", found[0]["message"])


class TestManualCheckD43OnlyPositionsNeedTheDistanceMode(unittest.TestCase):
    """Manual-check fix round, D4-3: G90/G91 govern where the axes go, not the feed. Only a
    position word (an axis, its incremental twin, an arc centre, `R` and the other position
    words) waits for an absolute distance mode; a feed, a dwell, a speed or a count is the
    same number in either mode, so a shift of it does not ask for G90."""

    PROGRAMS = ["G90 G94 G1 X10. F200", "G94 G1 X10. F200", "G1 X10. F200", "G91 G94 G1 X10. F200"]

    def run_on(self, context, text, **params):
        context = dict(context)
        context["params"] = dict({"operation": "add", "operand": 10, "addresses": ["F"]}, **params)
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
        result = helpers.run_script(SCRIPT, stdin=text, context=context)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_a_feed_moves_in_every_distance_mode_with_a_machine_and_without(self):
        for context in (helpers.effective_context("fanuc-gcode", preset="is-b"), helpers.effective_context("fanuc-gcode")):
            for program in self.PROGRAMS:
                with self.subTest(program=program, machine=context["machine"].get("id")):
                    payload = self.run_on(context, program + "\n")
                    self.assertEqual(lines_of(payload)[0], program.replace("F200", "F210"))
                    self.assertEqual(payload["findings"], [])

    def test_a_count_moves_under_g91(self):
        payload = run("G17\nG91 G83 X10. Y10. Z-5. R2. Q1. F100. K3\nG90 G80\n", operand=1, addresses=["K"])
        self.assertEqual(lines_of(payload)[1], "G91 G83 X10. Y10. Z-5. R2. Q1. F100. K4")

    def test_every_position_word_still_waits_for_an_absolute_distance_mode(self):
        context = helpers.effective_context("fanuc-gcode", preset="is-b")
        for program, addresses in (
            ("G91 G94 G1 X10. Y5. Z5. F200", ["X", "Y", "Z", "F"]),
            ("G94 G1 X10. Y5. Z5. F200", ["X", "Y", "Z", "F"]),
            ("G91 G94 G1 A30. C45. F200", ["A", "C", "F"]),
            ("G94 G1 A30. C45. F200", ["A", "C", "F"]),
        ):
            with self.subTest(program=program):
                payload = self.run_on(context, program + "\n", addresses=addresses)
                self.assertEqual(lines_of(payload)[0], program.replace("F200", "F210"))
                self.assertEqual(reasons(payload), ["incremental"] * (len(addresses) - 1))
        # The R plane and an arc centre (multiply includes the centres) of a known mode only.
        payload = run("G17\nG91 G81 X10. Z-7. R-48. F100.\nG90 G80\n", addresses=["R"])
        self.assertEqual(lines_of(payload)[1], "G91 G81 X10. Z-7. R-48. F100.")
        self.assertEqual(reasons(payload), ["incremental"])
        payload = run("G17 G2 X10. Y0 I5. J0 F100\n", addresses=["X", "Y"], arcCentres="yes")
        self.assertEqual(lines_of(payload)[0], "G17 G2 X10. Y0 I5. J0 F100")
        self.assertEqual(set(reasons(payload)), {"incremental"})
        # The lathe's incremental twins stay left in every mode.
        payload = run("G1 U10. W5. F0.2\n", profile="fanuc-lathe", operand=0.1, addresses=["U", "W", "F"])
        self.assertEqual(lines_of(payload)[0], "G1 U10. W5. F0.3")
        self.assertEqual(reasons(payload), ["incremental", "incremental"])


class TestManualCheckD45RoundedBack(unittest.TestCase):
    """Manual-check fix round, D4-5: a change too small for the form a word is written in
    rounds back to the value as written. The word stays, and the run says so: before, it said
    "Changed nothing" with no note, as if the word had not been asked for."""

    def test_a_feed_that_rounds_back_is_noted(self):
        payload = run("G98 G1 X10. F200\n", profile="fanuc-lathe", preset="is-b", operand=0.01, addresses=["F"])
        self.assertEqual(lines_of(payload)[0], "G98 G1 X10. F200")
        self.assertEqual([(f["line"], f["reason"], f["severity"]) for f in payload["findings"]], [(1, "rounded", "info")])
        self.assertEqual(
            payload["findings"][0]["message"],
            "F200: the change is smaller than this word's form can hold; rounded half away from zero, it stays F200.",
        )
        self.assertTrue(payload["message"].startswith("Changed nothing: 1 word rounded back to the value it is written with."), payload["message"])

    def test_a_point_less_position_that_rounds_back_is_noted(self):
        payload = run("G90 G1 X10000 Y5000\n", preset="is-b", operand=0.0001, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[0], "G90 G1 X10000 Y5000")
        self.assertEqual(reasons(payload), ["rounded", "rounded"])
        self.assertTrue(payload["message"].startswith("Changed nothing: 2 words rounded back to the value they are written with."), payload["message"])

    def test_a_change_that_rounds_to_a_new_value_keeps_its_note(self):
        payload = run("G98 G1 X10. F200\n", profile="fanuc-lathe", preset="is-b", operand=0.5, addresses=["F"])
        self.assertEqual(lines_of(payload)[0], "G98 G1 X10. F201")
        self.assertEqual(reasons(payload), ["rounded"])
        self.assertIn("written as F201", payload["findings"][0]["message"])
        self.assertIn("1 rounded to the form it is written in", payload["message"])

    def test_a_rounded_back_word_next_to_a_changed_one(self):
        payload = run("G90 G1 X10000 Z10.\n", preset="is-b", operand=0.0001, addresses=["X", "Z"])
        self.assertEqual(lines_of(payload)[0], "G90 G1 X10000 Z10.0001")
        self.assertEqual(reasons(payload), ["rounded"])
        self.assertTrue(payload["message"].startswith("Added 0.0001 to X and Z in 1 word on 1 block, 1 more rounded back to the value it is written with."), payload["message"])


class TestManualCheckD51AxisPointsOfACode(unittest.TestCase):
    """Manual-check fix round, D5-1 (the code side; the data is the Okuma database's): a
    parameter that is a coordinate of an axis (`CodeParam.axis`) and belongs to no arc, such
    as the change points `XA=`/`ZA=` of an Okuma LAP `G84`, moves with its axis like the
    contour around it, also in a block that writes no axis word; it is left and said so where
    the distance mode is incremental, and a value that cannot be computed refuses the block.
    The database is marked here, so the test does not wait for the data."""

    LAP = "\n".join([
        "G90 G00 X100. Z5.", "G85 NAT01 D4. F0.3 U0.4 W0.2", "$ G84 XA=60. ZA=-20. DA=2. FA=0.2", "NAT01 G81",
        "G01 X40. Z0.", "Z-30.", "X80.", "G80", "G00 X200. Z100.", "M30",
    ])

    def run_lap(self, text, **params):
        context = helpers.effective_context("okuma-osp", preset="okuma-1mm")
        codes = json.loads(json.dumps(context["codes"]))
        for entry in codes:
            if entry.get("code") == "G84" and any(p.get("address") == "ZA" for p in entry.get("params") or []):
                for param in entry["params"]:
                    if param["address"] in ("XA", "XB", "ZA", "ZB"):
                        param["axis"] = param["address"][0]
        context["codes"] = codes
        context["params"] = dict({"operation": "add", "operand": -10, "addresses": ["Z"]}, **params)
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
        result = helpers.run_script(SCRIPT, stdin=text, context=context)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_the_change_points_move_with_their_axis(self):
        payload = self.run_lap(self.LAP)
        self.assertEqual(lines_of(payload)[2], "$ G84 XA=60. ZA=-30. DA=2. FA=0.2")
        self.assertEqual(lines_of(payload)[4], "G01 X40. Z-10.")
        payload = self.run_lap(self.LAP, operand=2, addresses=["X"])
        self.assertEqual(lines_of(payload)[2], "$ G84 XA=62. ZA=-20. DA=2. FA=0.2")
        payload = self.run_lap(self.LAP, operation="multiply", operand=2)
        self.assertEqual(lines_of(payload)[2], "$ G84 XA=60. ZA=-40. DA=2. FA=0.2")

    def test_an_incremental_distance_mode_leaves_them_and_says_so(self):
        payload = self.run_lap(self.LAP.replace("G90 G00 X100. Z5.", "G91 G00 X0 Z0"))
        self.assertEqual(lines_of(payload)[2], "$ G84 XA=60. ZA=-20. DA=2. FA=0.2")
        self.assertIn((3, "incremental"), [(f["line"], f["reason"]) for f in payload["findings"]])

    def test_a_change_point_that_cannot_be_computed_refuses_its_block(self):
        payload = self.run_lap(self.LAP.replace("ZA=-20.", "ZA=V1"))
        self.assertEqual(lines_of(payload)[1:3], ["G85 NAT01 D4. F0.3 U0.4 W0.2", "$ G84 XA=60. ZA=V1 DA=2. FA=0.2"])
        finding = finding_at(payload, 2)
        self.assertEqual(finding["reason"], "cycle-expression")
        self.assertIn("ZA=V1 is a position of G84 on Z that cannot be computed", finding["message"])


class TestReviewRoundCodeValueOnAnAxisAddress(unittest.TestCase):
    """Manual-check integration (follow-up of review batch L, NC-6): the `C` of the Okuma
    fixed thread cycles `G31`-`G33` is the phase shift of the thread start (`position:
    'none'`), not the C axis. A run on C moves the C axis words around it and leaves that `C`
    as written, listed as a value of the code; so does any word on an axis address that a code
    of its block, or the motion code in force, declares as no position."""

    def okuma(self, body, **params):
        text = "G50 S2000\nG0 X50. Z5. C0.\n" + body + "\nG0 X80.\nM02"
        return run(text, profile="okuma-osp", preset="okuma-1mm", **dict({"operand": 10, "addresses": ["C"]}, **params))

    def test_the_phase_shift_of_a_fixed_thread_cycle_is_left(self):
        for code in ("G31", "G32", "G33"):
            with self.subTest(code=code):
                payload = self.okuma("G0 C10.\n%s X40. Z-20. F1.5 C90.\nX39.\nG0 C30." % code)
                self.assertEqual(
                    lines_of(payload)[1:6],
                    ["G0 X50. Z5. C10.", "G0 C20.", "%s X40. Z-20. F1.5 C90." % code, "X39.", "G0 C40."],
                )
                finding = finding_at(payload, 4)
                self.assertEqual(finding["reason"], "data")
                self.assertEqual(finding["message"], "C90.: a value of %s, not a position of this program." % code)

    def test_a_later_pass_under_the_cycle_leaves_its_c_too(self):
        payload = self.okuma("G33 X40. Z-20. F1.5 C90.\nX39. C180.")
        self.assertEqual(lines_of(payload)[2:4], ["G33 X40. Z-20. F1.5 C90.", "X39. C180."])
        self.assertEqual([(f["line"], f["reason"]) for f in payload["findings"]], [(3, "data"), (4, "data")])

    def test_a_multiply_of_c_leaves_it_and_x_and_z_still_move(self):
        payload = self.okuma("G33 X40. Z-20. F1.5 C90.", operation="multiply", operand=2)
        self.assertEqual(lines_of(payload)[2], "G33 X40. Z-20. F1.5 C90.")
        self.assertEqual(reasons(payload), ["data"])
        payload = self.okuma("G33 X40. Z-20. F1.5 C90.", addresses=["Z"], operand=-1)
        self.assertEqual(lines_of(payload)[2], "G33 X40. Z-21. F1.5 C90.")
        self.assertEqual(payload["findings"], [])
