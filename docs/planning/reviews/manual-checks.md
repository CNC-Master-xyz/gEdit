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

## 9. The release's own checks

1. **Release checklist.** The boxes of the [release checklist](../../releases/checklist.md) that apply to v1.2.0 are ticked, or what is not ticked is written into the notes as a known limit. [ ]
2. **The phase checks.** Sections 7 and 8 above (P4a and P4e) are done. [ ]
