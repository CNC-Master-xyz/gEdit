# P4b harness fixtures

Material for the runtime scenarios of P4b ("Drilling cycles and time": `p4-machines`, `p4-cycles`, `p4-cycles-time` and section B and C
of `p4-perf`) and for the unit test that holds their helpers (`tests/unit/p4bHarness.test.ts`). The scenarios read their programs and
answers from the goldens of `tests/fixtures/scripts/{expand_cycles,statistics,program_checks}/`; what is here is only what a golden
cannot be.

Every program here is synthetic: written for gEdit by the project, not copied from a machine, a CAM system, a control manual or a
customer program, and not meant to run on a machine. Each carries the `WRITTEN FOR GEDIT` marker in its second line, uses LF endings
and ends with a newline (`tests/fixtures/**` is `-text`, so the bytes are the bytes the tests read).

| File | Contents |
|---|---|
| `drill-60.in.nc` | `drillProgram({ lines: 60 })` of `tests/runtime/scenarios/p4-cycles-common.js`, the program `p4-perf` section B expands at 300,000 lines, in its smallest useful size: four groups of twelve lines (a `G98 G81` block, a block that repeats it, `G80`, nine feed moves), eight holes, one filler line. |
| `drill-60.out.nc` | What `expand_cycles.py` writes for it with no machine and no form values (31 blocks for the 8 holes; the first hole is where the tool stands, so it takes three blocks and the other seven four). Recorded from the script, then checked by hand against the cycle of `expand_cycles/fanuc-g81-g98-g99`: rapid to the R plane, feed to the depth at the cycle's feed, rapid back to the initial level (`G98`), the lines of the program that are no cycle block unchanged. |

The unit test holds `checkDrillExpansion` (the oracle of `p4-perf` section B, which never reads a text the script wrote except to judge
it) to this pair: it accepts the recorded expansion and refuses a changed one (a hole not drilled, a wrong feed, a cycle left in, a line
of the program changed, an extra line).
