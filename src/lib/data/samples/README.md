# Sample programs of the profile form's live preview

One short program per grammar and machine type, written for this editor and for nothing else: a
few blocks that show the kinds of word the colours are for. They are not cut from a real part
program and not from a manual.

A line may carry three placeholders, which `sampleProgram` (`src/lib/app/profileForm.ts`) fills in
from the draft profile so that changing a comment mark or a block number letter in the form
changes the preview:

- `{n10}` the block number 10, as the draft writes one (`N10`, or `10` on a Heidenhain-style profile);
- `{note:TEXT}` a comment holding TEXT, in the draft's comment marks;
- `{skip}` the draft's block skip mark.

The file name is `<grammar>-<machine type>.nc`; there is one for each of the four grammars (`iso`,
`klartext`, `okuma`, `sinumerik`) and the two machine types (`mill`, `lathe`).
