"""No bundled script takes the name of a standard-library module (v1.2.0, P4.9).

The app runs every script, a user's own included, with the bundled scripts folder on
``PYTHONPATH`` (plan §7.10), and ``PYTHONPATH`` comes before the standard library on
``sys.path``. A bundled ``statistics.py`` therefore hid the standard library's ``statistics``
module from every script: ``import statistics; statistics.mean(...)`` failed with an
``AttributeError``. The time estimate is ``time_estimate.py`` for that reason.

``sys.stdlib_module_names`` exists from Python 3.10; on 3.9 the check is skipped.

Run: ``taskpolicy -b python3 -B -S -m unittest tests.python.test_script_names``.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from typing import List

from tests.python import helpers

STDLIB = getattr(sys, "stdlib_module_names", None)


def clashes(folder: Path) -> List[str]:
    """The ``*.py`` files of ``folder`` whose module name is a standard-library module's."""
    return sorted(path.name for path in folder.glob("*.py") if path.stem in STDLIB)


@unittest.skipIf(STDLIB is None, "sys.stdlib_module_names needs Python 3.10 or newer")
class ScriptNameTest(unittest.TestCase):
    def test_no_bundled_script_hides_a_standard_library_module(self):
        self.assertEqual(clashes(helpers.SCRIPTS_DIR), [])

    def test_the_check_finds_a_script_named_statistics(self):
        with tempfile.TemporaryDirectory(prefix="gedit-names-") as folder:
            for name in ("statistics.py", "time_estimate.py", "_nc_run.py"):
                (Path(folder) / name).write_text("# a script\n", encoding="utf-8")
            self.assertEqual(clashes(Path(folder)), ["statistics.py"])


if __name__ == "__main__":
    unittest.main()
