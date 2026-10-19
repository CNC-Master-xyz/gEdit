"""Every golden of ``tests/fixtures/exit2/expected/`` that a Python script makes, rebuilt and compared
byte for byte, without the app.

Until now the runtime suite (``exit2-x1`` .. ``exit2-x12``, about 40 minutes of a macOS runner) was the
only check of these files, except for the lathe arithmetic one in ``test_exit2_lathe.py``. A change of
a script that moved a message, a finding or a number showed up a day later, in the Harness run on
``main``. This test runs the scripts on the same programs, with the same machines and parameters, and
compares what they make with the files, in the Python job of CI.

How a file is rebuilt:

* **The context is the app's.** The effective profile, code database and machine of a run are the
  ones ``tests/unit/resolved.test.ts`` records in ``resolved/effective/exit2.json`` (the program is
  detected as the app detects it, the machine is the golden's own ``machine`` member, chosen for the
  document, and with no machine the variants found in the program apply, as in the app). Python never
  merges a machine into a profile.
* **The parameters are the form's:** the defaults of the script's header, with the parameters the
  golden names laid over them.
* **A text golden** (``*.nc``, ``*.MIN``, ``*.MPF``) is the document after the run, in the program's
  own line ending (``fanuc-lathe-a.nc`` is CRLF), compared as bytes.
* **A JSON golden** is read, the members a script produces (``message``, ``findings``, ``report``,
  ``toolList``, ``scaleFeed``) are replaced by what the script made, and the whole file is written out
  the way the file is written and compared as bytes. The other members (``about``, ``input``,
  ``machine``, the TypeScript and app members) are the golden's own and are what the run starts from.

One sub-test per file; a file that is stale says which file, what made it and how to regenerate it.
A file this test does not rebuild is listed in ``SKIPPED`` with the reason; a new file in
``expected/`` that is neither covered nor listed fails ``test_every_golden_is_accounted_for``.
"""

from __future__ import annotations

import difflib
import json
import os
import re
import unittest
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from tests.python import helpers as H

EXIT2 = H.FIXTURES_DIR / "exit2"
EXPECTED = EXIT2 / "expected"

#: Set it to ``1`` to write what the scripts make into the files instead of failing. Every file that
#: changes then has to be read against its criterion (``tests/fixtures/exit2/README.md``) before it is
#: committed: a golden that was only regenerated proves nothing.
UPDATE_ENV = "GEDIT_UPDATE_EXIT2"

HOW = (
    "If the script change is intended: GEDIT_UPDATE_EXIT2=1 python3 -B -S -m unittest "
    "tests.python.test_exit2_goldens rewrites the file, then read the diff against its criterion in "
    "tests/fixtures/exit2/README.md (a golden made by the script it checks proves nothing). "
    "If the effective profile is the difference: UPDATE_RESOLVED=1 npx vitest run --project unit resolved."
)

# ---------------------------------------------------------------------------
# Not rebuilt here: made by the TypeScript side or by the app only
# ---------------------------------------------------------------------------

_BLOCKSKIP = "the block-skip transform of the editor (TypeScript); no Python script makes it"
_RENUMBER = "the renumber transform of the editor (TypeScript); no Python script makes it"
_SEARCH = "NC-aware search and replace of the editor (TypeScript); no Python script makes it"
_CHANNELS = "the channel service of the app (TypeScript): sections, waits, split and partners"
_APP = "what the app shows or stores (machines.json, the profiles page, hovers, the compare view); not a script's output"

#: file (relative to ``expected/``) -> why this test does not rebuild it. ``*.tools.json`` and
#: ``fanuc-lathe-b.under-a.json`` are covered for their ``toolList`` / ``scaleFeed`` members only; their
#: other members (tool lines, the program map, the variant sources, the hovers) are the app's.
SKIPPED: Dict[str, str] = {
    "checks-mill.blockskip.json": _BLOCKSKIP,
    "checks-mill.blockskip.nc": _BLOCKSKIP,
    "fanuc-lathe-a.hover.json": "hover texts of the editor (TypeScript)",
    "fanuc-lathe-a.renumber.nc": _RENUMBER,
    "fanuc-lathe-a.renumber.report.json": _RENUMBER,
    "machines.x11.json": _APP,
    "machines.x12.json": _APP,
    "replace-M8-M88.json": _SEARCH,
    "repost.review.diff": "the compare view of the editor (TypeScript)",
    "repost.review.json": "the compare view of the editor (TypeScript)",
    "search-M8.json": _SEARCH,
    "search-S-gt-2000.json": _SEARCH,
    "search-T1.json": _SEARCH,
    "search-a.replaced.nc": _SEARCH,
    "shop/part-17.renumber5.nc": _RENUMBER,
    "twin-broken.json": _CHANNELS,
    "twin-multi.check.json": _CHANNELS,
    "twin-single.check.json": _CHANNELS,
    "twin-single.lines.check.json": _CHANNELS,
    "twin-single.map.json": _CHANNELS,
    "twin-single.nav.json": _CHANNELS,
    "twin-single.split-1.nc": _CHANNELS,
    "twin-single.split-2.nc": _CHANNELS,
    "twin-single.tools.json": "tool list per channel: needs the channel service's context, which only the app builds",
    "user-profile.json": _APP,
}

# ---------------------------------------------------------------------------
# What a run is
# ---------------------------------------------------------------------------

#: The members of a JSON golden that a script produces, per kind of file. Everything else is the golden's.
_ENV_MEMBERS = ("message", "findings")


def form_defaults(script: Path) -> Dict[str, Any]:
    """The form's starting values: the ``default`` of every ``[[params]]`` of the script's header.

    The header is TOML inside ``# /// gedit`` .. ``# ///``; only ``id`` and ``default`` are read, and
    both are written the way JSON writes them (``"x"``, ``90``, ``true``, ``["X", "Z"]``). A parameter
    with no default is left out, as the form leaves it empty.
    """
    text = script.read_text(encoding="utf-8")
    header: List[str] = []
    inside = False
    for line in text.split("\n"):
        if not inside:
            inside = line.strip() == "# /// gedit"
            continue
        if line.strip() == "# ///":
            break
        header.append(line[2:] if line.startswith("# ") else line.lstrip("#"))
    params: Dict[str, Any] = {}
    current: Optional[str] = None
    for line in header:
        stripped = line.strip()
        if stripped == "[[params]]":
            current = None
            continue
        match = re.match(r"^id\s*=\s*(\".*\")\s*$", stripped)
        if match:
            current = json.loads(match.group(1))
            continue
        match = re.match(r"^default\s*=\s*(.+?)\s*$", stripped)
        if match and current is not None:
            params[current] = json.loads(match.group(1))
    return params


def _index() -> Dict[str, str]:
    return H._resolved("effective", "exit2")  # type: ignore[no-any-return]


def effective_run_context(program: str, machine: Optional[str], params: Dict[str, Any]) -> Dict[str, Any]:
    """The context the app gives a script that runs on ``program`` under ``machine`` (None: no machine)."""
    key = "%s|%s" % (program, machine if machine is not None else "none")
    name = _index().get(key)
    if not isinstance(name, str):
        raise AssertionError("no effective view for %s in resolved/effective/exit2.json; %s" % (key, H.UPDATE_RESOLVED))
    path = H.RESOLVED_DIR / name
    if not path.is_file():
        raise AssertionError("%s is missing; %s" % (name, H.UPDATE_RESOLVED))
    entry = H.load_json(path)
    context = H.make_context(params=params, profile=entry["profile"], codes=H.resolved_codes(entry["codes"]))
    context["machine"] = entry["machine"]
    return context


def program_of(name: str) -> Tuple[str, str]:
    """``(text with LF, line ending)`` of a program of the folder, as the document the app opens."""
    raw = (EXIT2 / name).read_bytes().decode("utf-8")
    eol = "\r\n" if "\r\n" in raw else "\n"
    return raw.replace("\r\n", "\n"), eol


def run_script(script: str, program: str, machine: Optional[str], params: Dict[str, Any]) -> Dict[str, Any]:
    """Runs a bundled script (``scale_feed.py``) or one of the folder's (``scripts/report_modal.py``)."""
    user = script.startswith("scripts/")
    path = EXIT2 / script if user else H.SCRIPTS_DIR / script
    merged = form_defaults(path)
    merged.update(params)
    context = effective_run_context(program, machine, merged)
    text, _eol = program_of(program)
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    context["document"]["name"] = program
    context["input"]["endLine"] = len(lines)
    out = H.run_script(str(path) if user else script, stdin=text, context=context)
    if out.returncode != 0:
        raise AssertionError("%s on %s exited with %s:\n%s" % (script, program, out.returncode, out.stderr))
    return out.json()  # type: ignore[no-any-return]


def dump_json(value: Any, like: str) -> str:
    """JSON written the way the goldens are: two-space indent, one final newline, ASCII escapes only
    where the file being compared has them."""
    return json.dumps(value, indent=2, ensure_ascii="\\u" in like) + "\n"


def _text_of(envelope: Dict[str, Any], eol: str) -> str:
    return str(envelope["text"]).replace("\n", eol)


# ---------------------------------------------------------------------------
# The cases
# ---------------------------------------------------------------------------

Rebuild = Callable[[str], str]


class Case:
    """One file under ``expected/``, what makes it and how it is rebuilt."""

    def __init__(self, file: str, made_by: str, rebuild: Rebuild) -> None:
        self.file = file
        self.made_by = made_by
        self.rebuild = rebuild


def _golden(name: str) -> Tuple[Dict[str, Any], str]:
    raw = (EXPECTED / name).read_bytes().decode("utf-8")
    return json.loads(raw), raw


def _machine_name(golden: Dict[str, Any], key: str = "machine") -> Optional[str]:
    """A golden's machine as a name: ``None`` for "none" (the member is ``null`` or missing)."""
    machine = golden.get(key)
    if isinstance(machine, dict):
        return str(machine["name"])
    if isinstance(machine, str):
        return machine
    return None


def replace_cases(root: str, program: str, script: str, runs: Optional[Dict[str, Optional[str]]] = None) -> List[Case]:
    """A replace script's pair: the saved document and ``<root>.report.json``.

    ``runs`` is for a report that holds several runs of one script (``decimal-lathe.feed90.report.json``:
    ``{"is-b": ..., "calc": ..., "none": ...}`` with the machine of each); then the document is
    the same under all of them, which is part of what the golden says.
    """
    ext = Path(program).suffix
    text_file = "%s%s" % (root, ext)
    report_file = "%s.report.json" % root

    def envelopes() -> Dict[str, Dict[str, Any]]:
        golden, _raw = _golden(report_file)
        if runs is None:
            return {"": run_script(script, program, _machine_name(golden), golden.get("params", {}))}
        return {key: run_script(script, program, machine, golden.get("params", {})) for key, machine in runs.items()}

    def text(_raw_unused: str) -> str:
        _src, eol = program_of(program)
        made = envelopes()
        texts = {key: _text_of(env, eol) for key, env in made.items()}
        if len(set(texts.values())) != 1:
            raise AssertionError("the runs of %s do not leave the same document: %s" % (script, sorted(texts)))
        return next(iter(texts.values()))

    def report(raw: str) -> str:
        golden, _ = _golden(report_file)
        made = envelopes()
        if runs is None:
            env = made[""]
            rebuilt = dict(golden)
            for member in _ENV_MEMBERS:
                if member in env:
                    rebuilt[member] = env[member]
        else:
            rebuilt = dict(golden)
            rebuilt["runs"] = {
                key: dict(golden["runs"][key], message=made[key]["message"], findings=made[key]["findings"]) for key in runs
            }
        return dump_json(rebuilt, raw)

    return [
        Case(text_file, "%s on %s, the document after the run" % (script, program), text),
        Case(report_file, "%s on %s, its summary and findings" % (script, program), report),
    ]


def report_case(file: str, script: str, member: str = "report") -> Case:
    """A golden whose ``report`` member is the report a script writes (``input`` names the program)."""

    def rebuild(raw: str) -> str:
        golden = json.loads(raw)
        env = run_script(script, golden["input"], _machine_name(golden), {})
        env.pop("type", None)
        rebuilt = dict(golden)
        rebuilt[member] = env
        return dump_json(rebuilt, raw)

    return Case(file, "%s on the program its \"input\" names" % script, rebuild)


def tools_case(file: str) -> Case:
    """``toolList`` of a ``*.tools.json`` (and of ``fanuc-lathe-b.under-a.json``) is the report of ``tool_list.py``."""

    def rebuild(raw: str) -> str:
        golden = json.loads(raw)
        env = run_script("tool_list.py", golden["input"], _machine_name(golden), {})
        env.pop("type", None)
        rebuilt = dict(golden)
        rebuilt["toolList"] = env
        return dump_json(rebuilt, raw)

    return Case(file, "tool_list.py on the program its \"input\" names (member toolList)", rebuild)


def under_a_case() -> Case:
    """X11 (e): ``toolList`` and ``scaleFeed`` of a system B program under a machine that says system A."""
    file = "fanuc-lathe-b.under-a.json"

    def rebuild(raw: str) -> str:
        golden = json.loads(raw)
        program = golden["input"]
        machine = _machine_name(golden)
        tools = run_script("tool_list.py", program, machine, {})
        tools.pop("type", None)
        feed = run_script("scale_feed.py", program, machine, golden["scaleFeed"].get("params", {}))
        before, _eol = program_of(program)
        after = str(feed["text"])
        changed = [
            {"line": number, "before": was, "after": now}
            for number, (was, now) in enumerate(zip(before.split("\n"), after.split("\n")), 1)
            if was != now
        ]
        rebuilt = dict(golden)
        rebuilt["toolList"] = tools
        scale = dict(golden["scaleFeed"])
        scale["message"] = feed["message"]
        scale["findings"] = feed["findings"]
        scale["changedLines"] = changed
        rebuilt["scaleFeed"] = scale
        return dump_json(rebuilt, raw)

    return Case(file, "tool_list.py and scale_feed.py on fanuc-lathe-b.nc under machine \"X11 Lathe A\" (members toolList, scaleFeed)", rebuild)


def all_cases() -> List[Case]:
    cases: List[Case] = []
    # X8: address arithmetic on the lathe program (no machine), after B1 intB and P4a.
    cases += replace_cases("checks-lathe.arith-z-0.5.none", "checks-lathe.nc", "address_arithmetic.py")
    # X11 (c): address arithmetic and scale feed on decimal-lathe.nc under three machine choices.
    for key in ("none", "is-b", "calc"):
        cases += replace_cases("decimal-lathe.arith-z-0.5.%s" % key, "decimal-lathe.nc", "address_arithmetic.py")
    cases += replace_cases("decimal-lathe.feed90", "decimal-lathe.nc", "scale_feed.py", {"is-b": "Lathe IS-B", "calc": "Lathe calc", "none": None})
    # X1, X2: scale feed and scale speed on the lathe programs, no machine.
    cases += replace_cases("fanuc-lathe-a.feed90", "fanuc-lathe-a.nc", "scale_feed.py")
    cases += replace_cases("fanuc-lathe-a.speed110", "fanuc-lathe-a.nc", "scale_speed.py")
    cases += replace_cases("fanuc-lathe-b.feed90", "fanuc-lathe-b.nc", "scale_feed.py")
    cases += replace_cases("okuma-lathe.feed90", "okuma-lathe.MIN", "scale_feed.py")
    cases += replace_cases("sinumerik-lathe.feed90", "sinumerik-lathe.MPF", "scale_feed.py")
    cases += replace_cases("sinumerik-lathe.speed110", "sinumerik-lathe.MPF", "scale_speed.py")
    # X8 and X11 (c): the bundled report scripts on the check programs.
    for name in sorted(p.name for p in EXPECTED.glob("*.json")):
        if re.match(r"^checks-[a-z]+\.findings\..*\.json$", name) or name.startswith("decimal-lathe.checks."):
            cases.append(report_case(name, "program_checks.py"))
        elif re.match(r"^checks-[a-z]+\.extents\..*\.json$", name):
            cases.append(report_case(name, "extents.py"))
        elif name.startswith("machine-params."):
            cases.append(report_case(name, "scripts/report_machine_params.py"))
    cases.append(report_case("sinumerik-lathe.modal.json", "scripts/report_modal.py"))
    # X1, X2: the tool list on each program's own golden.
    for name in ("fanuc-lathe-a.tools.json", "fanuc-lathe-b.tools.json", "okuma-lathe.tools.json", "sinumerik-lathe.tools.json"):
        cases.append(tools_case(name))
    cases.append(under_a_case())
    return cases


def expected_files() -> List[str]:
    return sorted(p.relative_to(EXPECTED).as_posix() for p in EXPECTED.rglob("*") if p.is_file())


def _diff(got: str, want: str, name: str) -> str:
    lines = list(difflib.unified_diff(want.split("\n"), got.split("\n"), "expected/%s (committed)" % name, "what the script makes", lineterm="", n=1))
    return "\n".join(lines[:60]) + ("\n... (%d more diff lines)" % (len(lines) - 60) if len(lines) > 60 else "")


class TestExit2Goldens(unittest.TestCase):
    maxDiff = None

    def test_every_golden_is_accounted_for(self) -> None:
        covered = {case.file for case in all_cases()}
        files = set(expected_files())
        self.assertEqual(sorted(covered & set(SKIPPED)), [], "a file is both rebuilt and skipped")
        self.assertEqual(
            sorted(files - covered - set(SKIPPED)),
            [],
            "new file(s) in tests/fixtures/exit2/expected/ that test_exit2_goldens.py neither rebuilds nor lists in SKIPPED with a reason",
        )
        self.assertEqual(sorted((covered | set(SKIPPED)) - files), [], "listed here but not in tests/fixtures/exit2/expected/")

    def test_the_form_defaults_are_read_from_the_script_header(self) -> None:
        self.assertEqual(form_defaults(H.SCRIPTS_DIR / "scale_feed.py").get("percent"), 100)
        self.assertEqual(form_defaults(H.SCRIPTS_DIR / "scale_speed.py")["decimals"], "0")

    def test_every_rebuildable_golden_matches_what_its_script_makes(self) -> None:
        update = os.environ.get(UPDATE_ENV) == "1"
        for case in all_cases():
            with self.subTest(file=case.file):
                path = EXPECTED / case.file
                self.assertTrue(path.is_file(), "tests/fixtures/exit2/expected/%s does not exist" % case.file)
                raw = path.read_bytes().decode("utf-8")
                got = case.rebuild(raw)
                if got == raw:
                    continue
                if update:
                    path.write_bytes(got.encode("utf-8"))
                    continue
                self.fail(
                    "tests/fixtures/exit2/expected/%s is not what %s makes.\n%s\n\n%s"
                    % (case.file, case.made_by, _diff(got, raw, case.file), HOW)
                )


if __name__ == "__main__":
    unittest.main()
