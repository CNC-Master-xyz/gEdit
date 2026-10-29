# The check follows jumps: goldens (P4.32)

Written for gEdit: every program here is synthetic, written from the jump and loop forms of
the control manuals (plan section 6.8.7 names them; the manual references are in the P4.32
report) and the channel presets of the built-in profiles. None was copied from a machine, a
CAM system, a manual or a customer program, and none is meant to run on a machine. Each
program carries the `WRITTEN FOR GEDIT` comment.

Read by `src/lib/core/channels/flow.test.ts`. Each golden runs its program through the
wait-code check twice, the way `channels.check` hands it the inputs:

- `before`: with the jump lines only (`computeJumpLines`), the reading up to v1.2.0;
- `after`: with the jump lines and the flow (`computeFlow`), the reading of P4.32.

```json
{ "comment": "…", "description": "what the case shows and why the after reading is right",
  "rule": "F1 F2", "profile": "fanuc-lathe", "preset": "fanuc-2path",
  "program": { "1": ["%", "…"], "2": ["…"] },
  "expect": {
    "flow": { "1": { "jumps": [{ "line": 6, "target": 9 }], "loops": [], "opaque": [] } },
    "before": [ { "kind": "order-not-checked", "channel": "1", "line": 7, "mark": "M902", "other": "2", "otherLine": 7 } ],
    "after": [ { "kind": "missing", "channel": "2", "line": 7, "mark": "M902", "other": "1" } ] } }
```

- `rule` names the rules of plan section 6.8.7 the case shows; every rule F1 to F5 has a case.
- `program` is one document per channel (`multi-file`) or one document read by its sections
  (`single-file`, the Okuma turrets).
- `expect.flow` is `computeFlow`'s answer per channel (the lines outside every section are
  left out); `before` and `after` compare `kind`, `channel`, `line`, `mark`, and `other` /
  `otherLine` / `counts` when the finding has them, in the check's order.
- Line numbers are 1-based.
