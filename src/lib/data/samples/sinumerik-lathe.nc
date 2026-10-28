%_N_SAMPLE_MPF
{note:Sample turned part}
{n10} G54 G90 G18 DIAMON
{n20} T="ROUGH" M6
{n30} G96 S180 M3
{n40} G0 X60 Z2
{n50} G1 Z-20 F0.25
{n60} G2 X50 Z-25 I=AC(0) K=AC(-25)
{n70} R1 = 12.5
{n80} IF R1 > 10
{skip}{n90} MSG("Sample")
{n100} ENDIF
{n110} M30
