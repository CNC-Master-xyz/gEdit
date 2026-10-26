# P4c harness fixtures (typing help, bookmarks, ranges, insert file, print)

Programs for the runtime scenarios `p4-comfort`, `p4-comfort-names-1` and `p4-comfort-names-2`
(`tests/runtime/scenarios/p4-comfort.js`). Every program here is synthetic: written for gEdit by the project, not
copied from a machine, a CAM system, a control manual or a customer program, and not meant to run on a machine. Each
carries the `WRITTEN FOR GEDIT` marker (Klartext: in the comment block 1, or 20 in the file that is inserted), uses LF
endings and ends with a newline; `tests/fixtures/**` is `-text`, so the bytes are the bytes the scenarios read. They are
not under `nc/`, so `tests/unit/fixtures.test.ts` does not walk them. The scenario cannot run in `npm test`;
`tests/unit/p4cHarnessFixtures.test.ts` holds its expected texts (the typed texts of Auto Space, the programs after an
Enter, an insert and a range, the pages of the print) to what the core says for these files, so a changed fixture or a
changed rule fails there in seconds and not in the hosted run an hour later.

Line numbers below are the editor's: the program's lines, then one empty last line the final line break makes.

| File | Contents |
|---|---|
| `fanuc-edit.nc` | A Fanuc program of 10 lines: `%` (1), `O1001 (WRITTEN ...)` (2, no block number), `N100` (3), `N110 T1 M6` (4), a comment line (5), `N120` (6), `N125` (7), `N126` (8), `N130 M30` (9), `%` (10). Enter at the end of line 4 gives `N115 ` (the step reaches `N120`, so the number between; the comment line is passed over), at 6 `N122 `, at 9 `N140 ` (nothing numbered below); at 7 no number fits (`N125`, `N126`) and the status bar says so; at 5 (a comment) the editor's Enter. The program ends at line 9 (`M30`): Append File puts its lines before the closing `%` (line 10) and warns of the program end; Insert File at line 1, column 1 puts them below `%` and `O1001` (from line 3); Insert File after the closing `%` warns that it ends the tape. Block ranges: `N120` to `N126` are lines 6 to 8; line 11 is the empty last line. |
| `klartext-edit.h` | A Klartext program of 10 lines: `0 BEGIN PGM SHORT MM` (1), blocks 1 to 8, the block `5 L X+90 Y+10 RL ~` (6) continued by `  F400` (7, no number), `8 END PGM SHORT MM` (10). Enter at the end of line 4 (block 3) makes block 4 and renumbers the blocks below (the continuation line is not touched); Enter at line 6 (ends with `~`) is the editor's, silently; Enter at line 7 numbers after the whole block 5. Block 5 is lines 6 and 7. Insert File at line 5, column 1 puts the three blocks of `insert-klartext.h` in as blocks 4 to 6. |
| `insert-fanuc.nc` | Four lines for Insert File and Append File on a Fanuc program: a comment line and three numbered blocks (`N500`, `N510`, `N520`), no program end. The numbers are kept as they are. |
| `insert-klartext.h` | Three lines for a Klartext program: a comment block `20 ;` and two blocks `21` and `22`. Inserted in `klartext-edit.h` at line 5 they become 4, 5 and 6, and the five blocks below move up by three (eight changed blocks). Appended, they go before `END PGM` as 8, 9 and 10, and `END PGM` becomes 11 (four changed blocks). |
| `insert-fanuc-frame.nc` | A Fanuc file that is a program of its own between two lone `%` lines: `%`, `O2000`, a comment line, `%`. Insert File leaves the two `%` lines out (the status bar says so) and, at line 6 of `fanuc-edit.nc` where blocks of that program follow, warns that `O2000` starts a program in the middle of it. |
| `insert-klartext-end.h` | Three Klartext lines that end with `22 END PGM OTHER MM` (its line 3): Insert File refuses it, because the program would end before the blocks below. |
| `insert-klartext-tilde.h` | Two Klartext lines whose last one ends with `~`: Insert File refuses it, because the block below would become part of it. |
| `insert-klartext-second.h` | A file that starts with `0 BEGIN PGM OTHER MM`: Insert File refuses it, naming its line 1, because a Klartext program holds one program. |
| `print-demo.nc` | 150 lines for Print and Export as HTML: `%`, `O2001 (WRITTEN ...)`, a comment line with `<`, `&` and both kinds of quote (`(CHECK <B> & "Q" 'S')`, line 3), one 109-character comment (line 4: two rows at 9 points with line numbers, so one continuation row), blocks `N10` to `N1440`, `M30` (149), `%` (150). The editor has 151 lines (the empty last one). At 9 points a page is 58 rows (three pages for the 152 rows), at 12 points 43 (four pages). |

The scenario's inline programs: `TWO_PROGRAMS` (a Fanuc file of two programs, `O1` and `O2`, both with `N10` and `N20`; the insert of
section F goes into the second one at line 8, where nothing has ended), the 250-line program of section D (200 lines
carrying `(BM)`, 50 without) and the 6-line program of Bookmark All Matches (`G1`, `G0`, `g1`, `G01`, `M3`, `G1`).
