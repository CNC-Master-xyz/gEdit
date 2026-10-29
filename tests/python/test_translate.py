"""`translate.py` (Phase 4 plan §5 P4a, P4.3; X19, X22), against the golden cases in
``tests/fixtures/scripts/translate/`` (the format is ``tests/fixtures/scripts/README.md``, "The geometry
goldens"). The runner was written by the P4a prelude; P4.3 added the cases of the exit criteria:

* every golden, byte for byte, with its message and findings (written runs and refused ones);
* identity: a shift of 0, 0, 0 gives every golden and every owner-public program back byte
  for byte;
* the round trip: a shift by d and then by -d gives every value back, on every written golden
  and on every owner-public program the shift by d does not refuse (the counts per refusal
  reason are printed, not asserted);
* the header and the form ids the runtime scenario and the user guide name;
* the run-level refusals (no code database, a selection whose lines above were not sent);
* regression tests for the gaps found in ``_nc_geom``/``_nc_path`` while writing the goldens
  (``ModuleGapTest``; all of them are fixed).

The programs are synthetic, written for gEdit; the owner-public ones are the owner's published
programs, reported as counts only.
"""

from __future__ import annotations

import concurrent.futures
import os
import unittest
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from tests.python import helpers
from tests.python.test_rotate import run_extra_axes, run_text

try:
    import tomllib  # noqa: F401

    HAS_TOMLLIB = True
except ImportError:  # Python 3.9 and 3.10
    HAS_TOMLLIB = False

gedit_nc = helpers.import_gedit_nc()
import _nc_path  # noqa: E402  (the bundled folder is on sys.path from here on)

SCRIPT = "translate.py"

#: The shift the owner-public round trip uses: odd values in every axis, so no word that moves
#: can come back by accident.
SHIFT = {"dx": 1.5, "dy": -2.25, "dz": 0.75}
ZERO = {"dx": 0, "dy": 0, "dz": 0}

OWNER_PUBLIC = helpers.FIXTURES_DIR / "nc" / "owner-public"
#: How many runs at once (each is its own process), and how long one may take on a 99,000-line
#: program at background priority.
WORKERS = max(1, min(4, os.cpu_count() or 1))
LONG_TIMEOUT_SECONDS = 1800
SHORT_TIMEOUT_SECONDS = 600


def run_script(script: str, stdin: str = "", context: Optional[Dict[str, Any]] = None) -> helpers.RunOutput:
    """`helpers.run_script` with a longer limit: at background priority on a busy machine a
    run of twenty lines has been seen to wait more than the 60 s the helper allows."""
    saved = helpers.RUN_TIMEOUT_SECONDS
    helpers.RUN_TIMEOUT_SECONDS = max(saved, SHORT_TIMEOUT_SECONDS)
    try:
        return helpers.run_script(script, stdin=stdin, context=context)
    finally:
        helpers.RUN_TIMEOUT_SECONDS = saved


def negated(params: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(params)
    for key in ("dx", "dy", "dz"):
        if key in out and out[key] not in (None, ""):
            out[key] = -out[key]
    return out


def as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def refused(result: Dict[str, Any]) -> bool:
    return any(f.get("severity") == "error" for f in result.get("findings", []))


def values_of(text: str, profile: Dict[str, Any]) -> List[Tuple[Any, ...]]:
    """The program as the tokenizer reads it, every number as its value: ``X0.`` and ``X0.00``
    are the same, ``X0.`` and ``X0.5`` are not. Call arguments are compared one by one."""
    cp = gedit_nc.compile_profile(profile)
    out: List[Tuple[Any, ...]] = []
    state = None
    for number, line in enumerate(text.split("\n"), 1):
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        for token in tokens:
            if token.kind == "whitespace":
                continue
            literal, function = _nc_path.literal_of(token) if token.kind == "word" else (None, None)
            if literal is not None:
                # `X10.`, `Q203=+0,5` and `I=AC(10)`: the value, and the value function.
                value = gedit_nc.decimal_of(literal)
                out.append((number, "word", (token.address or "").upper(), function, value.normalize() if value is not None else token.text))
            elif token.kind == "call" and token.value_text:
                args = []
                for arg in token.value_text.split(","):
                    literal = gedit_nc.parse_number(arg.strip())
                    value = gedit_nc.decimal_of(literal) if literal is not None else None
                    args.append(value.normalize() if value is not None else arg.strip())
                out.append((number, "call", token.address, tuple(args)))
            else:
                out.append((number, token.kind, token.text))
    return out


def owner_public_programs() -> List[Tuple[str, str, str]]:
    """``(name, profile id, text)`` of every owner-public program, as the app hands it over."""
    out = []
    for path in sorted(OWNER_PUBLIC.rglob("*")):
        if not path.is_file():
            continue
        raw = path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("cp1252")
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        out.append((path.relative_to(OWNER_PUBLIC).as_posix(), path.parent.name, text))
    return out


def run_document(text: str, profile_id: str, params: Dict[str, Any]) -> helpers.RunOutput:
    context = helpers.effective_context(profile_id, params=params)
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    return run_script(SCRIPT, stdin=text, context=context)


def golden_context(case: helpers.GeometryCase) -> Dict[str, Any]:
    """``helpers.geometry_context`` with the lines below a selection (FZ-5): a golden's selection
    ends the document, so they are none."""
    context = helpers.geometry_context(case)
    scope = context.get("input")
    if isinstance(scope, dict) and scope.get("scope") == "selection":
        scope.setdefault("followingLines", [])
    return context


def run_inline(
    text: str, profile_id: str, params: Dict[str, Any], preceding: Optional[List[str]] = None, following: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """One run of an inline program; ``preceding`` makes it a selection below those lines, which
    ends the document unless ``following`` gives the lines below it (FZ-5)."""
    context = helpers.effective_context(profile_id, params=params)
    lines = text.split("\n")
    if preceding is not None:
        start = len(preceding) + 1
        context["input"] = {
            "scope": "selection", "startLine": start, "endLine": start + len(lines) - 1, "precedingLines": preceding,
            "followingLines": list(following or []),
        }
    out = run_script(SCRIPT, stdin=text, context=context)
    if not out.ok:
        raise AssertionError(out.stderr)
    return out.json()


class GoldenTest(unittest.TestCase):
    def test_every_case(self) -> None:
        cases = helpers.geometry_cases("translate")
        self.assertGreaterEqual(len(cases), 30)
        for case in cases:
            with self.subTest(case=case.name):
                out = run_script(SCRIPT, stdin=case.input_text(), context=golden_context(case))
                self.assertTrue(out.ok, out.stderr)
                result = out.json()
                self.assertEqual(result["text"], case.expected_text())
                want = case.envelope()
                self.assertEqual(result.get("message"), want["message"])
                self.assertEqual(result.get("findings", []), want["findings"])
                self.assertEqual(refused(result), case.refused)

    def test_every_built_in_profile_has_a_written_golden_and_a_refused_one(self) -> None:
        written, refusing = set(), set()
        for case in helpers.geometry_cases("translate"):
            (refusing if case.refused else written).add(case.profile_id)
        profiles = {"fanuc-gcode", "fanuc-lathe", "heidenhain-klartext", "okuma-osp", "sinumerik", "sinumerik-mill"}
        self.assertEqual(written, profiles)
        self.assertEqual(refusing, profiles)

    def test_the_refused_goldens_cover_every_x22_reason_of_translate(self) -> None:
        seen = set()
        for case in helpers.geometry_cases("translate"):
            for finding in case.envelope()["findings"]:
                if finding["severity"] == "error":
                    seen.add(finding["reason"])
        wanted = {
            "frame", "coordinate-shift", "intermediate-point", "call", "expression", "machine-dependent",
            "distance-assumed", "axis-unwritten", "unknown-code", "rotary-turned", "selection-inside",
            "cycle-not-reviewed", "fk-contour", "arc-unsupported", "resolution",
            # Round Y review (WY-NC-4): golden g70-pair-finish-only.
            "contour-split",
        }
        self.assertLessEqual(wanted, seen)


class IdentityAndRoundTripTest(unittest.TestCase):
    """X19 on the goldens: 0, 0, 0 gives the input back byte for byte; d then -d every value."""

    def test_a_zero_shift_gives_every_golden_back_byte_for_byte(self) -> None:
        for case in helpers.geometry_cases("translate"):
            with self.subTest(case=case.name):
                context = golden_context(case)
                context["params"] = dict(ZERO)
                out = run_script(SCRIPT, stdin=case.input_text(), context=context)
                self.assertTrue(out.ok, out.stderr)
                self.assertEqual(out.json()["text"], case.input_text())

    def test_d_then_minus_d_gives_every_value_of_every_written_golden_back(self) -> None:
        checked = 0
        for case in helpers.geometry_cases("translate"):
            if case.refused:
                continue
            with self.subTest(case=case.name):
                context = golden_context(case)
                context["params"] = negated(case.params)
                out = run_script(SCRIPT, stdin=case.expected_text(), context=context)
                self.assertTrue(out.ok, out.stderr)
                result = out.json()
                self.assertFalse(refused(result), result.get("findings"))
                profile = context["profile"]
                back = values_of(result["text"], profile)
                # v1.2.0 (D4): a word the forward run added to a selection's first move comes
                # back as the unmoved value of the lines above; the input never wrote it.
                first = as_dict(context.get("input")).get("startLine") or 1
                added = {f["line"] - first + 1 for f in case.envelope()["findings"] if f.get("reason") == "word-added"}
                written = values_of(case.input_text(), profile)
                back = [v for v in back if not (v[0] in added and v[1] == "word" and v not in written)]
                self.assertEqual(back, written)
                checked += 1
        self.assertGreaterEqual(checked, 10)


class OwnerPublicTest(unittest.TestCase):
    """X19 on the owner's published programs: identity, and the round trip where d is not
    refused. What each refusal reason counts is printed for the review, not asserted."""

    results: Dict[Tuple[str, str], helpers.RunOutput] = {}
    programs: List[Tuple[str, str, str]] = []

    @classmethod
    def setUpClass(cls) -> None:
        cls.programs = owner_public_programs()
        texts = {name: (profile, text) for name, profile, text in cls.programs}
        saved = helpers.RUN_TIMEOUT_SECONDS
        helpers.RUN_TIMEOUT_SECONDS = LONG_TIMEOUT_SECONDS
        try:
            jobs = [(name, kind) for name, _, _ in cls.programs for kind in ("zero", "shift")]
            jobs.sort(key=lambda job: -len(texts[job[0]][1]))
            with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
                futures = {
                    pool.submit(run_document, texts[name][1], texts[name][0], ZERO if kind == "zero" else SHIFT): (name, kind)
                    for name, kind in jobs
                }
                results = {futures[f]: f.result() for f in concurrent.futures.as_completed(futures)}
                back = []
                for name, (profile, _) in texts.items():
                    shifted = results[(name, "shift")]
                    if shifted.ok and not refused(shifted.json()):
                        back.append((name, profile, shifted.json()["text"]))
                futures = {pool.submit(run_document, text, profile, negated(SHIFT)): (name, "back") for name, profile, text in back}
                results.update({futures[f]: f.result() for f in concurrent.futures.as_completed(futures)})
            cls.results = results
        finally:
            helpers.RUN_TIMEOUT_SECONDS = saved

    def test_there_are_the_twenty_published_programs(self) -> None:
        self.assertEqual(len(self.programs), 20)

    def test_no_run_crashes_and_a_refused_run_hands_the_input_back(self) -> None:
        for name, _, text in self.programs:
            for kind in ("zero", "shift"):
                with self.subTest(program=name, run=kind):
                    out = self.results[(name, kind)]
                    self.assertTrue(out.ok, out.stderr[-2000:])
                    result = out.json()
                    if refused(result):
                        self.assertEqual(result["text"], text)

    def test_a_zero_shift_gives_every_program_back_byte_for_byte(self) -> None:
        for name, _, text in self.programs:
            with self.subTest(program=name):
                self.assertEqual(self.results[(name, "zero")].json()["text"], text)

    def test_d_then_minus_d_gives_every_value_back(self) -> None:
        moved = 0
        counts: Dict[str, int] = {}
        for name, profile, text in self.programs:
            shifted = self.results[(name, "shift")].json()
            if refused(shifted):
                reasons = sorted({f["reason"] for f in shifted["findings"] if f["severity"] == "error"})
                for reason in reasons:
                    counts[reason] = counts.get(reason, 0) + 1
                print("\n  translate %s: refused (%s)" % (name, ", ".join(reasons)), end="")
                continue
            with self.subTest(program=name):
                back = self.results[(name, "back")]
                self.assertTrue(back.ok, back.stderr[-2000:])
                result = back.json()
                self.assertFalse(refused(result), result.get("findings", [])[:5])
                eff = helpers.effective_context(profile)["profile"]
                self.assertEqual(values_of(result["text"], eff), values_of(text, eff))
                same = result["text"] == text
                print("\n  translate %s: moved and back%s" % (name, "" if same else " (values; some words written with more decimals)"), end="")
                moved += 1
        print("\n  translate owner-public: %d moved and back, %d refused; programs refused per reason: %s"
              % (moved, len(self.programs) - moved, ", ".join("%s %d" % kv for kv in sorted(counts.items())) or "none"))
        # A refused run is clean by itself, so a floor keeps a script that came to refuse everything
        # from passing. Measured on 2026-10-16: 5 of the 20 programs are moved and come back; the
        # floor is one below. A deliberate new refusal may lower it, in the commit that adds it.
        self.assertGreaterEqual(moved, 4, "translate moved %d of the 20 owner-public programs: a new refusal? lower the floor on purpose" % moved)


class RunTest(unittest.TestCase):
    """What the script does outside the goldens."""

    PROGRAM = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90\nG0 X10. Y10. Z5.\nM30\n"

    def test_a_shift_that_is_no_number_stops_with_a_plain_message(self) -> None:
        context = helpers.effective_context("fanuc-gcode", params={"dx": "ten"})
        out = run_script(SCRIPT, stdin=self.PROGRAM, context=context)
        self.assertEqual(out.returncode, 1)
        self.assertIn("X shift: 'ten' is not a number.", out.stderr)

    def test_a_decimals_choice_the_form_does_not_offer_stops(self) -> None:
        context = helpers.effective_context("fanuc-gcode", params={"dx": 1, "decimals": "3"})
        out = run_script(SCRIPT, stdin=self.PROGRAM, context=context)
        self.assertEqual(out.returncode, 1)
        self.assertIn("Decimal places", out.stderr)

    def test_no_profile_stops(self) -> None:
        out = run_script(SCRIPT, stdin=self.PROGRAM, context={"contract": 2})
        self.assertEqual(out.returncode, 1)
        self.assertIn("needs a dialect profile", out.stderr)

    def test_without_a_code_database_nothing_is_moved(self) -> None:
        context = helpers.effective_context("fanuc-gcode", params={"dx": 1})
        context["codes"] = []
        out = run_script(SCRIPT, stdin=self.PROGRAM, context=context)
        result = out.json()
        self.assertEqual(result["text"], self.PROGRAM)
        self.assertEqual([f["reason"] for f in result["findings"]], ["no-database"])
        self.assertEqual(result["findings"][0]["severity"], "error")

    def test_a_selection_whose_lines_above_were_not_sent_is_refused(self) -> None:
        context = helpers.effective_context("fanuc-gcode", params={"dx": 1})
        context["input"] = {"scope": "selection", "startLine": 3, "endLine": 3}
        out = run_script(SCRIPT, stdin="G0 X10. Y10.", context=context)
        result = out.json()
        self.assertEqual(result["text"], "G0 X10. Y10.")
        self.assertEqual([(f["line"], f["reason"], f["severity"]) for f in result["findings"]], [(3, "selection-unprimed", "error")])

    def test_the_text_keeps_its_last_line_break(self) -> None:
        result = run_inline(self.PROGRAM, "fanuc-gcode", {"dx": 1})
        self.assertEqual(result["text"], self.PROGRAM.replace("X10.", "X11."))

    def test_a_selection_ending_with_a_line_break_inside_a_klartext_block_is_refused(self) -> None:
        # Regression (P4.3): the trailing empty element of a selection that ends with a line
        # break hid the `~` of its last line, and the half block was moved.
        preceding = ["0 BEGIN PGM T MM", "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE"]
        text = "2 CYCL DEF 200 DRILLING ~\n  Q203=+0 ;SURFACE COORDINATE ~\n"
        result = run_inline(text, "heidenhain-klartext", {"dz": 1}, preceding)
        self.assertEqual(result["text"], text)
        # One block, one finding: at its first line (the definition the shift changes, which
        # calls below the selection may run, and the `~` of its last line).
        self.assertEqual([(f["line"], f["reason"]) for f in result["findings"]], [(3, "selection-inside")])

    def test_a_klartext_definition_moved_in_a_selection_that_its_calls_below_may_run_is_refused(self) -> None:
        preceding = ["0 BEGIN PGM T MM", "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE", "2 TOOL CALL 1 Z S3000"]
        text = "3 CYCL DEF 200 DRILLING ~\n  Q201=-10 ;DEPTH ~\n  Q203=+0 ;SURFACE COORDINATE\n4 L X+10 Y+10 R0 FMAX M99"
        moved = run_inline(text, "heidenhain-klartext", {"dz": 1}, preceding)
        self.assertEqual([(f["line"], f["reason"]) for f in moved["findings"]], [(4, "selection-inside")])
        # A shift that leaves the definition as it is leaves the calls below right: no refusal.
        across = run_inline(text, "heidenhain-klartext", {"dx": 1}, preceding)
        self.assertFalse(refused(across), across["findings"])
        self.assertIn("4 L X+11 Y+10 R0 FMAX M99", across["text"])

    def test_one_finding_per_refused_block_with_its_first_reason(self) -> None:
        # `G1 X#1` in a frame: frame comes first in the order of _nc_geom.REASONS.
        text = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90\nG0 X0. Y0.\nG68 X0. Y0. R10.\nG1 X#1 F100.\nM30\n"
        result = run_inline(text, "fanuc-gcode", {"dx": 1})
        self.assertEqual([(f["line"], f["reason"]) for f in result["findings"]], [(4, "frame"), (5, "frame")])


class ReviewFixTest(unittest.TestCase):
    """The P4a review's findings on translate (fix batch B3); the goldens `b3-*` hold the
    reproductions, these the edges around them."""

    KLARTEXT = (
        "0 BEGIN PGM T MM\n1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\n2 TOOL CALL 1 Z S3000\n"
        "3 CYCL DEF 200 DRILLING ~\n  Q201=-10 ;DEPTH ~\n  Q203=+0 ;SURFACE COORDINATE\n"
        "4 L Z+50 R0 FMAX\n5 CYCL CALL POS X+10 Y+10 Z+0 FMAX\n6 L X+30 Y+10 R0 FMAX M99\n7 END PGM T MM"
    )

    def errors(self, result: Dict[str, Any]) -> List[Tuple[int, str]]:
        return [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"]

    def test_nc3_a_z_shift_refuses_a_cycle_called_at_a_position_and_its_definition(self) -> None:
        # TNC 640 cycle manual, CYCL CALL POS: the call's tool-axis coordinate acts as a further
        # datum shift on top of Q203, so moving both moves the hole twice, and moving one leaves
        # the tool driving to an unmoved Z.
        result = run_inline(self.KLARTEXT, "heidenhain-klartext", {"dz": 1})
        self.assertEqual(result["text"], self.KLARTEXT)
        self.assertEqual(self.errors(result), [(4, "cycle-position"), (8, "cycle-position")])
        self.assertIn("CYCL CALL POS, line 8", result["findings"][0]["message"])
        self.assertIn("a Z shift would move the cycle twice", result["findings"][1]["message"])
        # with the Z shift together with X and Y as well
        both = run_inline(self.KLARTEXT, "heidenhain-klartext", {"dx": 1, "dz": 1})
        self.assertEqual(self.errors(both), [(4, "cycle-position"), (8, "cycle-position")])

    def test_nc3_a_shift_in_x_and_y_moves_the_call_and_leaves_its_z(self) -> None:
        result = run_inline(self.KLARTEXT, "heidenhain-klartext", {"dx": 1, "dy": -2})
        self.assertFalse(refused(result), result["findings"])
        lines = result["text"].split("\n")
        self.assertIn("5 CYCL CALL POS X+11 Y+8 Z+0 FMAX", lines)
        self.assertIn("  Q203=+0 ;SURFACE COORDINATE", lines)

    def test_nc3_a_z_shift_still_moves_a_cycle_run_at_the_current_position(self) -> None:
        text = self.KLARTEXT.replace("5 CYCL CALL POS X+10 Y+10 Z+0 FMAX", "5 L X+10 Y+10 R0 FMAX\n55 CYCL CALL")
        result = run_inline(text, "heidenhain-klartext", {"dz": 1})
        self.assertFalse(refused(result), result["findings"])
        self.assertIn("  Q203=+1 ;SURFACE COORDINATE", result["text"].split("\n"))

    def test_nc3_a_call_whose_definition_is_above_the_selection_is_refused(self) -> None:
        lines = self.KLARTEXT.split("\n")
        result = run_inline("\n".join(lines[7:]), "heidenhain-klartext", {"dz": 1}, lines[:7])
        self.assertEqual([line for line, _ in self.errors(result)], [8, 9])

    def test_nc10_an_incremental_index_of_zero_turns_nothing(self) -> None:
        text = (
            "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90 G54\nG0 X0. Y0. Z50.\n"
            "G91 G0 A0.\nG90 G1 X20. Y5. F200.\nM30"
        )
        result = run_inline(text, "fanuc-gcode", {"dy": 2})
        self.assertFalse(refused(result), result["findings"])
        # …and an index by a variable, whose value is not known, counts as turned
        turned = run_inline(text.replace("G91 G0 A0.", "G91 G0 A#1"), "fanuc-gcode", {"dy": 2})
        self.assertIn((5, "rotary-turned"), self.errors(turned))

    def test_nc10_an_incremental_index_after_a_known_position_refuses_as_before(self) -> None:
        text = (
            "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90 G54\nG0 A0.\nG0 X0. Y0. Z50.\n"
            "G91 G0 A90.\nG90 G1 X20. Y5. F200.\nM30"
        )
        result = run_inline(text, "fanuc-gcode", {"dy": 2})
        self.assertEqual(self.errors(result), [(6, "rotary-turned")])

    def test_code3_a_selection_from_line_1_that_ends_inside_a_klartext_block_is_refused(self) -> None:
        text = "0 BEGIN PGM T MM\n1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\n2 CYCL DEF 200 DRILLING ~\n  Q203=+0 ;SURFACE COORDINATE ~"
        context = helpers.effective_context("heidenhain-klartext", params={"dz": 1})
        context["input"] = {"scope": "selection", "startLine": 1, "endLine": 4}
        out = run_script(SCRIPT, stdin=text, context=context)
        result = out.json()
        self.assertEqual(result["text"], text)
        self.assertEqual(self.errors(result), [(3, "selection-inside")])

    def test_code3_the_whole_document_from_line_1_is_no_selection(self) -> None:
        # The same lines as a whole document: nothing runs below it, so its end is no edge.
        text = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90\nG0 X0. Y0. Z50.\nG81 X10. Y10. Z-5. R2. F100."
        out = run_document(text, "fanuc-gcode", {"dz": 1})
        self.assertFalse(refused(out.json()), out.json()["findings"])


class HeaderTest(unittest.TestCase):
    PARAMS = ["dx", "dy", "dz", "decimals"]

    def header_source(self) -> str:
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

    def test_fifteen_minutes_as_the_owner_decided_for_the_geometry_scripts(self) -> None:
        # Q-C (the owner, 2026-10-16): translate, rotate and mirror get 900 s.
        self.assertIn("\ntimeout = 900\n", "\n" + self.header_source() + "\n")

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_the_header_is_the_toml_the_backend_expects(self) -> None:
        import tomllib

        meta = tomllib.loads(self.header_source())
        self.assertEqual(meta["name"], "Translate")
        self.assertEqual(meta["input"], "selection-or-document")
        self.assertEqual(meta["output"], "replace")
        self.assertIs(meta["envelope"], True)
        self.assertEqual(meta["timeout"], 900)
        self.assertNotIn("profiles", meta)

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_the_form_ids_are_the_pinned_ones(self) -> None:
        import tomllib

        params = tomllib.loads(self.header_source())["params"]
        self.assertEqual([p["id"] for p in params], self.PARAMS)
        by_id = {p["id"]: p for p in params}
        for axis in ("dx", "dy", "dz"):
            self.assertEqual(by_id[axis]["type"], "number")
            self.assertEqual(by_id[axis]["default"], 0)
        self.assertIn("diameter", by_id["dx"]["help"])
        self.assertEqual(by_id["decimals"]["type"], "choice")
        self.assertEqual([c["value"] for c in by_id["decimals"]["choices"]], ["keep"])
        self.assertEqual(by_id["decimals"]["default"], "keep")


class ModuleGapTest(unittest.TestCase):
    """Gaps of `_nc_geom`/`_nc_path` found by P4.3 and fixed by the P4a Wave B integration (plan
    §7 #299 to #305). Each was an expected failure; each now holds its fix."""

    def reasons(self, result: Dict[str, Any]) -> List[Tuple[int, str]]:
        return [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"]

    def test_a_klartext_pattern_definition_refuses_a_translate(self) -> None:
        # X22: a PATTERN DEF has absolute positions of its own, which gEdit does not move
        # (`cycle-position`, from its database entry, plan §7 #301).
        text = (
            "0 BEGIN PGM T MM\n1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\n"
            "2 PATTERN DEF ~\n  POS1 (X+25 Y+33 Z+0)\n3 END PGM T MM"
        )
        result = run_inline(text, "heidenhain-klartext", {"dx": 1})
        self.assertEqual(self.reasons(result), [(3, "cycle-position")])
        self.assertEqual(result["text"], text)

    def test_a_pattern_call_runs_at_positions_kept_elsewhere(self) -> None:
        # `CYCL CALL PAT` writes none of its positions: they are in a pattern or a point table.
        # `CYCL CALL POS X… Y… Z…` writes them, and they move.
        text = (
            "0 BEGIN PGM T MM\n1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\n"
            "2 CYCL DEF 200 DRILLING ~\n  Q200=+2 ;SET-UP CLEARANCE ~\n  Q201=-5 ;DEPTH\n"
            "3 L Z+50 R0 FMAX\n4 CYCL CALL PAT F5000\n5 END PGM T MM"
        )
        self.assertEqual(self.reasons(run_inline(text, "heidenhain-klartext", {"dx": 1})), [(7, "cycle-position")])
        moved = run_inline(text.replace("4 CYCL CALL PAT F5000", "4 CYCL CALL POS X+10 Y+10 Z+0"), "heidenhain-klartext", {"dx": 1})
        self.assertFalse(refused(moved), moved["findings"])
        self.assertIn("4 CYCL CALL POS X+11 Y+10 Z+0", moved["text"].split("\n"))

    def test_an_absolute_centre_of_the_face_axis_is_a_diameter_under_diamon(self) -> None:
        # SINUMERIK 840D sl programming manual, diameter programming: under DIAMON and DIAM90
        # an interpolation parameter I, J, K written with AC is a diameter; with IC a radius.
        text = (
            "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\nN10 G18 G90 DIAMON\nN20 G0 X60 Z0\n"
            "N30 G3 X80 Z-10 I=AC(60) K=AC(-10)\nN40 DIAM90\nN50 G2 X60 Z0 I=AC(60) K=AC(-10)\n"
            "N60 DIAMOF\nN70 G0 X30 Z0\nN80 G3 X40 Z-10 I=AC(30) K=AC(-10)\nN90 G3 X50 Z-20 I=IC(10) K=IC(0)"
        )
        result = run_inline(text, "sinumerik", {"dx": 1})
        lines = result["text"].split("\n")
        self.assertEqual(lines[3], "N30 G3 X81 Z-10 I=AC(61) K=AC(-10)")
        self.assertEqual(lines[5], "N50 G2 X61 Z0 I=AC(61) K=AC(-10)")
        # under DIAMOF X and the absolute centre are radii: a diameter shift of 1 is 0.5
        self.assertEqual(lines[8], "N80 G3 X40.5 Z-10 I=AC(30.5) K=AC(-10)")
        self.assertEqual(lines[9], "N90 G3 X50.5 Z-20 I=IC(10) K=IC(0)")

    def test_an_incremental_move_needs_no_start_on_an_axis_it_does_not_write(self) -> None:
        # `axis-unwritten` is for the axes the block moves incrementally: a G91 X move after a
        # drilling cycle (which leaves Z not known) is not refused for Z (plan §7 #303).
        text = (
            "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90\nG0 X0. Y0. Z50.\n"
            "G81 X10. Y10. Z-5. R2. F100.\nG91 X10.\nG80\nG90 G0 Z50.\nM30"
        )
        result = run_inline(text, "fanuc-gcode", {"dx": 1, "dz": 1})
        self.assertFalse(refused(result), result["findings"])
        # …and still is for an axis it does move from a start nobody knows (v1.2.0, T011: the
        # cycle started from a machine position; from Z50. it would leave Z at a level the
        # program wrote, which the shift moves too).
        unknown = text.replace("G91 X10.", "G91 Z-1.").replace("G0 X0. Y0. Z50.\n", "G0 X0. Y0. Z50.\nG28 G91 Z0.\nG90\n")
        self.assertEqual(self.reasons(run_inline(unknown, "fanuc-gcode", {"dx": 1, "dz": 1})), [(7, "axis-unwritten")])

    def test_the_cancel_form_of_a_sinumerik_frame_refuses_nothing(self) -> None:
        # SINUMERIK 840D sl programming manual, frame instructions: TRANS, ROT, SCALE and MIRROR
        # without an axis delete the programmable frame; CYCLE800() resets the swivel plane;
        # TRANS with zeros replaces the frame by none, ATRANS with zeros adds nothing.
        text = (
            "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\nN10 G17 G90 G71 G54\nN20 ROT\n"
            "N30 MIRROR\nN40 SCALE\nN50 TRANS\nN60 CYCLE800()\nN70 TRANS X0 Y0 Z0\nN80 ATRANS X0\n"
            "N90 G0 X0 Y0 Z50\nN100 M30"
        )
        result = run_inline(text, "sinumerik-mill", {"dx": 1})
        self.assertFalse(refused(result), result["findings"])
        self.assertIn("N90 G0 X1 Y0 Z50", result["text"].split("\n"))
        # a frame with values, and a shift that is not zero, still refuse
        frame = run_inline(text.replace("N20 ROT", "N20 ROT RPL=30"), "sinumerik-mill", {"dx": 1})
        self.assertEqual(self.reasons(frame)[0], (3, "frame"))
        shift = run_inline(text.replace("ATRANS X0", "ATRANS X0.5"), "sinumerik-mill", {"dx": 1})
        self.assertEqual(self.reasons(shift), [(9, "coordinate-shift")])

    def test_a_bare_cycle800_resets_and_refuses_nothing(self) -> None:
        # CAM programs write `CYCLE800` with no arguments at the top to reset the swivel plane.
        text = "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\nN10 G17 G90 G71 G54\nN20 CYCLE800()\nN30 G0 X0 Y0 Z50\nN40 M30"
        result = run_inline(text, "sinumerik-mill", {"dx": 1})
        self.assertFalse(refused(result), result["findings"])

    def test_the_klartext_reset_header_refuses_nothing(self) -> None:
        # TNC 640 cycle manual: a datum shift to X=0, Y=0 resets cycle 7, a rotation angle of 0
        # resets cycle 10, cycle 8 defined again without an axis ends the mirror, and a tilt
        # with every angle 0 is no tilt.
        text = (
            "0 BEGIN PGM T MM\n1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\n2 CYCL DEF 7.0 DATUM SHIFT\n"
            "3 CYCL DEF 7.1 X0\n4 CYCL DEF 7.2 Y+0,\n5 PLANE SPATIAL SPA0 SPB0 SPC0 STAY\n6 CYCL DEF 10.0 ROTATION\n"
            "7 CYCL DEF 10.1 ROT+0\n8 CYCL DEF 8.0 MIRROR IMAGE\n9 CYCL DEF 8.1\n10 PLANE RESET STAY\n"
            "11 L X+10 Y+10 R0 FMAX\n12 END PGM T MM"
        )
        result = run_inline(text, "heidenhain-klartext", {"dx": 1})
        self.assertFalse(refused(result), result["findings"])
        self.assertIn("11 L X+11 Y+10 R0 FMAX", result["text"].split("\n"))
        # a rotation that is not 0, an increment of it, and a line of the datum table refuse
        turned = run_inline(text.replace("ROT+0", "ROT+30"), "heidenhain-klartext", {"dx": 1})
        self.assertEqual(self.reasons(turned)[0], (8, "frame"))
        increment = run_inline(text.replace("ROT+0", "IROT+15"), "heidenhain-klartext", {"dx": 1})
        self.assertEqual(self.reasons(increment)[0], (8, "frame"))
        table = run_inline(text.replace("3 CYCL DEF 7.1 X0", "3 CYCL DEF 7.1 #5"), "heidenhain-klartext", {"dx": 1})
        self.assertEqual(self.reasons(table), [(4, "coordinate-shift")])

    def test_the_fanuc_cancel_codes_refuse_nothing(self) -> None:
        # FANUC 30i operator's manual: G69 cancels the rotation, G50.1 the programmable mirror,
        # G15 the polar command, G50 the scaling, G52 with every axis 0 the local coordinate
        # system. G92 with zeros sets the position, which is no reset.
        text = (
            "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90\nG69\nG50.1 X0 Y0\nG15\n"
            "G50\nG52 X0 Y0 Z0\nG0 X0. Y0. Z50.\nG1 X10. F100.\nM30"
        )
        result = run_inline(text, "fanuc-gcode", {"dx": 1})
        self.assertFalse(refused(result), result["findings"])
        position = run_inline(text.replace("G52 X0 Y0 Z0", "G92 X0 Y0 Z0"), "fanuc-gcode", {"dx": 1})
        self.assertEqual(self.reasons(position), [(7, "coordinate-shift")])

    def test_a_fanuc_offset_number_without_its_code_is_no_unknown_word(self) -> None:
        # `G1 X10. D2`: D is the radius offset number of the compensation group; without the
        # code in the block it is read as that group's number (plan §7 #304).
        text = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G17 G90\nG0 X0. Y0.\nG1 X10. D2 F100.\nM30"
        result = run_inline(text, "fanuc-gcode", {"dx": 1})
        self.assertEqual([f["reason"] for f in result["findings"]], [])

    def test_a_lathe_program_with_roughing_and_thread_cycles_moves(self) -> None:
        # FANUC 30i lathe operator's manual: the parameters of G70 to G76 are depths, allowances,
        # counts, block numbers and feeds, no positions; the end points of G74 to G76 are axis
        # words and move; the profile blocks P to Q are ordinary moves (plan §7 #305).
        text = (
            "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG21 G18 G40\nG0 X100. Z5.\n"
            "G71 U2. R0.5\nG71 P100 Q200 U0.4 W0.1 F0.25\nN100 G0 X40.\nG1 Z-20. F0.1\nX60. Z-30.\nN200 X100.\n"
            "G70 P100 Q200\nG0 X40. Z5.\nG76 P011060 Q100 R0.05\nG76 X37.4 Z-18. P1300 Q400 F2.\nG0 X100. Z50.\nM30"
        )
        result = run_inline(text, "fanuc-lathe", {"dx": 2, "dz": -1})
        self.assertFalse(refused(result), result["findings"])
        lines = result["text"].split("\n")
        self.assertEqual(lines[4], "G71 P100 Q200 U0.4 W0.1 F0.25")
        self.assertEqual(lines[5], "N100 G0 X42.")
        self.assertEqual(lines[12], "G76 X39.4 Z-19. P1300 Q400 F2.")
        # the Sinumerik stock removal cycle names its contour (a subprogram or a part of the
        # program gEdit does not follow), so it is refused as a cycle with positions of its own
        sinumerik = (
            "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\nN10 G18 G90 DIAMON\nN20 G0 X100 Z5\n"
            'N30 CYCLE95("KONTUR", 2, 0.1, 0.2, , 0.3, 0.1, 0.1, 9, , , 0.5)\nN40 M30'
        )
        self.assertEqual(self.reasons(run_inline(sinumerik, "sinumerik", {"dx": 2})), [(4, "cycle-position")])


class Wave1IntegrationTest(unittest.TestCase):
    """The reasons the P4a fix batch B1 gave translate, worded in its message (plan §7)."""

    def test_every_reason_and_information_row_has_a_text(self) -> None:
        import importlib

        import _nc_geom

        module = importlib.import_module("translate")
        need = [k for k, (applies, _) in _nc_geom.REASONS.items() if "translate" in applies]
        self.assertEqual([k for k in need if k not in module.REASON_TEXT], [])
        info = [k for k, (applies, _) in _nc_geom.INFO.items() if "translate" in applies]
        self.assertEqual([k for k in info if k not in module.INFO_TEXT], [])
        # v1.2.0 (D4): the run's own refusals and information rows have their words and texts too.
        self.assertEqual([k for k in module.RUN_REASONS if k not in module.REASON_TEXT], [])
        self.assertEqual([k for k, (words, text) in module.OWN_INFO.items() if not (words[0] and words[1] and text)], [])

    def test_the_message_words_a_jump_and_an_unknown_pole(self) -> None:
        jump = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG90 G17 G21\nG0 X0. Y0. Z5.\nGOTO 10\nG91\nN10 G1 X5. F100.\nM30"
        result = run_inline(jump, "fanuc-gcode", {"dx": 1})
        self.assertTrue(refused(result))
        self.assertIn("1 block a jump or a loop may reach with other settings", result["message"])
        pole = "0 BEGIN PGM P MM\n1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE\n2 L X+0 Y+0 R0 FMAX\n3 LP PR+5 PA+30\n4 END PGM P MM"
        result = run_inline(pole, "heidenhain-klartext", {"dx": 1})
        self.assertIn((4, "pole-unknown"), [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"])
        self.assertIn("1 move around a pole that is not known", result["message"])



class V12FixTest(unittest.TestCase):
    """v1.2.0 NC fix round, batch NCF-B: one regression test per triage row, each failing
    without its fix."""

    HEAD = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)\nG90 G17 G21\n"

    def errors(self, result: Dict[str, Any]) -> List[Tuple[int, str]]:
        return [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"]

    def test_t011_nc18_an_incremental_cycle_after_a_g98_cycle_is_moved(self) -> None:
        text = self.HEAD + (
            "G0 X0. Y0. Z50.\nG98 G81 X10. Y10. Z-5. R2. F100.\nG80\n"
            "G91 G99 G81 X10. Y10. Z-5. R-48. F100.\nG80\nG0 Z10.\nG90 G0 Z50.\nM30"
        )
        result = run_inline(text, "fanuc-gcode", {"dx": 1, "dy": 2, "dz": 3})
        self.assertEqual(self.errors(result), [])
        lines = result["text"].split("\n")
        self.assertEqual(lines[3:10], [
            "G98 G81 X11. Y12. Z-2. R5. F100.",
            "G80",
            "G91 G99 G81 X10. Y10. Z-5. R-48. F100.",  # increments stay
            "G80",
            "G0 Z10.",
            "G90 G0 Z53.",
            "M30",
        ])
        self.assertEqual(lines[2], "G0 X1. Y2. Z53.")
        # The modal cycle's next hole and a G99 cycle leave the same kind of level.
        g99 = text.replace("G98 G81", "G99 G81").replace("G80\nG91 G99", "X20.\nG80\nG91 G99")
        self.assertEqual(self.errors(run_inline(g99, "fanuc-gcode", {"dz": 3})), [])

    def test_t011_still_refused_where_the_level_is_truly_not_known(self) -> None:
        cycle = "G98 G81 X10. Y10. Z-5. R2. F100.\nG80\nG91 G99 G81 X10. Y10. Z-5. R-48. F100.\nG80\nM30"
        # Z never written before the first cycle.
        never = self.HEAD + "G0 X0. Y0.\n" + cycle
        self.assertEqual(self.errors(run_inline(never, "fanuc-gcode", {"dz": 3})), [(6, "axis-unwritten")])
        # The first cycle started from a machine position.
        machine = self.HEAD + "G0 X0. Y0. Z50.\nG28 G91 Z0.\nG90 " + cycle
        self.assertEqual(self.errors(run_inline(machine, "fanuc-gcode", {"dz": 3})), [(7, "axis-unwritten")])
        # A jump may reach the cycle from the machine position.
        jump = self.HEAD + "G0 X0. Y0. Z50.\nG28 G91 Z0.\nG90\nGOTO 100\nG0 Z50.\nG98 G81 X10. Y10. Z-5. R2. F100.\nG80\nN100 G91 G99 G81 X10. Y10. Z-5. R-48. F100.\nG80\nM30"
        self.assertIn((10, "axis-unwritten"), self.errors(run_inline(jump, "fanuc-gcode", {"dz": 3})))
        # X never written while Z stands at a level: still refused, for X.
        x_never = self.HEAD + "G0 Y0. Z50.\nG98 G81 Y10. Z-5. R2. F100.\nG80\nG91 G99 G81 X10. Y10. Z-5. R-48. F100.\nG80\nM30"
        self.assertIn((6, "axis-unwritten"), self.errors(run_inline(x_never, "fanuc-gcode", {"dx": 1, "dz": 3})))


class D2FixTest(unittest.TestCase):
    """v1.2.0 NC fix round, batch D2 (path and geometry): NCR-3, NCR-9b/NCR-9 and NCR-10 under
    translate. Each test fails without its fix, except those marked as guards."""

    TOP = ["%", "O1000"]  # the line numbers of the review
    PASSES = ["G0 X60. Z2.", "G90 X50. Z-20. F0.2", "X48.", "X46.", "G0 X100. Z50.", "M30", "%"]
    SIN = ["N10 G17 G90 G0 X0 Y0 Z50", "N20 X10 Y10", "N30 %s", "N40 G91 G0 Z10", "N50 G90 G0 X0", "N60 M30"]

    def errors(self, result: Dict[str, Any]) -> List[Tuple[int, str]]:
        return [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"]

    def select(self, lines: List[str], start: int, end: int, params: Dict[str, Any], profile: str = "fanuc-lathe") -> Dict[str, Any]:
        program = self.TOP + list(lines)
        return run_inline("\n".join(program[start - 1 : end]), profile, params, preceding=program[: start - 1])

    # -- NCR-3: a selection among single passes, and its join -----------------------------------

    def test_ncr3_a_selection_that_starts_among_the_passes_is_refused(self) -> None:
        dz = {"dz": 5}
        self.assertIn((5, "selection-start"), self.errors(self.select(self.PASSES, 5, 6, dz)))
        self.assertIn((4, "selection-start"), self.errors(self.select(self.PASSES, 4, 6, dz)))
        facing = ["G0 X60. Z2.", "G94 X20. Z-5. F0.2", "Z-6.", "Z-7.", "G0 X100. Z50.", "M30", "%"]
        self.assertIn((5, "selection-start"), self.errors(self.select(facing, 5, 6, {"dz": 3})))

    def test_ncr3_the_join_writes_every_shifted_axis(self) -> None:
        # v1.2.0 D4 (the owner's decision of 2026-10-19): the join gets the shifted Z of the
        # lines above added where they wrote it (D4FixTest); one not known is still refused.
        lines = ["G0 X100. Z2.", "M98 P1000", "G0 X60.", "G90 X50. Z-20. F0.2", "X48.", "G0 X100. Z50.", "M30", "%"]
        self.assertIn((5, "selection-start"), self.errors(self.select(lines, 5, 8, {"dz": 5})))
        # A mill: a cut along X at a Z not known (after a cycle); a shift in X alone joins at its first X.
        mill = ["G90 G17 G0 X0 Y0 Z20.", "G81 X0 Y0 Z-5. R2. F100", "G80", "X10.", "Y10.", "G0 Z50.", "M30", "%"]
        self.assertEqual(self.errors(self.select(mill, 6, 7, {"dz": 5}, "fanuc-gcode")), [(6, "selection-start")])
        mill = ["G90 G17 G0 X0 Y0 Z20.", "G1 Z-5. F100", "X10.", "Y10.", "G0 Z50.", "M30", "%"]
        written = self.select(mill, 5, 6, {"dx": 5}, "fanuc-gcode")
        self.assertEqual((self.errors(written), written["text"]), ([], "X15.\nY10."))

    def test_ncr3_guard_a_first_move_at_a_machine_position_need_not_write_it(self) -> None:
        # After a return to the reference point Z stands where the whole run leaves it too.
        mill = ["G90 G17 G0 X0 Y0 Z50.", "G91 G28 Z0.", "G90", "G0 X10. Y10.", "G43 H1 Z5.", "G1 Z-1. F100", "M30", "%"]
        result = self.select(mill, 6, 8, {"dz": 5}, "fanuc-gcode")
        self.assertEqual((self.errors(result), result["text"]), ([], "G0 X10. Y10.\nG43 H1 Z10.\nG1 Z4. F100"))

    def test_ncr3_a_pass_that_takes_its_end_point_from_above_the_selection(self) -> None:
        lines = ["G0 X60. Z2.", "G90 X50. Z-20. F0.2", "G0 X60. Z2.", "G90 X48.", "G0 X100. Z50.", "M30", "%"]
        self.assertEqual(self.errors(self.select(lines, 5, 7, {"dz": 5})), [(6, "selection-start")])

    def test_ncr3_a_selection_that_ends_while_the_passes_are_in_force(self) -> None:
        self.assertEqual(self.errors(self.select(self.PASSES, 3, 5, {"dz": 5})), [(5, "selection-inside")])
        # Guard (n3e): with the rapids on both sides it is written.
        result = self.select(self.PASSES, 3, 7, {"dz": 5})
        self.assertEqual(self.errors(result), [])
        self.assertEqual(result["text"], "G0 X60. Z7.\nG90 X50. Z-15. F0.2\nX48.\nX46.\nG0 X100. Z55.")

    # -- NCR-9b and NCR-9: an empty level of a cycle on the tool axis --------------------------------

    def test_ncr9b_an_empty_level_on_the_tool_axis_refuses_a_z_shift(self) -> None:
        for cycle in ("CYCLE81(10,,2,-10)", "CYCLE81(,0,2,-10)", "CYCLE81(10,0,2)", "CYCLE83(10,0,2,-20,,,,2,1,1,1,0)"):
            with self.subTest(cycle=cycle):
                text = "\n".join(self.SIN).replace("N40 G91 G0 Z10", "N40 G0 X0") % cycle
                result = run_inline(text, "sinumerik-mill", {"dz": 5})
                self.assertEqual(self.errors(result), [(3, "cycle-level-empty")])
                self.assertEqual(result["text"], text)
        # The twin written: the depth comes from DPR.
        text = "\n".join(self.SIN).replace("N40 G91 G0 Z10", "N40 G0 X0") % "CYCLE81(10,0,2,,5)"
        result = run_inline(text, "sinumerik-mill", {"dz": 5})
        self.assertEqual(self.errors(result), [])
        self.assertIn("N30 CYCLE81(15,5,2,,5)", result["text"])
        # Guard: a shift in X only does not move the levels.
        result = run_inline("\n".join(self.SIN) % "CYCLE81(,0,2,-10)", "sinumerik-mill", {"dx": 5})
        self.assertEqual(self.errors(result), [])

    def test_ncr9_the_review_repro_is_refused(self) -> None:
        result = run_inline("\n".join(self.SIN) % "CYCLE81(,0,2,-10)", "sinumerik-mill", {"dz": 5})
        self.assertEqual(self.errors(result), [(3, "cycle-level-empty"), (4, "axis-unwritten")])
        mcall = ["N10 G17 G90 G0 X0 Y0 Z50", "N20 MCALL CYCLE81(,0,2,-10)", "N25 X10 Y10", "N27 MCALL", "N40 G91 G0 Z10", "N60 M30"]
        result = run_inline("\n".join(mcall), "sinumerik-mill", {"dz": 5})
        self.assertEqual(self.errors(result), [(2, "cycle-level-empty"), (5, "axis-unwritten")])

    def test_ncr9_written_levels_are_moved_with_the_increment_after(self) -> None:
        mcall = ["N10 G17 G90 G0 X0 Y0 Z50", "N20 MCALL CYCLE81(10,0,2,-10)", "N25 X10 Y10", "N26 X20", "N27 MCALL", "N40 G91 G0 Z10", "N50 G90 G0 X0", "N60 M30"]
        result = run_inline("\n".join(mcall), "sinumerik-mill", {"dz": 5})
        self.assertEqual(self.errors(result), [])
        self.assertIn("N20 MCALL CYCLE81(15,5,2,-5)", result["text"])
        klartext = [
            "0 BEGIN PGM T MM", "1 TOOL CALL 1 Z S3000", "2 L X+0 Y+0 Z+50 R0 FMAX", "3 CYCL DEF 200 DRILLING ~",
            "  Q200=+2 ;SET-UP CLEARANCE ~", "  Q201=-20 ;DEPTH ~", "  Q206=+150 ;FEED RATE FOR PLNGNG ~",
            "  Q202=+5 ;PLUNGING DEPTH ~", "  Q210=+0 ;DWELL TIME AT TOP ~", "  Q203=+0 ;SURFACE COORDINATE ~",
            "  Q204=+50 ;2ND SET-UP CLEARANCE ~", "  Q211=+0 ;DWELL TIME AT DEPTH ~", "  Q395=+0 ;DEPTH REFERENCE",
            "4 L X+10 Y+10 R0 FMAX M99", "5 L IZ+10 FMAX", "6 END PGM T MM",
        ]
        result = run_inline("\n".join(klartext), "heidenhain-klartext", {"dz": 5})
        self.assertEqual(self.errors(result), [])
        self.assertIn("  Q203=+5 ;SURFACE COORDINATE ~", result["text"])
        # Without its Q203 the definition gives no level: the increment after it is refused.
        without = [line for line in klartext if "Q203" not in line]
        self.assertIn((14, "axis-unwritten"), self.errors(run_inline("\n".join(without), "heidenhain-klartext", {"dz": 5})))

    # -- NCR-10: a tool offset write keeps the positions ---------------------------------------

    def test_ncr10_a_tool_offset_write_is_no_coordinate_setting(self) -> None:
        text = "%\nO1\nG90 G17 G0 X0. Y0. Z50.\n{}\nG91 G1 X10. F100\nG90 G0 Z100.\nM30\n%"
        result = run_inline(text.format("G10 L11 P1 R0.1"), "fanuc-gcode", {"dx": 1})
        self.assertEqual(self.errors(result), [])
        self.assertIn("G90 G17 G0 X1. Y0. Z50.", result["text"])
        for setting in ("G10 L2 P1 X10. Y0 Z0", "G10 L20 P1 X10.", "G10 L3 P1 R0.1", "G10 L50"):
            with self.subTest(setting=setting):
                self.assertIn((5, "axis-unwritten"), self.errors(run_inline(text.format(setting), "fanuc-gcode", {"dx": 1})))


class D4FixTest(unittest.TestCase):
    """v1.2.0 NC fix round, batch D4. The owner's decision of 2026-10-19: the first move of a
    selection that does not write a shifted axis gets that axis added, shifted, where the lines
    above wrote its position as a number (absolute mode only). A cycle that starts the selection
    while the tool axis stands at the level of the lines above is refused. Each test fails
    without its fix, except those marked as guards."""

    TOP = ["%", "O1000"]
    CAM = ["G21 G17 G90 G54", "G0 X0. Y0.", "G43 H1 Z50.", "G1 Z-1. F200.", "G0 Z50.", "G0 X10. Y10.", "G1 Z-2. F100.", "G0 Z50.", "M30", "%"]
    DRILL = ["G21 G17 G90 G54", "G0 X0. Y0. Z50.", "%s G81 X10. Y10. Z-5. R2. F100.", "X20.", "G80", "G0 Z50.", "M30", "%"]

    def findings(self, result: Dict[str, Any]) -> List[Tuple[int, str, str]]:
        return [(f["line"], f["severity"], f["reason"]) for f in result["findings"]]

    def select(self, lines: List[str], start: int, end: int, params: Dict[str, Any], profile: str = "fanuc-gcode") -> Dict[str, Any]:
        program = self.TOP + list(lines)
        return run_inline("\n".join(program[start - 1 : end]), profile, params, preceding=program[: start - 1])

    # -- item 1: the missing word is added ---------------------------------------------------------

    def test_the_cam_start_of_a_tool_section_gets_the_shifted_z(self) -> None:
        result = self.select(self.CAM, 8, 10, {"dz": 5})
        self.assertEqual(result["text"], "G0 X10. Y10. Z55.\nG1 Z3. F100.\nG0 Z55.")
        self.assertEqual(result["findings"], [
            {"line": 8, "severity": "info", "message": "Z55. added: the move started at the unmoved Z of the lines above.", "reason": "word-added"},
        ])
        self.assertTrue(result["message"].startswith("Moved by Z5: 3 words on 3 blocks, 1 word added to the first move of the selection."), result["message"])

    def test_the_cut_of_the_d2_review_gets_the_shifted_z(self) -> None:
        mill = ["G90 G17 G0 X0 Y0 Z20.", "G1 Z-5. F100", "X10.", "Y10.", "G0 Z50.", "M30", "%"]
        result = self.select(mill, 5, 6, {"dz": 5})
        self.assertEqual((self.findings(result), result["text"]), ([(5, "info", "word-added")], "X10. Z0.\nY10."))

    def test_the_x_only_lathe_join_gets_the_shifted_z_and_the_pass_after_it_runs_from_there(self) -> None:
        lathe = ["G0 X100. Z2.", "G0 X60.", "G90 X50. Z-20. F0.2", "X48.", "G0 X100. Z50.", "M30", "%"]
        result = self.select(lathe, 4, 7, {"dz": 5}, "fanuc-lathe")
        self.assertEqual(self.findings(result), [(4, "info", "word-added")])
        self.assertEqual(result["text"], "G0 X60. Z7.\nG90 X50. Z-15. F0.2\nX48.\nG0 X100. Z55.")

    def test_each_missing_axis_in_the_written_form_of_its_dialect(self) -> None:
        klartext = ["0 BEGIN PGM T MM", "1 TOOL CALL 1 Z S3000", "2 L X+0 Y+0 Z+50 R0 FMAX", "3 L X+10 Y+10 R0 FMAX", "4 L Z-2 F100", "5 END PGM T MM"]
        result = run_inline("\n".join(klartext[3:5]), "heidenhain-klartext", {"dz": 5}, preceding=klartext[:3])
        self.assertEqual(result["text"], "3 L X+10 Y+10 Z+55 R0 FMAX\n4 L Z+3 F100")
        sinumerik = ["N10 G17 G90 G0 X0 Y0 Z50", "N20 X10 Y10", "N30 G1 Z-2 F100", "N40 M30"]
        result = run_inline("\n".join(sinumerik[1:]), "sinumerik-mill", {"dx": 1, "dz": 5}, preceding=sinumerik[:1])
        self.assertEqual(result["text"], "N20 X11 Y10 Z55\nN30 G1 Z3 F100\nN40 M30")
        # A packed block stays packed; X goes in front of the word it is missing beside.
        packed = ["G21 G17 G90", "G0 X0. Y0. Z50.", "G0Z10.", "G1Z-1.F100", "M30"]
        result = self.select(packed, 5, 6, {"dx": 1, "dy": 2, "dz": 3})
        self.assertEqual(result["text"], "G0X1.Y2.Z13.\nG1Z2.F100")
        self.assertEqual(result["findings"][0]["message"], "X1. Y2. added: the move started at the unmoved X and Y of the lines above.")

    def test_a_round_trip_gives_every_value_back_and_the_added_word_the_unmoved_level(self) -> None:
        forward = self.select(self.CAM, 8, 10, {"dz": 5})
        program = self.TOP + self.CAM
        back = run_inline(forward["text"], "fanuc-gcode", {"dz": -5}, preceding=program[:7])
        self.assertEqual(back["text"], "G0 X10. Y10. Z50.\nG1 Z-2. F100.\nG0 Z50.")

    # -- item 1: what is still refused ---------------------------------------------------------------

    def test_a_z_that_is_not_known_is_still_refused(self) -> None:
        after_cycle = ["G21 G17 G90", "G0 X0. Y0. Z50.", "G81 X10. Y10. Z-5. R2. F100.", "G80", "G0 X30. Y30.", "G1 Z-1. F100", "M30"]
        result = self.select(after_cycle, 7, 8, {"dz": 1})
        self.assertEqual((self.findings(result), result["text"]), ([(7, "error", "selection-start")], "G0 X30. Y30.\nG1 Z-1. F100"))
        # A subprogram call above the selection may leave the tool anywhere, although the
        # tracker still holds the Z before it.
        after_call = ["G21 G17 G90", "G0 X0. Y0. Z50.", "M98 P1000", "G0 X30. Y30.", "M30"]
        self.assertEqual(self.findings(self.select(after_call, 6, 7, {"dz": 1})), [(6, "error", "selection-start")])
        klartext = ["0 BEGIN PGM T MM", "1 L X+0 Y+0 Z+50 R0 FMAX", "2 CALL LBL 1", "3 L X+10 Y+10 R0 FMAX", "4 END PGM T MM"]
        result = run_inline("\n".join(klartext[3:]), "heidenhain-klartext", {"dz": 5}, preceding=klartext[:3])
        self.assertEqual(self.findings(result), [(4, "error", "selection-start")])
        sinumerik = ["N10 G17 G90 G0 X0 Y0 Z50", "N20 L100", "N30 X10 Y10"]
        result = run_inline(sinumerik[2], "sinumerik-mill", {"dz": 5}, preceding=sinumerik[:2])
        self.assertEqual(self.findings(result), [(3, "error", "selection-start")])
        # Guard: a Z written again after the call is known.
        again = ["G21 G17 G90", "G0 X0. Y0. Z50.", "M98 P1000", "G0 Z20.", "G0 X30. Y30.", "M30"]
        self.assertEqual(self.select(again, 7, 8, {"dz": 1})["text"], "G0 X30. Y30. Z21.\nM30")

    def test_a_tool_change_or_an_offset_since_the_z_was_written_makes_it_not_known(self) -> None:
        # The change position is the machine's, and a work offset or a tool offset picked since
        # puts the same point at other coordinates: no word is added, as before D4. Above the
        # selection and in it before its first move alike.
        for between in ("T2 M6", "M6", "G55", "G49", "G43 H2", "H2"):
            with self.subTest(between=between):
                above = ["G21 G17 G90 G54", "G0 X0. Y0. Z50.", between, "G0 X10. Y10.", "M30"]
                self.assertEqual(self.findings(self.select(above, 6, 7, {"dz": 5})), [(6, "error", "selection-start")])
                inside = self.select(above, 5, 7, {"dz": 5})
                self.assertIn((6, "error", "selection-start"), self.findings(inside))
                self.assertNotIn("Z55.", inside["text"])
        sinumerik = ["N10 G17 G90 G54 G0 X0 Y0 Z50", "N20 T2 D1", "N30 M6", "N40 D2", "N50 X10 Y10"]
        for start in (2, 4, 5):
            with self.subTest(sinumerik=start):
                result = run_inline("\n".join(sinumerik[start - 1 :]), "sinumerik-mill", {"dz": 5}, preceding=sinumerik[: start - 1])
                self.assertEqual([r for r in self.findings(result) if r[2] == "selection-start"], [(5, "error", "selection-start")])
        klartext = ["0 BEGIN PGM T MM", "1 L X+0 Y+0 Z+50 R0 FMAX", "2 TOOL CALL 2 Z S3000", "3 L X+10 Y+10 R0 FMAX", "4 END PGM T MM"]
        result = run_inline("\n".join(klartext[3:]), "heidenhain-klartext", {"dz": 5}, preceding=klartext[:3])
        self.assertEqual(self.findings(result), [(4, "error", "selection-start")])
        lathe = ["G0 X100. Z50.", "T0202", "G0 X60.", "G1 Z-10. F0.2", "M30"]
        self.assertEqual(self.findings(self.select(lathe, 5, 7, {"dz": 5}, "fanuc-lathe")), [(5, "error", "selection-start")])
        # The tool change in the first move's own block.
        same = ["G21 G17 G90 G54", "G0 X0. Y0. Z50.", "G55 G0 X10. Y10.", "M30"]
        self.assertEqual(self.findings(self.select(same, 5, 6, {"dz": 5})), [(5, "error", "selection-start")])

    def test_guard_a_z_written_with_its_offset_or_a_radius_register_keeps_it_known(self) -> None:
        # `G43 H2 Z60.` writes Z under the new offset; `D1` of `G41` is a radius register.
        length = ["G21 G17 G90 G54", "G0 X0. Y0. Z50.", "G43 H2 Z60.", "G0 X10. Y10.", "M30"]
        self.assertEqual(self.select(length, 6, 7, {"dz": 5})["text"], "G0 X10. Y10. Z65.\nM30")
        radius = ["G21 G17 G90 G54", "G0 X0. Y0. Z50.", "G41 D1 G1 X5. F100", "G1 X10. Y10.", "M30"]
        self.assertEqual(self.select(radius, 6, 7, {"dz": 5})["text"], "G1 X10. Y10. Z55.\nM30")

    def test_guard_an_incremental_mode_is_still_refused(self) -> None:
        inc = ["G21 G17 G90 G54", "G0 X0. Y0. Z50.", "G91 G0 X10. Y10.", "G90 G1 Z-1. F100", "M30"]
        self.assertEqual(self.findings(self.select(inc, 5, 6, {"dz": 1})), [(5, "error", "selection-start")])
        # Absolute words in an incremental mode: an added Z would be an increment.
        sinumerik = ["N10 G17 G90 G0 X0 Y0 Z50", "N20 G91 X=AC(10) Y=AC(10)", "N30 G90 G1 Z-2 F100"]
        result = run_inline("\n".join(sinumerik[1:]), "sinumerik-mill", {"dz": 5}, preceding=sinumerik[:1])
        self.assertEqual(self.findings(result), [(2, "error", "selection-start")])

    def test_guard_a_diameter_word_is_not_added(self) -> None:
        lathe = ["G0 X100. Z2.", "G0 Z1.", "G1 X40. F0.2", "M30"]
        self.assertEqual(self.findings(self.select(lathe, 4, 5, {"dx": 1}, "fanuc-lathe")), [(4, "error", "selection-start")])

    def test_guard_the_other_refusals_of_d2_still_hold(self) -> None:
        arc = ["G21 G17 G90", "G0 X0. Y0. Z5.", "G1 Z-1. F100", "G2 X10. Y10. R10.", "M30"]
        self.assertEqual(self.findings(self.select(arc, 6, 7, {"dz": 1})), [(6, "error", "selection-start")])
        passes = ["G0 X60. Z2.", "G90 X50. Z-20. F0.2", "X48.", "X46.", "G0 X100. Z50.", "M30", "%"]
        self.assertIn((5, "error", "selection-start"), self.findings(self.select(passes, 5, 6, {"dz": 5}, "fanuc-lathe")))
        from_above = ["G0 X60. Z2.", "G90 X50. Z-20. F0.2", "G0 X60. Z2.", "G90 X48.", "G0 X100. Z50.", "M30", "%"]
        self.assertEqual(self.findings(self.select(from_above, 5, 7, {"dz": 5}, "fanuc-lathe")), [(6, "error", "selection-start")])

    def test_guard_no_word_is_added_in_a_run_that_refuses(self) -> None:
        cam = list(self.CAM)
        cam[6] = "G1 Z-2. F100. M98 P1000"
        result = self.select(cam, 8, 10, {"dz": 5})
        self.assertEqual([r for r in self.findings(result) if r[1] != "error"], [])
        self.assertEqual(result["text"], "G0 X10. Y10.\nG1 Z-2. F100. M98 P1000\nG0 Z50.")

    def test_a_move_to_a_machine_position_in_the_selection_needs_no_added_word(self) -> None:
        mill = ["G21 G17 G90", "G0 X0. Y0. Z50.", "G91 G28 Z0.", "G90", "G0 X10. Y10.", "G43 H1 Z5.", "M30"]
        result = self.select(mill, 5, 8, {"dz": 5})
        self.assertEqual((self.findings(result), result["text"]), ([(5, "info", "machine-position")], "G91 G28 Z0.\nG90\nG0 X10. Y10.\nG43 H1 Z10."))

    # -- item 2: a cycle at the start of a selection --------------------------------------------------

    def test_a_cycle_that_starts_at_the_level_of_the_lines_above_is_refused(self) -> None:
        for mode in ("G98", "G99", ""):
            with self.subTest(mode=mode):
                drill = [line % mode if "%s" in line else line for line in self.DRILL]
                result = self.select(drill, 5, 8, {"dz": 0.5})
                self.assertEqual(self.findings(result), [(5, "error", "selection-start")])
                self.assertIn("a drilling cycle (which moves to its hole at that level and, with G98, returns to it)", result["findings"][0]["message"])

    def test_a_cycle_after_a_move_that_got_its_z_added_starts_at_the_moved_level(self) -> None:
        drill = [line % "G98" if "%s" in line else line for line in self.DRILL]
        drill.insert(2, "G0 X10. Y10.")
        result = self.select(drill, 5, 9, {"dz": 0.5})
        self.assertEqual(self.findings(result), [(5, "info", "word-added")])
        self.assertEqual(result["text"], "G0 X10. Y10. Z50.5\nG98 G81 X10. Y10. Z-4.5 R2.5 F100.\nX20.\nG80\nG0 Z50.5")

    def test_guard_a_cycle_first_is_written_when_the_tool_axis_does_not_move(self) -> None:
        drill = [line % "G98" if "%s" in line else line for line in self.DRILL]
        result = self.select(drill, 5, 8, {"dy": 5})
        self.assertEqual((self.findings(result), result["text"].split("\n")[0]), ([], "G98 G81 X10. Y15. Z-5. R2. F100."))


class RefusedBlocksAreNotMovedTest(unittest.TestCase):
    """P4a fix batch B6 (CODE-1): a block refused for a reason that comes before every reason moving a word can give is listed
    with it and its words are not moved (the run writes nothing anyway)."""

    def run_in_process(self, text: str, params: Dict[str, Any]):
        import translate
        from tests.python.test_rotate import in_process

        calls: List[Any] = []
        real = translate.Run.moved

        def counting(self, role, op, units):  # type: ignore[no-untyped-def]
            calls.append(role.token.text)
            return real(self, role, op, units)

        translate.Run.moved = counting  # type: ignore[method-assign]
        try:
            result = in_process(translate, "fanuc-gcode", params, text)
        finally:
            translate.Run.moved = real  # type: ignore[method-assign]
        return result, calls

    def test_the_moves_under_a_frame_are_not_moved(self) -> None:
        text = "G21 G17 G90\nG68 X0. Y0. R30.\n" + "\n".join("G1 X%d. Y%d. F100." % (i, i + 1) for i in range(40)) + "\nG69\nM30"
        result, calls = self.run_in_process(text, {"dx": 1, "dy": 2, "dz": 0})
        self.assertEqual(calls, [])
        self.assertEqual(result["text"], text)
        self.assertEqual({f["reason"] for f in result["findings"]}, {"frame"})
        self.assertEqual(len(result["findings"]), 41)  # the G68 block and the 40 moves under it

    def test_the_words_of_a_block_refused_later_in_the_order_are_still_moved(self) -> None:
        # `word-unknown` comes after the reasons a moved word can give, so the block's words are looked at as before.
        text = "G21 G17 G90\nG0 X0. Y0.\nG1 X10. Y10. F100.\nG1 X20. Y20. A=1.\nM30"
        result, calls = self.run_in_process(text, {"dx": 1, "dy": 2, "dz": 0})
        self.assertIn("X20.", calls)

    def test_a_clean_program_moves_every_word_once_per_spelling(self) -> None:
        text = "G21 G17 G90\nG0 X0. Y0.\n" + "\n".join("G1 X10. Y%d. F100." % (i % 4) for i in range(40)) + "\nM30"
        result, calls = self.run_in_process(text, {"dx": 1, "dy": 2, "dz": 0})
        self.assertEqual(result["findings"], [])
        self.assertIn("Y2.", result["text"])


class LaterVersionTest(unittest.TestCase):
    """Wave Y, BL-NC-geometry: the later-version transforms under translate. Each test fails
    without its change."""

    KLARTEXT = ReviewFixTest.KLARTEXT

    def errors(self, result: Dict[str, Any]) -> List[Tuple[int, str]]:
        return [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"]

    def test_t021_every_call_at_a_position_moves_the_calls_z_and_keeps_q203(self) -> None:
        # TNC 640 cycle manual (2019, p.65): the tool-axis coordinate of CYCL CALL POS acts like a
        # further datum shift, so moving it moves the cycle once; Q203 stays.
        text = self.KLARTEXT.replace("6 L X+30 Y+10 R0 FMAX M99", "6 CYCL CALL POS X+30 Y+10 Z-2 FMAX")
        result = run_inline(text, "heidenhain-klartext", {"dx": 1, "dz": 1})
        self.assertEqual(self.errors(result), [])
        lines = result["text"].split("\n")
        self.assertIn("  Q203=+0 ;SURFACE COORDINATE", lines)
        self.assertIn("5 CYCL CALL POS X+11 Y+10 Z+1 FMAX", lines)
        self.assertIn("6 CYCL CALL POS X+31 Y+10 Z-1 FMAX", lines)
        self.assertIn("4 L Z+51 R0 FMAX", lines)

    def test_t021_one_other_call_keeps_the_refusal(self) -> None:
        # The golden b3-klartext-call-pos-z holds M99 and M89 calls; here one CYCL CALL.
        text = self.KLARTEXT.replace("6 L X+30 Y+10 R0 FMAX M99", "6 L X+30 Y+10 R0 FMAX\n66 CYCL CALL")
        self.assertEqual(self.errors(run_inline(text, "heidenhain-klartext", {"dz": 1})), [(4, "cycle-position"), (8, "cycle-position")])

    def test_t021_a_call_at_a_position_without_the_tool_axis_keeps_the_refusal(self) -> None:
        text = self.KLARTEXT.replace("6 L X+30 Y+10 R0 FMAX M99", "6 CYCL CALL POS X+30 Y+10 FMAX")
        found = self.errors(run_inline(text, "heidenhain-klartext", {"dz": 1}))
        self.assertEqual(found, [(4, "cycle-position"), (8, "cycle-position"), (9, "cycle-position")])

    def test_t021_a_selection_with_the_definition_and_its_calls(self) -> None:
        text = self.KLARTEXT.replace("6 L X+30 Y+10 R0 FMAX M99", "6 CYCL CALL POS X+30 Y+10 Z-2 FMAX")
        lines = text.split("\n")
        result = run_inline("\n".join(lines[3:9]), "heidenhain-klartext", {"dz": 1}, lines[:3])
        self.assertEqual(self.errors(result), [])
        self.assertIn("  Q203=+0 ;SURFACE COORDINATE", result["text"].split("\n"))

    def test_t019_cycle95_with_its_contour_between_labels_in_the_scope(self) -> None:
        # SINUMERIK cycles manual, CYCLE95: NPP names the contour, a subprogram or a section of
        # the program between two labels ("START:END"). The section in the run moves with it.
        lines = [
            "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE", "N10 G18 G90 G95 DIAMON", "N20 T1 D1",
            "N40 G0 X65 Z2", 'N50 CYCLE95("ANFANG:ENDE",2,0.1,0.2,0.1,0.3,0.25,0.1,9,0,0,0.5)', "N60 G0 X100 Z50", "N70 M30",
            "ANFANG:", "N80 G1 X20 Z0", "N90 Z-20", "ENDE:",
        ]
        text = "\n".join(lines)
        result = run_inline(text, "sinumerik", {"dz": -1})
        self.assertEqual(self.errors(result), [])
        self.assertIn("N80 G1 X20 Z-1", result["text"].split("\n"))
        # A contour in a subprogram stays refused.
        sub = text.replace('"ANFANG:ENDE"', '"KONTUR1"')
        self.assertEqual(self.errors(run_inline(sub, "sinumerik", {"dz": -1})), [(5, "cycle-position")])
        # A label that is not in the run, or one written twice.
        self.assertEqual(self.errors(run_inline(text.replace("ENDE:", "ENDX:"), "sinumerik", {"dz": -1})), [(5, "cycle-position")])
        self.assertEqual(self.errors(run_inline(text + "\nANFANG:", "sinumerik", {"dz": -1})), [(5, "cycle-position")])
        # A selection that holds the cycle and not its contour.
        found = self.errors(run_inline("\n".join(lines[3:7]), "sinumerik", {"dz": -1}, lines[:3]))
        self.assertIn((5, "cycle-position"), found)


class ContourNamedOutsideTest(unittest.TestCase):
    """Wave Y skeptic of BL-NC-geometry, D3: a contour between two labels moves with the cycle
    that names it only while no cycle outside the selection names the same labels (it would
    stay where it is and run the moved contour), and only when the lines below the selection
    are known. Each test fails without the fix, except those marked as guards."""

    # A roughing and a finishing CYCLE95 on one contour written after M30 (the skeptic's t019a).
    LINES = [
        "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE", "N10 G18 G90 G95 DIAMON", "N20 T1 D1",
        "N30 G96 S200 M3 LIMS=3000", "N40 G0 X65 Z2", 'N50 CYCLE95("ANFANG:ENDE",2,0.1,0.2,0.1,0.3,0.25,0.1,1,0,0,0.5)',
        "N60 G0 X100 Z50", "N65 T2 D1", "N66 G0 X65 Z2", 'N67 CYCLE95("ANFANG:ENDE",2,0.1,0.2,0.1,0.3,0.25,0.1,5,0,0,0.5)',
        "N68 G0 X100 Z50", "N70 M30", "ANFANG:", "N80 G1 X20 Z0", "N90 Z-20", "N100 X40 Z-30", "N110 X60", "ENDE:",
    ]
    # Lines 9-18: the finishing cycle and the contour.
    START = 9

    def errors(self, result: Dict[str, Any]) -> List[Tuple[int, str]]:
        return [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"]

    def finishing(self, lines: List[str], following: Optional[List[str]] = None) -> Dict[str, Any]:
        return run_inline("\n".join(lines[self.START - 1:]), "sinumerik", {"dz": -1}, lines[: self.START - 1], following)

    def without_roughing(self) -> List[str]:
        return [line if not line.startswith("N50 ") else "N50 G0 X70" for line in self.LINES]

    def test_a_cycle_above_the_selection_names_the_contour(self) -> None:
        result = self.finishing(self.LINES)
        self.assertEqual(self.errors(result), [(10, "cycle-position")])
        self.assertEqual(result["text"], "\n".join(self.LINES[self.START - 1:]))

    def test_guard_the_same_selection_without_the_cycle_above_moves(self) -> None:
        result = self.finishing(self.without_roughing())
        self.assertEqual(self.errors(result), [])
        self.assertIn("N80 G1 X20 Z-1", result["text"].split("\n"))

    def test_a_cycle_below_the_selection_names_the_contour(self) -> None:
        below = ['N200 CYCLE95("anfang : ende",2,0.1,0.2,0.1,0.3,0.25,0.1,5,0,0,0.5)']
        self.assertEqual(self.errors(self.finishing(self.without_roughing(), below)), [(10, "cycle-position")])

    def test_a_contour_call_below_names_the_labels_one_by_one(self) -> None:
        # A contour call of the cutting cycles names the start and the end label as two strings.
        below = ['N200 CYCLE62(,1,"ANFANG","ENDE")']
        self.assertEqual(self.errors(self.finishing(self.without_roughing(), below)), [(10, "cycle-position")])

    def test_without_the_lines_below_the_run_refuses(self) -> None:
        lines = self.without_roughing()
        context = helpers.effective_context("sinumerik", params={"dz": -1})
        context["input"] = {
            "scope": "selection", "startLine": self.START, "endLine": len(lines), "precedingLines": lines[: self.START - 1],
        }
        out = run_script(SCRIPT, stdin="\n".join(lines[self.START - 1:]), context=context)
        self.assertTrue(out.ok, out.stderr)
        self.assertEqual(self.errors(out.json()), [(10, "cycle-position")])

    def test_guard_both_cycles_and_the_contour_in_the_run(self) -> None:
        result = run_inline("\n".join(self.LINES), "sinumerik", {"dz": -1})
        self.assertEqual(self.errors(result), [])
        self.assertIn("N80 G1 X20 Z-1", result["text"].split("\n"))
        # A selection that holds both cycles and the contour moves them too.
        result = run_inline("\n".join(self.LINES[4:]), "sinumerik", {"dz": -1}, self.LINES[:4])
        self.assertEqual(self.errors(result), [])

    def test_guard_other_labels_outside_the_selection_do_not_refuse(self) -> None:
        below = ['N200 CYCLE95("START:STOP",2,0.1,0.2,0.1,0.3,0.25,0.1,5,0,0,0.5)', "START:", "N210 G1 X30 Z0", "STOP:"]
        self.assertEqual(self.errors(self.finishing(self.without_roughing(), below)), [])


class ExtraAxisRowTest(unittest.TestCase):
    """P4h fix round, Q-5 (plan section 6.10 rule 13): Translate leaves the words of a machine's
    linear extra axis as written, and says so in one information row per axis (no refusal), so a
    user whose AA runs along X sees that it did not move. A rotary extra axis gets no row (and,
    standing away from 0, refuses the run as C does: :class:`RotaryExtraAxisTest`)."""

    HEAD = ["; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE", "N10 G17 G90 G71 G54", "N20 T1 D1", "N30 M6"]

    def run_on(self, body: List[str], params: Dict[str, Any]) -> Dict[str, Any]:
        case = next(c for c in helpers.geometry_cases("translate") if c.name == "extra-axis-sinumerik-mill")
        context = golden_context(case)
        context["params"] = dict(params)
        lines = self.HEAD + body
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
        out = run_script(SCRIPT, stdin="\n".join(lines), context=context)
        self.assertTrue(out.ok, out.stderr)
        return out.json()

    @staticmethod
    def rows(result: Dict[str, Any]) -> List[Tuple[int, str, str]]:
        return [(f["line"], f["severity"], f["message"]) for f in result["findings"] if f["reason"] == "extra-axis"]

    def test_one_row_names_the_words_of_the_linear_extra_axis(self) -> None:
        result = self.run_on(["N40 G0 X0 Y0 Z50 AA0 QQ0", "N50 G1 X20 AA15.5 F200", "N60 G1 Y10 QQ90", "N70 M30"], {"dx": 1})
        self.assertEqual(result["text"].split("\n")[4:6], ["N40 G0 X1 Y0 Z50 AA0 QQ0", "N50 G1 X21 AA15.5 F200"])
        self.assertEqual(
            self.rows(result),
            [(5, "info", "AA0: AA is an extra axis of the machine, and Translate moves only X, Y and Z, so it left AA0 and AA15.5 as written. If AA moves along X, Y or Z on this machine, change them by hand.")],
        )
        self.assertIn("Left 2 words as written: 2 words of an extra axis of the machine.", result["message"])
        self.assertFalse(any(f["severity"] == "error" for f in result["findings"]))

    def test_one_word_and_many_words(self) -> None:
        one = self.run_on(["N40 G0 X0 Y0 Z50 AA=7", "N50 M30"], {"dz": 1})
        self.assertEqual([m for _, _, m in self.rows(one)], [
            "AA=7: AA is an extra axis of the machine, and Translate moves only X, Y and Z, so it left AA=7 as written. If AA moves along X, Y or Z on this machine, change it by hand."
        ])
        many = self.run_on(["N40 G0 X0 Y0 Z50"] + ["G1 X%d AA%d F100" % (i, i) for i in range(1, 9)] + ["M30"], {"dx": 1})
        rows = self.rows(many)
        self.assertEqual(len(rows), 1)
        self.assertIn("so it left AA1, AA2, AA3, AA4, AA5 and 3 more words as written", rows[0][2])

    def test_a_rotary_extra_axis_and_a_program_without_one_get_no_row(self) -> None:
        rotary = self.run_on(["N40 G0 X0 Y0 Z50 QQ0", "N50 M30"], {"dx": 1})
        self.assertFalse(refused(rotary), rotary["findings"])
        self.assertEqual(self.rows(rotary), [])
        result = self.run_on(["N40 G0 X0 Y0 Z50", "N50 M30"], {"dx": 1})
        self.assertEqual(self.rows(result), [])
        self.assertNotIn("extra axis", result["message"])

    def test_a_refused_run_lists_only_its_refusals(self) -> None:
        result = self.run_on(["N40 G0 X0 Y0 Z50 AA0", "N50 G1 X=R1 AA5 F100", "N60 M30"], {"dx": 1})
        self.assertTrue(refused(result))
        self.assertEqual(self.rows(result), [])

    def test_without_the_machine_no_word_is_an_extra_axis(self) -> None:
        lines = self.HEAD + ["N40 G0 X0 Y0 Z50 AA=7", "N50 M30"]
        result = run_inline("\n".join(lines), "sinumerik-mill", {"dx": 1})
        self.assertEqual(self.rows(result), [])


class RotaryExtraAxisTest(unittest.TestCase):
    """Round Y review WY-NC-2 (owner decision 2026-10-29): a rotary extra axis of the machine
    (``QQ``, listed as rotary) standing away from 0 stops Translate as A, B and C do: gEdit cannot
    know what it turns, so the X, Y and Z words under it are no longer positions in the part.
    Before the fix the whole run moved two words under ``QQ90``."""

    D = {"dx": 5, "dy": 0, "dz": 0}

    def test_the_whole_run_and_a_selection_under_qq90_are_refused(self) -> None:
        for rotary in ("QQ90", "C90"):
            result = run_extra_axes(SCRIPT, self.D, rotary)
            self.assertEqual(
                [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"],
                [(2, "rotary-turned"), (3, "rotary-turned")], rotary,
            )
            self.assertIn("N60 G1 X10 Y5 Z-2 F200", result["text"].split("\n"))
            result = run_extra_axes(SCRIPT, self.D, rotary, selection=(3, 3))
            self.assertEqual([(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"], [(3, "rotary-turned")])

    def test_at_zero_the_run_still_moves(self) -> None:
        result = run_extra_axes(SCRIPT, self.D, "QQ0")
        self.assertFalse(refused(result), result["findings"])
        self.assertEqual(result["text"].split("\n")[1:3], ["N50 G0 X5 Y0 Z50 QQ0", "N60 G1 X15 Y5 Z-2 F200"])


def preset_selection(profile_id: str, preset: str, program: List[str], start: int, end: int, below: bool = True) -> Dict[str, Any]:
    """Translate ``dz=-5`` of lines ``start`` to ``end`` (1-based) of ``program`` on a machine
    ``preset``, with the lines above and (``below``) the lines below."""
    context = helpers.effective_context(profile_id, preset=preset)
    context["params"] = {"dx": 0, "dy": 0, "dz": -5}
    context["input"] = {"scope": "selection", "startLine": start, "endLine": end, "precedingLines": program[: start - 1]}
    if below:
        context["input"]["followingLines"] = program[end:]
    out = run_script(SCRIPT, stdin="\n".join(program[start - 1 : end]), context=context)
    if not out.ok:
        raise AssertionError(out.stderr)
    return out.json()


class ContourPairTest(unittest.TestCase):
    """Round Y review WY-NC-4 (the rule of T019/D3 and of the Z mirror's D2, for Translate): a
    roughing or finishing cycle and the contour it names move together or not at all. Fanuc
    `G70`-`G73` name the contour by `P`/`Q` block numbers; the Okuma LAP `G85`-`G88` by the name of
    a `G81` ... `G80` shape. Before the fix each split selection below moved part of the pair."""

    FANUC = [
        "O1000 (WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", "G99 G0 X60. Z2. T0101", "G71 U2. R0.5",
        "G71 P10 Q20 U0.4 W0.1 F0.25", "N10 G0 X20.", "G1 Z-10. F0.1", "X40. Z-20.", "N20 X60.", "G0 X100. Z50.",
        "T0202", "G0 X60. Z2.", "G70 P10 Q20", "G0 X100. Z50.", "M30",
    ]
    OKUMA = [
        "O1000 (WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", "G90 G0 X100. Z50.",
        "G85 NLAP1 D2. F0.3 U0.4 W0.1", "G87 NLAP1", "G0 X100. Z50.", "NLAP1 G81", "G0 X20.", "G1 Z-10. F0.1",
        "X40. Z-20.", "G80", "M02",
    ]

    def fanuc(self, start: int, end: int, below: bool = True) -> Dict[str, Any]:
        return preset_selection("fanuc-lathe", "is-b", self.FANUC, start, end, below)

    def okuma(self, start: int, end: int, below: bool = True) -> Dict[str, Any]:
        return preset_selection("okuma-osp", "okuma-1mm", self.OKUMA, start, end, below)

    @staticmethod
    def errors(result: Dict[str, Any]) -> List[Tuple[int, str]]:
        return [(f["line"], f["reason"]) for f in result["findings"] if f["severity"] == "error"]

    def test_fanuc_the_finishing_cycle_without_its_contour(self) -> None:
        # Lines 10-13: G70 would rapid to N10 at the moved Z, into the roughed contour.
        result = self.fanuc(10, 13)
        self.assertEqual(self.errors(result), [(12, "contour-split")])
        self.assertEqual(result["text"], "\n".join(self.FANUC[9:13]))
        self.assertIn("only move together", result["findings"][0]["message"])

    def test_fanuc_the_roughing_cycle_without_its_contour(self) -> None:
        self.assertEqual(self.errors(self.fanuc(1, 4)), [(4, "contour-split")])

    def test_fanuc_the_contour_without_its_cycles(self) -> None:
        program = list(self.FANUC)
        program[4] = "N10 G0 X20. Z2."  # a first move with every axis: no selection-start
        result = preset_selection("fanuc-lathe", "is-b", program, 5, 8)
        self.assertEqual(self.errors(result), [(5, "contour-split")])
        # The roughing cycle and its contour, while the G70 below names the contour too.
        self.assertEqual(self.errors(self.fanuc(2, 9)), [(4, "contour-split"), (5, "contour-split")])

    def test_okuma_the_shape_without_its_calls(self) -> None:
        # The shape's first block gets no Z added (the LAP approach depends on it).
        result = self.okuma(6, 10)
        self.assertEqual(self.errors(result), [(6, "contour-split"), (7, "selection-start")])
        self.assertNotIn("word-added", [f["reason"] for f in result["findings"]])
        self.assertEqual(result["text"], "\n".join(self.OKUMA[5:10]))

    def test_okuma_the_calls_without_their_shape(self) -> None:
        self.assertEqual(self.errors(self.okuma(2, 5)), [(3, "contour-split"), (4, "contour-split")])
        self.assertEqual(self.errors(self.okuma(3, 4)), [(3, "selection-start"), (4, "contour-split")])

    def test_a_cycle_that_starts_at_the_unmoved_point(self) -> None:
        # The pair whole, but no move to the cycle's start point in the selection: the cycle
        # starts where the lines above left the tool, and N10 gets no Z added.
        result = self.fanuc(3, 14)
        self.assertEqual(self.errors(result), [(4, "selection-start")])
        self.assertIn("roughing or finishing cycle starts from that point", result["findings"][0]["message"])
        self.assertEqual(self.errors(self.okuma(3, 10)), [(3, "selection-start")])

    def test_without_the_lines_below_a_pair_is_refused(self) -> None:
        result = self.fanuc(2, 14, below=False)
        self.assertEqual(self.errors(result), [(4, "contour-split"), (5, "contour-split"), (12, "contour-split")])
        self.assertIn("lines below the selection were not available", result["findings"][0]["message"])
        self.assertEqual(self.errors(self.okuma(2, 10, below=False)), [(3, "contour-split"), (4, "contour-split"), (6, "contour-split")])

    def test_guards_the_whole_pair_and_the_whole_program_still_move(self) -> None:
        moved = self.fanuc(2, 14)
        self.assertFalse(refused(moved), moved["findings"])
        self.assertEqual(moved["text"].split("\n")[3:6], ["N10 G0 X20.", "G1 Z-15. F0.1", "X40. Z-25."])
        self.assertFalse(refused(self.okuma(2, 10)))
        # Lines between the pairs and lines above them touch no contour.
        self.assertFalse(refused(self.fanuc(9, 11)))
        self.assertFalse(refused(self.okuma(1, 2)))
        whole = run_text(SCRIPT, "fanuc-lathe", {"dz": -5}, "\n".join(self.FANUC), preset="is-b")
        self.assertFalse(refused(whole), whole["findings"])
        self.assertIn("G0 X60. Z-3.", whole["text"].split("\n"))
        whole = run_text(SCRIPT, "okuma-osp", {"dz": -5}, "\n".join(self.OKUMA), preset="okuma-1mm")
        self.assertFalse(refused(whole), whole["findings"])
        self.assertIn("X40. Z-25.", whole["text"].split("\n"))


if __name__ == "__main__":
    unittest.main()
