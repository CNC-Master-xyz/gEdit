# Folders, and files from the system

Two things in gEdit start from a folder or from outside the window:

- **Find in Folder** searches the programs in a folder, open or not, and lists the hits.
- **Opening files from the system**: a double-click on an NC file in Explorer, Finder or the
  file manager, and what happens when gEdit is already running.

A machine can also own a folder, so that every program saved there uses that machine. That is
in [Machines](machines.md#folders-of-a-machine).

## Find in Folder

**Edit ▸ Search ▸ Find in Folder…** (also in the command palette, `F1`; it has no key) searches
the files of a folder for a word, a text or a regular expression. Use it for the questions
that reach beyond the programs you have open: *which programs call T17?*, *where is the
spindle speed above 12000?*, *which program still has the old coolant code?*

gEdit asks for the **folder** first. It does not remember it: you pick it every time. Then
comes the form:

| Field | What it does |
|---|---|
| **File names** | Patterns separated by a semicolon or a space, such as `*.nc; *.tap`. `*` stands for any characters, `?` for one. Empty: every file. The form starts with the extensions gEdit knows as NC programs |
| **Include subfolders** | On by default |
| **Changed from**, **Changed up to** | A day as `YYYY-MM-DD`, such as `2026-10-27`. Both days are included. Empty: no limit. A last day before the first is refused |
| **Find** and its options | The same as [Find All](README.md#searching): an address word (tick *Whole address*), a text, a regular expression, *Match case*, *Also in comments*. Empty: list the files that fit the name and the dates, one row for each |
| **Read the files as** | *Each file by its name and content* (the default) or one dialect for all of them |

Every file is read **with its own dialect**, the way Find All reads a program: a word is
never found in a comment or a string, and `G1` finds `G01`. A value is compared as written,
as in Find All. A regular expression is the editor's own flavour ([Regular
expressions](regex.md)) and is stopped when it runs away; the message then names the file it
stopped on, and the hits before it stay in the list.

### The result

The hits go to the Results panel: the **file** (its path below the folder you picked), the
**line**, the **text** and when the file was **changed**. A search without a query lists the
files. The heading says how many, and says *At least 37 hits* when the search stopped before
the end.

**A click on a row opens that file** in a tab and goes to the line. If the file is already
open, gEdit goes to that tab. gEdit opens that one file and no more; the rest of the folder
stays closed to it.

**A row opens only while its search is the latest one.** Search the folder again, or another
folder, and the rows of the earlier list stay on the screen but say *… is from an earlier
search, so it cannot be opened from this list any more. Search the folder again to open it.*
Only the rows of the **last** search open. A search that is refused (for example the form
was wrong) leaves the earlier list as it was and still openable.

A search can be **stopped** in the status bar. What was found until then stays in the list.
If you start a second search while one runs, gEdit asks whether to stop the first.

### What it does not read, and says so

gEdit only reads. It writes, renames and deletes nothing in the folder. A search never
drops anything silently; the message under the list counts what was left out:

| Left out | Why |
|---|---|
| **Files that are not text** | A file with a zero byte in its first 8,192 bytes (a picture, a zip, a data file). UTF-16 text with its byte-order mark is text |
| **Files over 16 MB** | The editor itself opens 50 MB, but a search reads no file over 16 MB. The names are listed (the first 20) |
| **Files that could not be read** | A file another program holds, or that the system does not let you read |
| **Links** | A symbolic link is not followed, neither to a file nor to a folder, so a link cannot pull a program from outside the folder into the list. It is counted as *1 link was not followed* |
| **Hidden files and folders** | Names that start with a dot; on Windows also the hidden and system files |
| **Folders deeper than 16 levels**, and **folders with more than 50,000 entries** | Counted |
| **Files for which the query does not fit** | A word such as `S>12000` is asked in the dialect of each file. A file whose dialect cannot read it is listed with that dialect's message and the search goes on |

On **Windows** a folder that is shared as a network drive, mapped to a letter or a
`SUBST` letter is searched like any other. Windows also has links of its own besides the
symbolic one (junctions, and the placeholder files of OneDrive and similar services). They
are skipped and counted as links too. **If your programs are in a folder that OneDrive
keeps, the count of links may be high** and files are missing from the list; search a copy
of the folder that is not synchronised. (This has not been tried on a real
Windows machine yet.)

A search also **stops by itself**, and says why, when it meets a limit:

| Limit | Value |
|---|---|
| Hits in the list | 10,000 |
| Files read | 20,000 |
| Entries looked at | 200,000 |
| Text read in all | 1 GB |
| Time | 10 minutes |

The message then reads, for example, *Stopped after 20,000 files. Narrow the folder or the
name pattern.* Narrow the folder, the file names or the days, or make the query more exact.

A folder on a network share that does not answer cannot be interrupted while the system
waits for it. **Stop** still works at once and the list is shown; the stuck read ends when the
system lets it. After **four** such searches in one session gEdit asks you to wait or to
start gEdit again before the next one.

### The folder you pick

You can pick a folder on a drive or on a network share (`\\server\share\…`). The root of a drive (`C:\`, `/`) is refused: pick a folder
below it. A share's own root (`\\dnc\lathe1`) is allowed, because that is where a DNC folder
lives.

Picking a folder lets gEdit read that folder until you quit. gEdit lists and reads it only
in a search, and opens a program from it only when you click its row.

## Opening files from the system

Double-click an NC file, choose gEdit in *Open With*, or drop it on the program's icon, and
gEdit opens it. The files gEdit offers itself for are those with the extensions `.nc`,
`.tap`, `.cnc`, `.eia`, `.ncc`, `.ptp`, `.min`, `.ssb`, `.mpf` and `.spf`. Not `.txt`, `.h`,
`.iso` or `.sub`: they are not only NC programs, and gEdit does not take them from other
programs. A file with another name opens through *Open With* or **File ▸ Open** as always.

**On Windows and macOS** the installed gEdit is registered for these extensions. If another
program already owns them on your computer, choose gEdit under *Open With* (and your system's
*Always use this app*).

**On Linux, there is no double-click association in this version.** The package does not make
gEdit the program for NC files. Open files with **File ▸ Open** or drop them on the window;
both work as everywhere. You can start it from a terminal with the file names
(`gedit-nc part.mpf`). The association is on the list for a later version.

### One window

On **Windows and Linux**, starting gEdit a second time does not open a second window. The
second start hands its files to the window that is running, which comes to the front, and
ends. Select ten files in the file manager and open them together: they open in the one
window.

- A start with no file just brings the window to the front.
- **At most 32 files** are taken from one start; the rest are refused and counted. The usual
  limits of opening still hold: 50 files at once, 50 MB each, the encoding questions, the
  read-only rules.
- What is not a file gEdit can open (a folder, a file that is not there, gEdit's own state
  file, a name that starts with `-`, which is an option) is skipped. The status bar says *The
  system asked gEdit to open something that is not a file it can open. It was skipped.* The
  window is brought forward only when at least one file arrived.
- A file that arrives while gEdit is still starting waits and opens when the window is ready.
  If too many arrive at once, the status bar says how many were not opened.
- A relative name is read from the folder of the second start. If that folder is not known,
  the name is refused.
- A file you open this way is opened under the name as it was written, the way it would be
  with **File ▸ Open**. A program on a mapped drive (`Z:\DNC\part.nc`) therefore stays
  `Z:\DNC\part.nc` in its tab, and [a machine folder](machines.md#folders-of-a-machine) written as
  `Z:\DNC` matches it. gEdit still sees that two spellings of one file are one file: it does
  not open a second tab for it.

**On Linux the second start finds the first through the desktop's session bus.** Where there
is none (a shell on a remote machine, a container), gEdit still starts, but every start is a
window of its own, with its own state. Do not edit one program in two of them.

**On macOS** the system itself keeps one gEdit and sends the files to it. A second copy can be
started on purpose with `open -n`; the two then overwrite each other's settings and
session state, as before.

### What this cannot do

- **Nothing is read behind your back.** The system can only make gEdit open a file; it cannot
  make it write one. The file is shown in a tab and changes only when you save.
- Another program of your account can also ask gEdit to open any file you may read. It only
  appears in a tab; nothing is sent anywhere.
