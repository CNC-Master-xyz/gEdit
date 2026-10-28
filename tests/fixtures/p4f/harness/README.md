# P4f harness fixtures (the check follows jumps)

Programs for the runtime scenario `p4f-flow` (`tests/runtime/scenarios/p4f-flow.js`). Every program here is synthetic:
written for gEdit by the project, not copied from a machine, a CAM system, a control manual or a customer program, and
not meant to run on a machine. Each carries the `WRITTEN FOR GEDIT` marker (line 1 or 2), uses LF endings and ends with
a newline; `tests/fixtures/**` is `-text`, so the bytes are the bytes the scenario reads. They are not under `nc/`, so
`tests/unit/fixtures.test.ts` does not walk them.

They are the programs of the goldens in `tests/fixtures/channels/flow/` (read by `src/lib/core/channels/flow.test.ts`),
one file per channel, so the running app reads them as a user's files: the file name finds the other channel, the open
documents give the jump lines and the flow, the report is the Results panel. The line of each golden is the line of the
file (1-based). The scenario holds each case to the golden's `after` reading; if a golden changes, the file here changes
with it.

| Files | Golden | Machine (built-in preset) | The check says |
|---|---|---|---|
| `sif_C1.MPF`, `sif_C2.MPF` | `sinumerik-if-block-goto` | `sinumerik/sinumerik-2channel-c` | `GOTOF L1` alone in an `IF R1==1 ... ENDIF` block (line 5) is not followed; `WAITM(2,1,2)` on channel 1 line 7 has no partner: **missing, Channel 1 line 7**. |
| `selse_C1.MPF`, `selse_C2.MPF` | `sinumerik-if-else-goto` | same | the jump (line 7) is in the `ELSE` part: not followed; **missing, Channel 1 line 9**. |
| `sover_C1.MPF`, `sover_C2.MPF` | `sinumerik-goto-over-if-block` | same | `GOTOF SKIP1` (line 4) outside every block jumps over the block that holds `WAITM(2,1,2)` (line 6): followed, channel 1 never runs mark 2; **missing, Channel 2 line 5** (it waits for mark 2 after mark 3). |
| `srep_C1.MPF`, `srep_C2.MPF` | `sinumerik-repeat-label` | same | `LAB1: ... REPEAT LAB1 P=2` (lines 3 to 6) runs its `WAITM(1,1,2)` three times, as channel 2 writes it: **no finding**. |
| `fgoto.P-1`, `fgoto.P-2` | `fanuc-goto-forward` | `fanuc-lathe/fanuc-2path` | `GOTO 50` alone in its block (line 6) jumps over `M902` (line 7): followed; **missing, Path 2 line 7**. |
| `fsub.P-1`, `fsub.P-2` | `fanuc-goto-into-subprogram` | same | `GOTO 100` (line 6) names an `N100` that is only in the subprogram `O3012` below `M30`: not followed; **missing, Path 1 line 7** (`M902`). |

Siemens names follow the preset's rule `<stem>_C<n>.MPF`, Fanuc names `<stem>.P-<n>` (`^(?<stem>.+)\.[A-Za-z]*-?(?<channel>\d{1,2})$`).
