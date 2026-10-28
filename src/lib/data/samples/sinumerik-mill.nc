%_N_SAMPLE_MPF
{note:Sample pocket}
{n10} G54 G90 G17
{n20} T="MILL10" M6
{n30} S1800 M3
{n40} G0 X0 Y0 Z50
{n50} G1 Z-5 F250
{n60} G2 X20 Y0 I=AC(10) J=AC(0)
{n70} R1 = 12.5
{n80} IF R1 > 10
{skip}{n90} MSG("Sample")
{n100} ENDIF
{n110} M30
