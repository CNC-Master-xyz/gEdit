# P4e fixtures (side by side)

Programs for the runtime scenarios `p4-channels` (and the merge half of it). Every program here
is synthetic: written for gEdit by the project, not copied from a machine, a CAM system, a control
manual or a customer program, and not meant to run on a machine. Each carries the `WRITTEN FOR GEDIT`
marker in its first line, uses LF endings and ends with a newline; `tests/fixtures/**` is `-text`, so
the bytes are the bytes the scenarios read. They are not under `nc/`, so `tests/unit/fixtures.test.ts`
does not walk them; `p4-channels` checks the line numbers below before it relies on them.

The waits are the owner's rule of 2026-10-17 (plan `docs/planning/phase-4-implementation.md` §9,
"Wait codes across channels"): `P` lists the channels as digits, `M901P12` meets in channels 1 and 2
only, `M910P123` in all three.
The twin program's machine declares two channels, so its wait for every channel is `M910P12` (`P123` would
name a channel 3 the machine does not have; that wait stays unmatched).

## `channels/`

| File | Contents |
|---|---|
| `twin-sections.nc` | Two channels in one file, read with the channel block of `tests/fixtures/channels/resolve/c10-alternating.json` (a section starts on `O1xxx` / `O2xxx`, ends on `M30`). 206 lines. Header lines 1 to 3. Channel 1: lines 4 to 100 (`O1001`), `M901P12` on line 9, `M910P12` on 60, `M920P12` on 80 (no partner in channel 2 on purpose). Channel 2: lines 101 to 205 (`O2001`), `M901P12` on 103 (pane line 6), `M910P12` on 167 (pane line 70). Line 206 (`%`) and the empty last line of the editor's text (207) are in no channel. In the channel view the panes hold 100 and 108 lines; the alignment adds filler zones after pane 1 line 59 (13 lines), after pane 2 line 5 (3 lines) and after pane 2 line 108 (2 lines); 4 of 5 waits line up, `M920P12` has no partner. |
| `threepath.NC1`, `threepath.NC2`, `threepath.NC3` | Three paths, one file each, the path number at the end of the extension, read with the built-in preset `fanuc-lathe/fanuc-3path-digits`. Path 1 (22 lines): `M901P12` on 9, `M910P123` on 15. Path 2 (24 lines): `M901P12` on 7, `M910P123` on 18. Path 3 (20 lines): `M910P123` on 12, `M920P13` on 16 (path 1 has no `M920P13`, so it is unmatched). In the channel view the alignment adds filler zones after line 14 (5 lines) and 23 (1) in path 1, after 6 (2) and 25 (2) in path 2 and after 11 (8) in path 3 (the editor's text also holds the empty last line, so each path counts one line more than the file has); 5 of 6 waits line up. |
