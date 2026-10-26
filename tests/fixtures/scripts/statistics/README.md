# Statistics and Time goldens (P4.9)

The goldens of `src-tauri/resources/scripts/time_estimate.py` ("Statistics and Time"; named
`statistics.py` in the plan until P4.9: a bundled script must not take the name of a
standard-library module, `tests/python/test_script_names.py`). The format is `../README.md`, "The
drilling and time goldens": each folder holds `input.nc`, `params.json` (the form of plan §6.4
rule 6 with `format: "csv"`), `case.json` (the profile; a `limits` member is put into
`machine.limits` as the app puts a valid limits block there), `expected.csv` (lengths to 0.01 mm,
times to 0.1 s; the first line is the header) and `envelope.json` (`message`, `findings`: the
blocks that are not estimated with their lines, the moves timed at the top feed, the form values a
time needs and does not have). Each case's computation by hand is its `README.md`.
`tests/python/test_statistics.py` runs every folder, with the newest Python and with the oldest
gEdit supports (3.9). Every program here is synthetic and carries the `WRITTEN FOR GEDIT` marker.

No case names a machine: a `case.json` with a top-level `machine` member would need an effective
profile written by `tests/unit/resolved.test.ts`. The rules that read the machine's number input
(a dwell in least time increments, a point-less feed) are tested in `test_statistics.py` with the
preset machines the generator already writes (`resolved/effective/<profile>/preset-<id>.json`).

| Case | Dialect | What it shows |
|---|---|---|
| `fanuc-mill-g81-g83` | Fanuc mill | a straight move, an arc, a helix, the top-feed clamp, `G4 X`, two tools, `G81` under `G98`, `G83` twice under `G99`, `G73`, straight rapids |
| `klartext-cycl-call` | Klartext | cycle 200 called twice with `CYCL CALL`, the dwell cycle 9, `M137`, rapids each axis at its own rate |
| `sinumerik-cycle83-g931` | Sinumerik mill | the travel time `G931` inside and above the top feed (T085), `G4 F` and `G4 S`, `CYCLE83` twice |
| `lathe-css` | Fanuc lathe | constant surface speed held by `G50` with the split, feed per revolution, rpm, a thread and a multi-pass thread not estimated |
| `fanuc-no-motion` | Fanuc mill | the form left empty: lengths and the feed time only; rapid, tool-change and total time "not set", one row per missing value |
| `fanuc-refused-cycles` | Fanuc mill | the cycle blocks the expansion refuses since the P4b fix round (`G86` under `M4`, `K0` with a position, more than 9999 repeats) not estimated with their reason; a `G82` dwell that cannot be read left out alone, its moves counted |
| `sinumerik-call-move-mcall` | Sinumerik mill | a cycle call in a block with its own move (the move first), `MCALL`, a feed and a speed alone under `MCALL` and a set-up clearance below 0 not estimated, named by the cycle in force |
