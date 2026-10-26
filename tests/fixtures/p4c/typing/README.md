# P4c typing fixtures (auto-space, automatic block number)

Programs and cases for `src/lib/core/nc/autoNumber.test.ts`, `autoSpace.test.ts`, `blockNumbering.test.ts` and
`src/lib/contrib/typing.test.ts` (P4.12, plan §6.5 rules 1–3 and 9). Every program here is synthetic:
written for gEdit by the project, not copied from a machine, a CAM system, a control manual or a customer
program, and not meant to run on a machine. Each carries the `WRITTEN FOR GEDIT` marker (Klartext: block 1,
after `BEGIN PGM`), uses LF endings and ends with a newline. They are not under `nc/`, so
`tests/unit/fixtures.test.ts` does not walk them.

| File | Contents |
|---|---|
| `klartext-plate.h` | A Klartext program of 14 lines: `BEGIN PGM` (block 0) on line 1, blocks 1–11 with a comment line without a number on line 6 and a block that continues on the next line (`~`, lines 10–11), `END PGM` (block 11) on line 14. |
| `fanuc-gaps.nc` | A Fanuc program with the gaps of rule 2: `N110`, a comment line, `N120` (the step would reach `N120`, so `N115`), `N120`/`N125` (the number between, `N122`), `N125`/`N126` (no gap), `N130 M30` (nothing numbered below: `N140`). |
| `autospace.json` | The goldens of rule 1 on the six built-in profiles: the text before the cursor, the letter typed, and whether a space goes in front of it. |
