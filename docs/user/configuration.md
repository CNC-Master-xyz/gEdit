# Settings search, language, and moving your configuration

This page covers three things in the settings dialog (`Cmd/Ctrl+,`): finding a setting, the
language of the program, and exporting or importing everything you have set up. The pages
themselves are described under [Settings](README.md#settings).

## Finding a setting

The box at the top of the dialog finds a setting by its name, its help text or its key in
`settings.json`, and a page by its heading. Type words; every word has to occur, capitals and
accents do not matter, and the best matches come first (at most 20). Choose a hit with the
mouse or the keyboard and the dialog opens its page and puts the cursor on that setting.
`Esc` first clears the box and, pressed again, closes the dialog. An empty box finds nothing.

The search covers the settings and the page headings. It does not look inside the contents of
the Machines, Profiles, Keyboard and Packages pages; to find a command or a key, use the search
box on the Keyboard page.

## Language

The program's menus and messages are in English. gEdit is built so that another language can be
added: a language is a set of message files that ships with the program. **No other language
ships in this version**, so the Language row of the settings dialog is not shown yet. When one
does, the row offers it, and:

- the change applies the next time gEdit starts (the dialog says so);
- a text that the chosen language lacks is shown in English;
- if the language cannot be loaded, English stays in use and gEdit tells you once.

Some things are never translated: the names of profiles, machines and scripts, template and
script texts, the descriptions in the code help, error details that come from the operating
system, and this guide. The setting is `ui.language` in `settings.json` (`de` or `de-CH`
style); a value that is not such a tag is ignored with a warning.

## Export and import

**Settings ▸ Configuration** (or **Export Configuration…** and **Import Configuration…** in the
command palette) moves your setup to another computer or makes a safe copy of it. It writes and
reads one zip file.

### Export

**Export…** asks for a place to save the zip and then writes:

- your settings, without the Python interpreter and the extra script folders, because those
  are places on this computer and a file must not decide what runs;
- your keys, your machines, your profiles and code files (templates included), your scripts;
- every package in the packages folder, switched-off ones included (the list of switched-off
  packages travels with the settings).

It never writes the recent-file list and session, the window position, backup and recovery
folders, or any `.bak` file. A file that import would refuse (larger than 1 MB, a name outside
the rules, a link, text that is not UTF-8 text, or a second name that is the same as another once
capitals are ignored) is left out and listed in the answer, so exporting a configuration and then
opening that zip in the import shows every file as *same as yours*. The zip cannot be saved inside
the configuration folder, and it is at most 16 MB. The first entry, `gedit-config.json`, says
which version made the file, when, and on what system.

### Import

**Import…** asks for a zip file and shows a preview. **Nothing is written until you confirm**,
and the preview itself changes nothing.

The preview lists groups: *Settings*, *Keyboard shortcuts*, *Machines*, *Profiles*, *Code
files and templates*, *Your scripts*, and one group for each package. Each group lists its
files and says for each whether it is *new*, *replaces yours* or *same as yours*, with its size.
For the three merged files it shows the changed lines. Every group that holds a change is ticked,
except groups that contain scripts, which start unticked. Entries that gEdit does not use are
listed as *not imported* with the reason (not part of a gEdit configuration; a file name gEdit
does not use; the name of gEdit's own script library; and so on), and the file is still
imported without them. A line also names what is kept from this computer.

**Scripts need your trust.** If you tick a group with scripts, the preview says *Scripts and
packages run Python on your computer with your rights. Import only a file you trust.* and
the **Import** button stays disabled until you tick **I trust this file**. A package with only
profiles and code files needs no tick.

**What import merges and what it replaces.**

- `settings.json` is merged key by key. The file's keys win and your other keys stay. The
  Python interpreter and the extra script folders in a file are never taken. The list of
  switched-off packages is joined with yours: an import can switch a package off, but never
  on, so a package you switched off stays off.
- Keyboard shortcuts are merged by command. A key given as text, or `null`, in the file replaces
  your whole entry for that command. An entry with separate members for Mac and for Windows and
  Linux is merged member by member, so the system the file does not mention keeps your key.
- Machines are merged by machine: a machine in the file replaces yours of the same id,
  new ones are added, your other machines stay. A file from a newer version of the machine
  format is refused.
  The folders of a machine are not taken from the file: a machine of yours that is replaced
  keeps the folders it has on this computer, and a machine that is added starts without any.
- Every other file (a profile, a code file, a script, a package file) replaces your file of the
  same name.
- **Import never deletes a file**, so a zip with three profiles does not remove the others
  you have. It never touches the recent-file list, window position, backup folders or anything
  outside the configuration folder, and it does not write through a link or into a folder that is
  a link. A file of yours that is larger than 1 MB, written by a newer gEdit or not readable is
  not replaced, and the preview says so.

**The backup.** Before it replaces anything, the import saves your current versions of every
file it is about to replace in a zip of its own, in the `import-backups` folder of your data
folder ([Where things are](README.md#where-things-are)), named `before-import-` and the date and
time. The ten newest are kept; the one just written is always kept. If the backup cannot be
written, nothing is imported. The message after the import names it, and **importing that backup
zip undoes the import**; a file that was new has nothing to back up and is not removed by
that.

**Checked again at the last moment.** When you press **Import** gEdit reads the file again and
compares it, byte for byte, with the one the preview showed. If anything changed in between
(even a comment in a script), nothing is written and you are asked to open the file again.

**All or nothing.** gEdit checks every selected file first (the JSON files parse, scripts are
text) and then writes packages, scripts, code files, profiles, machines, keys and, last, the
settings. If a write fails, the files already written are put back, the folders the import made
are removed again, and the message names the backup. When it works, gEdit reloads settings, keys,
machines, profiles, code files and scripts at once, without a restart, and says how many files
were written and which backup holds the old ones.

**Files that are refused.** A zip is refused as a whole, with every reason listed (up to 50),
when it cannot be trusted:

- it is not a zip, is damaged, is encrypted, or has no `gedit-config.json` (or was made by a
  newer gEdit);
- it is larger than 16 MB, holds more than 2,000 entries, a file over 1 MB, or more than 32 MB
  together; or unpacks to far more than its size (a zip bomb);
- an entry's name would leave the configuration folder (a leading `/`, `..`, a backslash, a
  colon or a drive name, a control character, a name Windows cannot hold), or two names are
  the same once capitals are ignored;
- an entry is a link or another kind of special file, or uses a compression gEdit does not
  read.

The difference from the entries listed as *not imported* is deliberate: an unsafe entry means
the file as a whole cannot be trusted, while an unknown entry only costs itself. Names are
ignored, not refused, when they hold invisible characters such as direction marks or zero-width
characters, when a script sits in a group called `gedit_nc` (that name is gEdit's own script
library and a file may not replace it), or when they use capitals or other characters that gEdit's
file names do not allow.

gEdit reads the zip itself and writes each file to a path of its own making, so no name in a zip
can choose where a file goes.
