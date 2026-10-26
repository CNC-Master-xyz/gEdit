# Review: manual checks

What only a person on a real machine can see. The checks are grouped by platform first (the release bundles), then by feature. Each is a short procedure with the result to expect; tick the box when it came out as expected, and write down what did not.

Use the sample programs in `tests/fixtures/exit/` for the bundle checks: open them in gEdit first, not in another editor (they contain a BOM, CRLF, NUL bytes and Windows-1252 bytes on purpose). Use a copy of one of your own programs for the feature checks; never edit the original.

Sources: [TODO.md](../../../TODO.md) "Manual checks", [the plan, section 10 of Phase 4](../phase-4-implementation.md#10-manual-checks-for-the-owner) (P4a and P4e), and the [release checklist](../../releases/checklist.md) (v1.2.0 is the first release that gets the platform checks on all three systems).

## 1. macOS (the `.dmg`)

1. **Download and verify.** Download the `.dmg` of the draft release through a browser (so it is quarantined) and compare its hash with `SHA256SUMS` (`shasum -a 256 <file>`). Expect: the hash matches. [ ]
2. **Install and open.** Drag to Applications, then follow the Open Anyway step in the release notes. Expect: the app opens. [ ]
3. **Open, edit, undo.** Open a Fanuc and a Klartext sample; type a change, undo it, type it again. Expect: the right dialect in the status bar, the program map filled, the tab shows the file as modified. [ ]
4. **Byte-exact save.** Open a sample, save with no edit, hash the file. Expect: the same hash as before. [ ]
5. **Close guard.** With a modified tab, close the window, then press Cmd+Q, then Dock > Quit. Expect: gEdit asks each time; Cancel keeps it open, Discard closes. [ ]
6. **Log out and Force Quit.** Log out with an unsaved tab; Force Quit gEdit with an unsaved tab and start it again. Expect: the logout is stopped by the prompt (with only saved tabs nothing is interrupted); after the restart the recovery offer appears and the machine choice is back. [ ]
7. **Backup history and a read-only file.** Save a file twice and open its earlier versions; open a read-only file from a network share. Expect: the history lists the earlier copies; the read-only file opens and says it is read-only. [ ]
8. **Finder drop.** Drop files, a folder and a symlink onto the window. Expect: the files open, the folder is ignored with a message, the symlink opens its file. [ ]
9. **Open and Save dialogs.** In the Open dialog select an extensionless `O1234` and a `.tap` file; Save As with another name. Expect: both can be selected; no extension is forced on Save As. [ ]
10. **Function keys.** Press F1, F2, F7 and F9 with Fn on the laptop keyboard (also Mod+F7). Expect: each runs its command. [ ]
11. **Script with and without Python.** Tools tab, Built-in Scripts, Tool list on a sample (table in the Results panel); on an account with no Python 3.9 or newer, check the script commands are disabled with a message. Expect: both as described, the rest of gEdit works. [ ]
12. **Overlay scrollbars on the ribbon.** With overlay scrollbars on (System Settings > Appearance, Show scroll bars: When scrolling), narrow the window until the ribbon scrolls. Expect: the group names stay fully visible, the scrollbar below them. [ ]
13. **About.** Expect: the version of the tag. [ ]

## 2. Windows (the `.msi` or `-setup.exe`)

1. **Download and verify.** Compare the installer with `SHA256SUMS` (`certutil -hashfile <file> SHA256`). Expect: it matches. [ ]
2. **Install and start.** Run the installer and follow the unsigned-build step in the notes. On a machine with Smart App Control on, expect the installer to be blocked with no way past, as the notes say. [ ]
3. **Open, edit, byte-exact save, close guard.** As in the macOS list, items 3 to 5 (the close guard by the window's close button and by Ctrl+W). Expect the same results. [ ]
4. **Tabs by keyboard.** Ctrl+W and Ctrl+Tab. Expect: close the tab, switch tabs. [ ]
5. **Copy and paste.** Copy lines from gEdit and paste in another program and back; use Copy CSV on a result. Expect: the text arrives unchanged, the CSV opens in a spreadsheet. [ ]
6. **Drop from Explorer.** Drop a file and a folder onto the window. Expect: the file opens; the folder is ignored with a message. [ ]
7. **Log off with an unsaved tab.** Log off, sign in, start gEdit. Expect: the recovery offer for the unsaved tab. [ ]
8. **Script with Python.** Run Tool list from the Tools tab on a **release** build. Expect: the table appears and no console window flashes. [ ]
9. **Script without Python.** On a machine without Python, run any script. Expect: the commands are disabled with a message. With the Microsoft Store `python` alias only, expect "Python was not found" (the alias exits with 9009). [ ]
10. **Stop a script.** Start a script that runs a program, then Stop it, let another time out, and Quit gEdit during a third. Expect: the program the script started ends in each case (Job Object). [ ]
11. **AltGr layout (Swiss German).** Press Mod+Alt+S, O, C and A (A is the code inspector; Ctrl+Alt+A may be AltGr+A), and Mod+Alt+Left, Right and P from the ribbon. Expect: they work and AltGr characters (`@`, `[`, `{`) are left alone. [ ]
12. **Reserved device names.** In a folder, run `echo hi>COM0.txt` and `echo hi>LPT0.txt`. Expect: note whether Windows treats them as devices; gEdit's file-name rules should agree. [ ]
13. **Network paths.** Open the same file by a UNC path and by a mapped drive. Expect: one tab and one backup history for the file. [ ]
14. **Long paths.** Open a file whose path is longer than 260 characters. Expect: it opens and saves. [ ]
15. **Unplugged drive.** Open a file from a removable drive, unplug it, start gEdit. Expect: the backup sweep leaves that drive's histories alone. [ ]
16. **About.** Expect: the version of the tag. [ ]

## 3. Linux (the `.deb` or `.rpm`, or the `.AppImage`)

1. **Download and verify.** `sha256sum -c SHA256SUMS`. Expect: OK for the file you downloaded. [ ]
2. **AppImage.** Start the `.AppImage` on a current Ubuntu (FUSE 2 present, or installed as the notes say). Expect: it starts. [ ]
3. **Package.** Install the `.deb` (or `.rpm`); start `gedit-nc` from a terminal and *gEdit* from the application menu. Expect: both start gEdit; GNOME's own `gedit` is untouched. [ ]
4. **Open, edit, byte-exact save, close guard.** As in the macOS list, items 3 to 5. Expect the same results. [ ]
5. **Tabs, copy and paste, drop.** Ctrl+W, Ctrl+Tab, copy and paste (also Copy CSV), a drop from the file manager. Expect: as on Windows. [ ]
6. **Script with and without Python.** As on macOS, item 11. [ ]
7. **Log-off recovery.** Log out with an unsaved tab and start gEdit again. Expect: the recovery offer. [ ]
8. **Ctrl+Alt+Left and Right, Ctrl+Alt+A.** With a comparison open press Ctrl+Alt+Left/Right; press Ctrl+Alt+A. Expect: gEdit reacts; if the desktop switches workspace or rotates the screen instead, use the toolbar buttons and the command palette, and write it here. [ ]
9. **Package name (optional).** The package is called `g-edit`. Expect: you are content with it, or you say which name you want (for example `gedit-nc`) and whether the desktop entry keeps *gEdit*. [ ]
10. **About.** Expect: the version of the tag. [ ]

## 4. Template forms, Edit Cycle and the template manager

Plan: [Phase 3 section 10](../phase-3-implementation.md#10-manual-checks-for-the-owner). Work on a copy of a real program.

1. **Insert from the Insert tab and from completion.** Insert a template from the Insert tab; on an empty line type the start of a label and press `Tab`. Expect: the form shows a preview of the text; after OK, one undo step removes everything it wrote. [ ]
2. **Edit Cycle.** Put the cursor on a drilling cycle, Edit Cycle, change one value, OK. Expect: only that word changed. Open it again and confirm with no change. Expect: the block is byte for byte the same. [ ]
3. **New Template from Selection.** Select a few lines, make a template from them, save it. Open another program and insert it. Expect: the text arrives as written; then delete the template in the manager (it asks first). [ ]
4. **Close the manager with unsaved changes.** Change something, then close with the Close button, with a click outside the dialog and with the window's close. Expect: it asks first each time. [ ]
5. **Template content.** Reviewed on [templates.md](templates.md). [ ]

## 5. Your machines in gEdit

Plan: [P2 section 8.8](../phase-2-implementation.md#88-machine-parameters-per-profile-the-defaults-none-assumes).

1. **Each lathe.** Set the machine up ([machine facts](machine-facts.md)), then check one program with the machine and with "none": F7, the tool list, scale feed with a limit, renumber with `G71 P/Q`. Expect: the results match what the machine does; with "none" the status item shows the assumed marker. [ ]
2. **Okuma.** Set the UNIT parameter; open a real `.MIN`. Expect: one number checked against the machine is the same. [ ]
3. **Siemens.** Set `DIAMON` as the machine starts it; open a real `.MPF`. Expect: `X` is read as the control reads it. [ ]
4. **Documented defaults.** Read the defaults under "What gEdit assumes" in [Machines](../../user/machines.md#what-gedit-assumes-and-what-it-does-not-know). Expect: you confirm them or name the correction. [ ]

## 6. Decisions of bug-fix round 1 you may veto

[The record, section 2](../bugfix-round-1.md#2-owner-decisions-and-the-defaults-taken). Expect for each: you agree, or say what you want instead.

1. Earlier versions of a file on a stick, a share or another disk never expire, and the space limit keeps the newest copy of every file. [ ]
2. A save of a file whose size and time are unchanged still compares the content. [ ]
3. Convert Case keeps every program name and header as written. [ ]
4. The hover opens where Monaco puts it, over the ribbon near the top. [ ]

## 7. Translate, rotate and mirror (P4a)

Plan: [Phase 4 section 10](../phase-4-implementation.md#10-manual-checks-for-the-owner), P4a. Work on copies.

1. **A milling program.** Translate, rotate and mirror a copy of a real milling program. Run it in the machine's own simulation, or as a dry run above the part. Expect: the part is moved, turned and mirrored as asked; arcs and compensation side are right. [ ]
2. **A lathe program in X and Z.** With the machine chosen, translate the copy in X and Z. Check the diameter on the machine. Expect: X moves by the diameter amount you asked, not by half. [ ]
3. **Counter spindle.** Mirror a main-spindle lathe program in Z for the counter spindle and check it in the machine's simulation. Expect: the arcs, the compensation side and the tool nose direction in the offset are right. [ ]
4. **Refusal rows.** Run the same on a program with a frame or a subprogram call. Expect: the refusal rows say what stopped it and why; read them and confirm they are clear. [ ]

## 8. Side by side and the channel view (P4e)

Plan: [Phase 4 section 10](../phase-4-implementation.md#10-manual-checks-for-the-owner), P4e. Work on copies; use [Channels](../../user/channels.md).

1. **Open the channel view.** Open a two-turret program with sections, then the three-channel set with one file per channel, in the channel view. Expect: the channels are shown side by side and the wait codes are lined up. [ ]
2. **Scroll together.** Scroll one pane. Expect: the panes scroll together. [ ]
3. **One undo.** Edit in a pane, edit in another, press undo. Expect: it takes back the last edit wherever it was made. [ ]
4. **Refused typing.** In a pane, type a line after a section's end and in front of a section start. Expect: refused, the document unchanged. [ ]
5. **Unmatched wait.** Hover an unmatched wait. Expect: the hover says why it is unmatched. [ ]
6. **Merge back.** Merge a split back into one program. Expect: the same text as before the split, wait codes intact. [ ]
7. **Aligned compare.** Compare two re-posted programs in the aligned view; copy a change, a line and a word both ways, then undo. Expect: each copy lands where marked and each undo takes it back. [ ]
8. **Wait codes on a real program.** Run Check Wait Codes on a program that ran correctly. Expect: no finding. [ ]

## 9. Typing help and printing (P4c)

Plan: [Phase 4 section 10](../phase-4-implementation.md#10-manual-checks-for-the-owner), P4c; use [Editing comfort](../../user/editing.md). Work on copies. Do the typing check once; do the print checks on each of the three systems (macOS, Windows, Linux), each with a short program and with one of several pages.

1. **Typing help.** Switch on Auto Space and Automatic Block Number (Edit tab, *Typing*). Type a few blocks such as `G1X10.Y5.` and press Enter at the end of a block. Expect: a space in front of each new word, a new line that starts with the next block number, and one undo step takes back a typed letter with its space or a line break with its number. [ ]
2. **Print to paper.** Press `Cmd/Ctrl+P`, keep the defaults, choose a real printer. Expect: the print dialog of the system opens (no second window of gEdit on the page); the pages are portrait, nothing is cut at the right or bottom edge on A4 or on Letter, every page has the header with the name, the date and *Page 2 of 5*, and the line numbers are the program's line numbers. [ ]
3. **Print to PDF.** Print the same program to PDF from the print dialog. Expect: the same pages as on paper, in colour, the colours readable on white. [ ]
4. **Black only and a selection.** Print again with *Black only*, and with *The selected lines* after selecting some lines. Expect: no colour on the pages; only the selected lines, with their own line numbers. [ ]
5. **The chord in a form.** Open the print form, click in a text field and press `Cmd/Ctrl+P`. Expect: nothing prints from the form. [ ]
6. **Export as HTML.** Run Export as HTML, open the file in a browser and print it from there. Expect: the same pages, in colour, with no script. Say on which systems Print itself did not work. [ ]
7. **Too large.** Print a program of more than 20,000 lines. Expect: the refusal names the limit and says to print a selection. [ ]

## 10. Drilling cycles and time (P4b)

Plan: [Phase 4 section 10](../phase-4-implementation.md#10-manual-checks-for-the-owner), P4b. Work on copies. The printing checks of P4c are not here.

1. **Expand Drilling Cycles on a real machine program.** Expand the cycles of a real milling program (a copy), then run both the original and the expanded copy in the machine's own simulation, or as a dry run above the part. Expect: the tool makes the same holes, to the same depths, with the same pecks, dwells and return levels; the expanded program is longer but moves identically. Try one program per control you have (Fanuc, Klartext, Sinumerik). [ ]
2. **A refusal.** Run it on a program with a tapping cycle, or a `G98`/`G99` cycle with the return level not written. Expect: nothing changes, and the findings name each line and say why in plain words. [ ]
3. **Time estimate against a real cycle time.** Fill in the machine's Motion and limits, run Statistics and Time on a real program, and compare the total with the time the machine reports for a run at 100 % override. Expect: the estimate is **lower** than the machine's time and the message says it is a lower bound; the gap is explained by the listed blocks and by acceleration. If it is higher, write down the program and both times. [ ]
4. **Not set.** Run Statistics and Time on a machine whose Motion and limits are empty. Expect: lengths are given, times say *not set*, and the findings name the missing values. [ ]
5. **The limits checks.** Set a top spindle speed and a travel, then run Program checks on a program that goes above and outside them. Expect: a spindle speed limit warning, a travel error for a position in machine coordinates, one travel warning per axis when the positions in work coordinates span more than the travel (and none when they span less, however far from zero), none for a program inside the limits. On a lathe, check that the X travel you entered as a diameter is the one compared. [ ]
6. **Units of the peck values.** On a machine whose Motion data is in inches, expand a millimetre program with a `G83`. Expect: **Units of the peck values** is prefilled with the machine's units, the values are converted by 25.4 in the expansion, and the written moves match the pecks your control makes. [ ]
7. **`G86` and the spindle.** Expand a `G86` under `M3`, then under `M4`, then with no spindle code before it. Expect: the first is written out; the other two are refused (the manual does not say which way the spindle restarts, and with no direction in force there is none to restart in). The code is the check, not `M4` alone: any spindle code but `M3` refuses. Check on the machine which way it restarts after `G86` under `M4` ([machine facts](machine-facts.md)). [ ]
8. **`K0` with a position.** Run a Fanuc `G81 X… Y… K0` block on the control. Expect: gEdit refuses to expand it; note whether the control moves to the position or does nothing. [ ]
9. **`CYCL CALL POS` with an `F`.** Run `CYCL CALL POS X… Y… Z… F300` followed by a move without an `F`. Expect: the `F300` counts for the move to the position only; the next move runs at the feed in force before the call. [ ]
10. **`CYCLE83` with `_DAM` 0.** Expand a `CYCLE83` with `VARI=1` and `_DAM=0`, then with `_DAM` not written. Expect: every peck after the first as deep as the first would be (no reduction); compare the strokes on the machine. Kept as it is until you say otherwise. [ ]

## 11. Renumber and the references between programs (P4d)

Plan: [Phase 4 section 10](../phase-4-implementation.md#10-manual-checks-for-the-owner), P4d; use [Transformations](../../user/transformations.md#renumber-blocks). Work on copies; for the cross-file checks open two copies of a main program and a subprogram file in two tabs.

1. **Number every Nth block.** Renumber a copy of a program with **Number every Nth block** 5, on a program that has a `GOTO`. Expect: only every fifth block has a number, and the block the `GOTO` names keeps one and is rewritten with it. [ ]
2. **Fit the increment to the maximum.** Renumber with **Fit the increment to the maximum**: once with a maximum that leaves room, once with a maximum too small for the blocks, once with the **Maximum** empty. Expect: the first uses the largest whole increment that fits; the second writes nothing and the status bar says why; the third uses the dialect's maximum (99999 on Fanuc). [ ]
3. **A start text that is not there.** Set **Start at the line containing** to a text no line has. Expect: nothing is renumbered and the status bar says no line contains it. [ ]
4. **Two programs, `M98 P1000 Q30`.** Keep a main program with `M98 P1000 Q30` open next to the file that holds `O1000`; renumber `O1000`. Expect: the `Q30` is listed in Results with the *never rewrites* wording and is not marked to update. Check on the control that `M98 P1000 Q30` starts the subprogram at block 30, and say whether you want `Q` rewritten after all. [ ]
5. **`M99 P30` and Update References.** With a subprogram file and a main program open, renumber the main program, then run **Update References in Other Documents**. Expect: it asks once, writes the `M99 P`, and Undo in the subprogram file takes back that file only. [ ]
6. **Edit after the list.** Renumber, then type in the renumbered document and run **Update References in Other Documents**. Expect: nothing is written and the status bar says to undo your changes or the renumber. Undo your typing and run it again: it writes. [ ]
7. **A locked document.** Lock a listed document (Read-only) and run Update. Expect: nothing is written anywhere and the status bar says which document is locked. [ ]
8. **A second renumber.** Renumber document A, then renumber document B before updating. Expect: the status bar and a row in Results say that the references of A were not updated and are no longer listed. [ ]
9. **A local call.** In a program with `M98 Q30` and an `M99 P` inside the part from `N30` to the next `M99`, renumber. Expect: the `Q30` and the `P` are rewritten. Say whether your control runs `M98 Q30` as a call of its own blocks. [ ]
10. **An interrupt.** In a subprogram started by `M96 P2000`, renumber a program that holds an `M99 P`. Expect: the row says an interrupt starts the program and the `P` is left as written. [ ]
11. **A number twice.** Renumber a selection so that a new number is one that a line outside it already has. Expect: a warning that the number is on more than one block, with a row on each. [ ]

## 12. Review round X: tool direction, copies, templates

Plan: [Phase 4 section 10](../phase-4-implementation.md#10-manual-checks-for-the-owner), review round X. Work on copies.

1. **Tool direction under `G43.5`.** On a 5-axis program with `G43.5` (or `G41.6`, `G42.6`) and `I J K`, run Address Arithmetic with Multiply on `X` and `Y`. Expect: the `I J K` of the blocks under the mode stay as written, with a note; after `G49` or `G40` the same words in an arc scale. [ ]
2. **Rotate and Mirror under `G43.5`.** Run Rotate and Mirror on the same copy. Expect: both refuse, naming the `I J K` words; Translate works. [ ]
3. **Check Program under `G43.5`.** Run Program checks on it with an increment machine. Expect: no *Machine reading* rows for the `I J K` of the tool direction. [ ]
4. **A template from selection with `M99 P`.** Select lines with an `M99 P30` and a block `N30`, make a template. Expect: the `P30` stays as written and the draft says so. [ ]
5. **Contour lists.** Select a Klartext contour with `CYCL DEF 14.1 KONTURLABEL1/2` and its `LBL` blocks, make a template. Expect: the labels in the list stay as written, with the note. [ ]
6. **Copy between programs in other modes.** In the aligned view copy a line from a program that is in `G91` into one that has written no `G90` or `G91`. Expect: a warning after the copy that the mode is not known in the other program. Then copy between `G54.1 P1` and `G54.1 P2`: a warning that the work offsets differ. [ ]
7. **The channel view and a screen reader.** Open the channel view of a program with a wait that has no partner, with a screen reader on. Expect: it says the problem as the view opens, and says that all waits are lined up when you fix it. [ ]
8. **An Okuma six-digit `T`.** On an Okuma machine set to *Three-digit offsets*, open a program with `T010101`. Expect: it is not a tool change in the tool list, and Program checks warns about the word. Say whether that matches what your control does. [ ]
9. **Sinumerik milling cycles on a lathe.** With a Sinumerik turning program, run **Edit Cycle** on an empty line. Expect: `POCKET3`, `SLOT1` and the other milling cycles are offered; the turning cycles too. [ ]

## 13. The release's own checks

1. **Release checklist.** The boxes of the [release checklist](../../releases/checklist.md) that apply to v1.2.0 are ticked, or what is not ticked is written into the notes as a known limit. [ ]
2. **The phase checks.** Sections 7 to 12 above (P4a, P4e, P4c, P4b, P4d and review round X) are done. [ ]
