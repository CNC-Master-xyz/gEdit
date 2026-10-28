//! The configuration zip: export, and import with a preview (Phase 4 plan §6.9 rules 16–36,
//! AD-56, Q4-23). Written by the P4g prelude; P4.36 owns it from here.
//!
//! **What is final in this file** (the security vocabulary; P4.36 builds on it and does not
//! loosen it): the limits, the shape check of an entry name, the layout that says which entry is
//! which configuration file ([`classify`]), the per-entry gate ([`check_entry`]), the inventory of
//! an archive that applies the crate's header-consistency check and collects every refusal
//! ([`inventory`]), the bounded read of one entry ([`read_entry`]), the fingerprint the apply
//! compares ([`fingerprint`]), and the bounded read of the archive file ([`read_archive_file`]).
//! **What P4.36 wrote on it:** [`export`], [`preview`] and [`apply`], the settings, keys and
//! machines merges, the plan both of them share, the staging with its rollback and the backup zip.
//!
//! **The order of an import** (preview and apply alike): the archive's size, then the central
//! directory and the crate's header-consistency check, then every name's shape, every entry's
//! gate and the case-folded duplicates ([`inventory`]); then every configuration entry read into
//! memory under the produced-bytes budget ([`read_entry`]), the manifest, a versioned file from a
//! newer gEdit; only an archive with no refusal at all gets as far as the disk. There, each
//! target is looked at without following anything (a folder on the way or the target that is a
//! link is skipped), the three merged files are merged, and each file is compared with what is
//! there. Apply then checks the fingerprint, the groups and the trust, writes the backup zip,
//! and only then writes, in the order of rule 32, putting back what it wrote when a write fails.
//!
//! **Why gEdit reads the zip itself and never calls the crate's `extract`.** Extraction writes
//! by the crate's rules; here every name is checked by the rules below, every entry is read into
//! memory under limits that count the bytes really produced (never the sizes the archive
//! declares), and every file is then written by gEdit's own atomic writer to a path built from a
//! fixed base and a validated name. No entry is ever a path, a link or a mode on disk.
//!
//! **One refusal refuses the archive.** An entry that breaks a safety rule (name, link, size,
//! method, encryption, ratio, duplicate, overlap) makes the whole import impossible, and the
//! preview lists every offending entry at once. An entry that is merely not part of a
//! configuration (a file outside the layout, an `__MACOSX` folder, a name the user-file rules
//! refuse) is *ignored* and listed, because nothing is written for it.

use std::collections::HashSet;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

use crate::paths::{self, AppDirs};

/// The `format` the manifest of this build writes and reads.
pub const FORMAT: u32 = 1;

/// The manifest: the first entry of every archive gEdit writes, and required on import.
pub const MANIFEST_NAME: &str = "gedit-config.json";

/// The largest archive file read or written: 16 MiB.
pub const MAX_ARCHIVE_BYTES: u64 = 16 * 1024 * 1024;
/// The most entries (files and folders) an archive may hold.
pub const MAX_ENTRIES: usize = 2000;
/// The largest single file, declared and really produced: 1 MiB (the user-file cap).
pub const MAX_ENTRY_BYTES: u64 = crate::userfiles::MAX_BYTES;
/// The most bytes all entries may produce together, declared and really produced: 32 MiB.
pub const MAX_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
/// The largest ratio of produced to stored bytes (200 : 1), checked for an entry from
/// [`RATIO_FLOOR`] up and for the archive as a whole.
pub const MAX_RATIO: u64 = 200;
/// Entries smaller than this (64 KiB) are exempt from the ratio: a small JSON file may compress
/// well and costs nothing.
pub const RATIO_FLOOR: u64 = 64 * 1024;
/// The longest entry name, in bytes.
pub const MAX_NAME_BYTES: usize = 200;
/// The most segments of a name: `packages/<name>/scripts/<group>/<file>` has five.
pub const MAX_DEPTH: usize = 5;
/// The most refusals the answer lists (the rest are counted).
pub const MAX_REFUSALS_LISTED: usize = 50;

/// The settings keys an import never takes from a zip and an export never writes: they name
/// places on one computer (the Python interpreter and extra script folders), and taking them
/// from a file would let that file choose what runs.
pub const MACHINE_SPECIFIC_KEYS: [&str; 2] = ["scripts.python", "scripts.folders"];

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/// Why an archive, or one entry of it, is refused. The ids are the wire format (kebab-case) and
/// the keys of the dialog's messages (`configuration.refusal.<id>`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RefusalReason {
    /// The file is not a zip archive, or its central directory cannot be read.
    NotZip,
    /// The archive file is larger than [`MAX_ARCHIVE_BYTES`].
    ArchiveTooBig,
    /// More than [`MAX_ENTRIES`] entries.
    TooManyEntries,
    /// The entry name is not valid UTF-8, or the name the reader gives differs from the stored
    /// bytes (an extra field that renames the entry).
    NameEncoding,
    /// The name is longer than [`MAX_NAME_BYTES`].
    NameTooLong,
    /// More than [`MAX_DEPTH`] segments.
    TooDeep,
    /// The name begins with `/`.
    Absolute,
    /// The name holds a backslash (never converted to a separator).
    Backslash,
    /// The name holds a `:` (a drive letter, a data stream).
    Colon,
    /// The name holds a control character, a NUL included.
    Control,
    /// A `..` segment.
    ParentDir,
    /// An empty segment (`a//b`), or an empty name.
    EmptySegment,
    /// A segment Windows cannot hold: `.`, a trailing dot or space, `< > " | ? *`, a device name.
    BadSegment,
    /// Two entries with one name once case is folded (macOS and Windows would write one file).
    Duplicate,
    /// A symbolic link.
    Link,
    /// A device, a pipe or a socket.
    SpecialFile,
    /// An encrypted entry.
    Encrypted,
    /// A compression method other than stored and deflate.
    Method,
    /// A file larger than [`MAX_ENTRY_BYTES`], declared or produced.
    TooBig,
    /// All entries together larger than [`MAX_TOTAL_BYTES`], declared or produced.
    TotalTooBig,
    /// More than [`MAX_RATIO`] bytes produced per stored byte.
    Ratio,
    /// Entries whose stored data overlap, or local headers that disagree with the central
    /// directory.
    Inconsistent,
    /// The entry could not be read to its end, or produced a different number of bytes than it
    /// declared, or fails its checksum.
    Corrupt,
    /// No `gedit-config.json`.
    NoManifest,
    /// The manifest is not a JSON object of a gEdit configuration.
    BadManifest,
    /// A manifest `format` higher than this build reads.
    NewerFormat,
}

/// One refusal: the entry (empty for the archive as a whole) and the reason.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refusal {
    pub path: String,
    pub reason: RefusalReason,
}

impl Refusal {
    fn new(path: &str, reason: RefusalReason) -> Self {
        Self {
            path: path.to_string(),
            reason,
        }
    }
}

// ---------------------------------------------------------------------------
// Names: shape, then layout
// ---------------------------------------------------------------------------

/// Checks the *shape* of an entry name before anything is matched against the layout. A name
/// that fails is a refusal of the whole archive, whatever file it would have been.
pub fn check_shape(name: &str) -> Result<(), RefusalReason> {
    if name.len() > MAX_NAME_BYTES {
        return Err(RefusalReason::NameTooLong);
    }
    if name.is_empty() {
        return Err(RefusalReason::EmptySegment);
    }
    if name.contains('\\') {
        return Err(RefusalReason::Backslash);
    }
    if name.starts_with('/') {
        return Err(RefusalReason::Absolute);
    }
    if name.chars().any(char::is_control) {
        return Err(RefusalReason::Control);
    }
    if name.contains(':') {
        return Err(RefusalReason::Colon);
    }
    // A folder entry ends with one `/`; nothing else may leave an empty segment.
    let body = name.strip_suffix('/').unwrap_or(name);
    let segments: Vec<&str> = body.split('/').collect();
    for segment in &segments {
        if segment.is_empty() {
            return Err(RefusalReason::EmptySegment);
        }
        if *segment == ".." {
            return Err(RefusalReason::ParentDir);
        }
        if *segment == "."
            || segment.ends_with('.')
            || segment.ends_with(' ')
            || segment.contains(['<', '>', '"', '|', '?', '*'])
            || paths::is_device_name(segment)
        {
            return Err(RefusalReason::BadSegment);
        }
    }
    if segments.len() > MAX_DEPTH {
        return Err(RefusalReason::TooDeep);
    }
    Ok(())
}

/// A file of a package.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackagePart {
    Manifest,
    Profile(String),
    Code(String),
    Script { group: Option<String>, name: String },
}

/// Which configuration file an entry is. The path of a member inside `<config>` is its entry
/// name: the archive has the layout of the folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Member {
    Manifest,
    Settings,
    Keybindings,
    Machines,
    Profile(String),
    Code(String),
    Script { group: Option<String>, name: String },
    Package { package: String, part: PackagePart },
}

impl Member {
    /// The group the preview and the selection put this file in: `settings`, `keys`,
    /// `machines`, `profiles`, `codes`, `scripts`, or `package:<name>`. The manifest belongs to
    /// none.
    pub fn group(&self) -> Option<String> {
        Some(match self {
            Member::Manifest => return None,
            Member::Settings => "settings".into(),
            Member::Keybindings => "keys".into(),
            Member::Machines => "machines".into(),
            Member::Profile(_) => "profiles".into(),
            Member::Code(_) => "codes".into(),
            Member::Script { .. } => "scripts".into(),
            Member::Package { package, .. } => format!("package:{package}"),
        })
    }

    /// Whether the file is code that will run on the user's computer (a script, or a package,
    /// which may hold scripts): importing it needs the user's explicit trust (§6.9 rule 31).
    pub fn is_runnable(&self) -> bool {
        match self {
            Member::Script { .. } => true,
            Member::Package { part, .. } => matches!(part, PackagePart::Script { .. }),
            _ => false,
        }
    }
}

/// What an entry is, once its shape passed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Classified {
    Member(Member),
    /// Not written; listed. The reason is a short English id for the preview
    /// (`outside-layout`, `name-not-allowed`, `reserved-name`) or `system-file` for the files a
    /// file manager adds, which are counted and not listed.
    Ignored(&'static str),
}

/// A script or group name inside a zip: a plain segment (the rule of `scripts/discovery.rs`).
fn script_segment_ok(segment: &str) -> bool {
    crate::scripts::discovery::is_safe_segment(segment) && !segment.chars().any(is_format_char)
}

/// The characters that change how a name looks or reads without showing: the soft hyphen, the
/// Arabic letter mark, the Mongolian vowel separator, zero-width and direction marks
/// (U+200B..U+200F), line and paragraph separators and the bidi embeddings and overrides
/// (U+2028..U+202E), the invisible operators (U+2060..U+2064), the bidi isolates and the
/// deprecated format characters (U+2066..U+206F), the byte order mark and the interlinear
/// annotation marks. `Cc` is already refused for the whole archive by [`check_shape`]; these
/// are `Cf`/`Zl`/`Zp`, and a script or group named with one is ignored (`name-not-allowed`)
/// like any name the user-file rules refuse; the archive is not refused for it.
fn is_format_char(c: char) -> bool {
    matches!(
        c,
        '\u{00AD}'
            | '\u{061C}'
            | '\u{180E}'
            | '\u{200B}'..='\u{200F}'
            | '\u{2028}'..='\u{202E}'
            | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{206F}'
            | '\u{FEFF}'
            | '\u{FFF9}'..='\u{FFFB}'
    )
}

/// The folder name of the shared library, `gedit_nc`: `import gedit_nc` would find a folder of
/// that name in the scripts folder, so no script group may be called so.
fn is_library_group(group: &str) -> bool {
    let stem = crate::scripts::discovery::LIBRARY_FILE_NAME.trim_end_matches(".py");
    group.eq_ignore_ascii_case(stem)
}

/// A script file name: `<stem>.py`, a plain segment, not the shared library's name.
fn script_file_ok(name: &str) -> Result<(), &'static str> {
    if name == crate::scripts::discovery::LIBRARY_FILE_NAME {
        return Err("reserved-name");
    }
    let is_py = Path::new(name).extension().is_some_and(|ext| ext == "py") && name.len() > 3;
    if script_segment_ok(name) && is_py {
        Ok(())
    } else {
        Err("name-not-allowed")
    }
}

fn json_file_ok(name: &str) -> bool {
    crate::userfiles::validate_name(name).is_none()
}

/// A script path below a `scripts` folder: `[group/]name.py`.
fn script_member(rest: &[&str]) -> Result<(Option<String>, String), &'static str> {
    match rest {
        [name] => script_file_ok(name).map(|()| (None, (*name).to_string())),
        [group, _] if is_library_group(group) => Err("reserved-name"),
        [group, name] if script_segment_ok(group) && !group.starts_with('.') => {
            script_file_ok(name).map(|()| (Some((*group).to_string()), (*name).to_string()))
        }
        [_, _] => Err("name-not-allowed"),
        _ => Err("outside-layout"),
    }
}

/// Files a file manager adds to a zip; never part of a configuration, never listed one by one.
fn is_system_file(segments: &[&str]) -> bool {
    segments.first() == Some(&"__MACOSX")
        || segments
            .last()
            .is_some_and(|last| matches!(*last, ".DS_Store" | "Thumbs.db" | "desktop.ini"))
}

/// Matches a (shape-checked) file entry name against the layout.
///
/// ```text
/// gedit-config.json   settings.json   keybindings.json   machines.json
/// profiles/<name>.json    codes/<name>.json    scripts/[<group>/]<name>.py
/// packages/<pkg>/package.json
/// packages/<pkg>/{profiles,codes}/<name>.json    packages/<pkg>/scripts/[<group>/]<name>.py
/// ```
pub fn classify(name: &str) -> Classified {
    let segments: Vec<&str> = name.split('/').collect();
    if is_system_file(&segments) {
        return Classified::Ignored("system-file");
    }
    let member = match segments.as_slice() {
        [file] => match *file {
            MANIFEST_NAME => Member::Manifest,
            "settings.json" => Member::Settings,
            "keybindings.json" => Member::Keybindings,
            "machines.json" => Member::Machines,
            _ => return Classified::Ignored("outside-layout"),
        },
        ["profiles", file] => {
            if !json_file_ok(file) {
                return Classified::Ignored("name-not-allowed");
            }
            Member::Profile((*file).to_string())
        }
        ["codes", file] => {
            if !json_file_ok(file) {
                return Classified::Ignored("name-not-allowed");
            }
            Member::Code((*file).to_string())
        }
        ["scripts", rest @ ..] => match script_member(rest) {
            Ok((group, name)) => Member::Script { group, name },
            Err(reason) => return Classified::Ignored(reason),
        },
        ["packages", package, rest @ ..] => {
            if crate::packages::validate_package_name(package).is_some() {
                return Classified::Ignored("name-not-allowed");
            }
            let part = match rest {
                [file] if *file == crate::packages::MANIFEST_FILE => PackagePart::Manifest,
                ["profiles", file] if json_file_ok(file) => {
                    PackagePart::Profile((*file).to_string())
                }
                ["codes", file] if json_file_ok(file) => PackagePart::Code((*file).to_string()),
                ["profiles" | "codes", _] => return Classified::Ignored("name-not-allowed"),
                ["scripts", more @ ..] => match script_member(more) {
                    Ok((group, name)) => PackagePart::Script { group, name },
                    Err(reason) => return Classified::Ignored(reason),
                },
                _ => return Classified::Ignored("outside-layout"),
            };
            Member::Package {
                package: (*package).to_string(),
                part,
            }
        }
        _ => return Classified::Ignored("outside-layout"),
    };
    Classified::Member(member)
}

// ---------------------------------------------------------------------------
// One entry's metadata
// ---------------------------------------------------------------------------

/// The compression methods an import reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Stored,
    Deflated,
    Other,
}

/// What the gate reads of one entry; built from the central directory, so a test needs no zip.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntryMeta {
    pub is_dir: bool,
    /// The Unix mode of the external attributes, when the archive carries one.
    pub unix_mode: Option<u32>,
    pub encrypted: bool,
    pub method: Method,
    /// The sizes the archive *declares*. Advisory: the bytes really produced are counted again.
    pub size: u64,
    pub compressed: u64,
}

const S_IFMT: u32 = 0o170_000;
const S_IFREG: u32 = 0o100_000;
const S_IFDIR: u32 = 0o040_000;
const S_IFLNK: u32 = 0o120_000;

/// The per-entry safety gate: link, special file, encryption, method, size and ratio.
pub fn check_entry(meta: &EntryMeta) -> Result<(), RefusalReason> {
    // A link first: its "content" is the path it points to.
    match meta.unix_mode.map(|mode| mode & S_IFMT) {
        None | Some(0) | Some(S_IFREG) => {}
        Some(S_IFDIR) if meta.is_dir => {}
        Some(S_IFLNK) => return Err(RefusalReason::Link),
        Some(_) => return Err(RefusalReason::SpecialFile),
    }
    if meta.encrypted {
        return Err(RefusalReason::Encrypted);
    }
    if meta.method == Method::Other {
        return Err(RefusalReason::Method);
    }
    if meta.is_dir {
        // A folder entry carries no data; one that does is not what it says.
        return if meta.size == 0 {
            Ok(())
        } else {
            Err(RefusalReason::Corrupt)
        };
    }
    if meta.size > MAX_ENTRY_BYTES {
        return Err(RefusalReason::TooBig);
    }
    if meta.size >= RATIO_FLOOR && (meta.compressed == 0 || meta.size / meta.compressed > MAX_RATIO)
    {
        return Err(RefusalReason::Ratio);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// The inventory
// ---------------------------------------------------------------------------

/// One file entry of an archive that passed the gate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// The index in the central directory, for [`read_entry`].
    pub index: usize,
    pub name: String,
    pub classified: Classified,
    /// The declared size.
    pub size: u64,
    pub crc32: u32,
}

/// What an archive holds, once every entry passed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Inventory {
    /// File entries (folder entries are dropped), in central-directory order.
    pub entries: Vec<Entry>,
    /// How many entries were folder entries.
    pub folders: usize,
    /// The sum of the declared sizes.
    pub total: u64,
    /// The size of the archive file.
    pub archive_bytes: u64,
}

impl Inventory {
    /// The entries that are configuration files.
    pub fn members(&self) -> impl Iterator<Item = (&Entry, &Member)> {
        self.entries
            .iter()
            .filter_map(|entry| match &entry.classified {
                Classified::Member(member) => Some((entry, member)),
                Classified::Ignored(_) => None,
            })
    }

    /// The entries that are not written: `(name, reason)`, system files excluded.
    pub fn ignored(&self) -> Vec<(&str, &'static str)> {
        self.entries
            .iter()
            .filter_map(|entry| match entry.classified {
                Classified::Ignored(reason) if reason != "system-file" => {
                    Some((entry.name.as_str(), reason))
                }
                _ => None,
            })
            .collect()
    }

    /// How many entries were file-manager leftovers.
    pub fn system_files(&self) -> usize {
        self.entries
            .iter()
            .filter(|entry| entry.classified == Classified::Ignored("system-file"))
            .count()
    }
}

/// Opens `bytes` as an archive and checks every entry. `Err` lists *every* refusal found (up to
/// [`MAX_REFUSALS_LISTED`]; a last row with an empty path and the reason of the first one
/// stands for "and more" when the list was cut), so the user sees all of them at once.
pub fn inventory(bytes: &[u8]) -> Result<Inventory, Vec<Refusal>> {
    let archive_bytes = bytes.len() as u64;
    if archive_bytes > MAX_ARCHIVE_BYTES {
        return Err(vec![Refusal::new("", RefusalReason::ArchiveTooBig)]);
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| vec![Refusal::new("", RefusalReason::NotZip)])?;
    if archive.len() > MAX_ENTRIES {
        return Err(vec![Refusal::new("", RefusalReason::TooManyEntries)]);
    }
    // Duplicate names, a local header that disagrees with the central directory (a renaming
    // Unicode-path field included), and entries whose data overlap.
    if archive.validate_header_consistency().is_err() {
        return Err(vec![Refusal::new("", RefusalReason::Inconsistent)]);
    }

    let mut refusals: Vec<Refusal> = Vec::new();
    let mut entries = Vec::new();
    let mut folders = 0usize;
    let mut total = 0u64;
    let mut seen: HashSet<String> = HashSet::new();

    for index in 0..archive.len() {
        let file = match archive.by_index_raw(index) {
            Ok(file) => file,
            Err(_) => {
                refusals.push(Refusal::new("", RefusalReason::NotZip));
                break;
            }
        };
        let raw = file.name_raw();
        let name = match std::str::from_utf8(raw) {
            // The name the reader gives has to be the stored bytes.
            Ok(name) if file.name().map(|n| n.as_bytes() == raw).unwrap_or(false) => {
                name.to_string()
            }
            _ => {
                refusals.push(Refusal::new(
                    &String::from_utf8_lossy(raw),
                    RefusalReason::NameEncoding,
                ));
                continue;
            }
        };
        if let Err(reason) = check_shape(&name) {
            refusals.push(Refusal::new(&name, reason));
            continue;
        }
        let meta = EntryMeta {
            is_dir: file.is_dir(),
            unix_mode: file.unix_mode(),
            encrypted: file.encrypted(),
            method: match file.compression() {
                zip::CompressionMethod::Stored => Method::Stored,
                zip::CompressionMethod::Deflated => Method::Deflated,
                _ => Method::Other,
            },
            size: file.size(),
            compressed: file.compressed_size(),
        };
        if let Err(reason) = check_entry(&meta) {
            refusals.push(Refusal::new(&name, reason));
            continue;
        }
        if !seen.insert(duplicate_key(&name)) {
            refusals.push(Refusal::new(&name, RefusalReason::Duplicate));
            continue;
        }
        if meta.is_dir {
            folders += 1;
            continue;
        }
        total = total.saturating_add(meta.size);
        entries.push(Entry {
            index,
            name: name.clone(),
            classified: classify(&name),
            size: meta.size,
            crc32: file.crc32(),
        });
    }

    if refusals.is_empty() && total > MAX_TOTAL_BYTES {
        refusals.push(Refusal::new("", RefusalReason::TotalTooBig));
    }
    if refusals.is_empty() && total >= RATIO_FLOOR && total / archive_bytes.max(1) > MAX_RATIO {
        refusals.push(Refusal::new("", RefusalReason::Ratio));
    }
    if !refusals.is_empty() {
        let more = refusals.len() > MAX_REFUSALS_LISTED;
        let first = refusals[0].reason;
        refusals.truncate(MAX_REFUSALS_LISTED);
        if more {
            refusals.push(Refusal::new("", first));
        }
        return Err(refusals);
    }
    Ok(Inventory {
        entries,
        folders,
        total,
        archive_bytes,
    })
}

/// Reads entry `index` completely into memory and no further than the limits allow. The number
/// of bytes counted is the number produced, never the size the archive declares; `budget` is
/// the rest of [`MAX_TOTAL_BYTES`] and shrinks by what was read. A different length than
/// declared, a failed checksum or any read error is `Corrupt`.
pub fn read_entry(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    index: usize,
    declared: u64,
    budget: &mut u64,
) -> Result<Vec<u8>, RefusalReason> {
    let limit = declared.min(MAX_ENTRY_BYTES);
    let file = archive
        .by_index(index)
        .map_err(|_| RefusalReason::Corrupt)?;
    let mut bytes = Vec::new();
    // One byte more than the limit, so an entry that produces more than it declared is caught.
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| RefusalReason::Corrupt)?;
    let produced = bytes.len() as u64;
    if produced > MAX_ENTRY_BYTES {
        return Err(RefusalReason::TooBig);
    }
    if produced != declared {
        return Err(RefusalReason::Corrupt);
    }
    if produced > *budget {
        return Err(RefusalReason::TotalTooBig);
    }
    *budget -= produced;
    Ok(bytes)
}

/// The fingerprint of an archive: a keyed 64-bit hash (SipHash, with a key chosen at random once
/// per process) of *every byte* of the archive, as 16 hex digits. The preview hands it out and
/// the apply compares it: an archive that changed in between, by one byte anywhere (a script's
/// text, a comment, a header), is not applied. The key never leaves the process, which previews
/// and applies alike, so a crafted archive cannot be made to match a fingerprint it was not
/// previewed under. (Still change detection, not a signature: it protects nothing across runs.)
pub fn fingerprint(archive: &[u8]) -> String {
    use std::hash::BuildHasher;
    static KEY: std::sync::OnceLock<std::hash::RandomState> = std::sync::OnceLock::new();
    let hash = KEY
        .get_or_init(std::hash::RandomState::new)
        .hash_one(archive);
    format!("{hash:016x}")
}

/// The bytes of the archive file `src`: an absolute path without `..` or NUL that the fs scope
/// allows (a file the user picked in the open dialog), a plain file (never a link) of at most
/// [`MAX_ARCHIVE_BYTES`].
pub fn read_archive_file(src: &str, is_allowed: impl Fn(&Path) -> bool) -> Result<Vec<u8>, String> {
    let path = Path::new(src);
    if src.contains('\0') || !path.is_absolute() {
        return Err("not an absolute path".into());
    }
    if path
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("path is not a plain absolute path".into());
    }
    if !is_allowed(path) {
        return Err("path is not allowed".into());
    }
    crate::userfiles::read_regular_max(path, MAX_ARCHIVE_BYTES, "larger than 16 MiB")
}

// ---------------------------------------------------------------------------
// The wire types (camelCase; `platform/commands.ts` mirrors them)
// ---------------------------------------------------------------------------

/// What an import does to one file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileAction {
    /// The file does not exist yet.
    New,
    /// The file exists and differs; it is replaced (the backup zip holds the old one).
    Replace,
    /// The file exists with the same content; nothing is written.
    Same,
}

/// One line inside a file: a settings key or a machine, with the old and the new value as text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub label: String,
    pub from: Option<String>,
    pub to: Option<String>,
}

/// One file the import would write (or leave).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFile {
    /// The entry name in the zip, which is also the path below `<config>`.
    pub path: String,
    pub action: FileAction,
    pub bytes: u64,
    /// For `settings.json` and `machines.json`: the keys or machines that change.
    pub items: Vec<ImportItem>,
    /// English notes (a key kept because it names a place on one computer, a machine kept).
    pub notes: Vec<String>,
}

/// One selectable group of the preview.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportGroup {
    /// `settings`, `keys`, `machines`, `profiles`, `codes`, `scripts` or `package:<name>`.
    pub id: String,
    /// The group holds a script or a package script: importing it needs the user's trust.
    pub runnable: bool,
    pub files: Vec<ImportFile>,
}

/// What the manifest says, for the header of the preview. Informational only.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestInfo {
    pub app_version: String,
    pub created: String,
    pub platform: String,
}

/// The answer of `config_import_preview`. Nothing was written and nothing granted.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    /// False when the archive is refused as a whole; then `refusals` says why and `groups` is
    /// empty.
    pub ok: bool,
    pub fingerprint: String,
    pub manifest: ManifestInfo,
    pub groups: Vec<ImportGroup>,
    /// Entries not written, `(path, reason)` flattened as `"<path>: <reason>"`, at most 50.
    pub ignored: Vec<String>,
    pub ignored_count: usize,
    pub refusals: Vec<Refusal>,
    /// Some group holds code that will run: the dialog asks for trust before it enables Import.
    pub needs_trust: bool,
    /// The settings keys the import never takes ([`MACHINE_SPECIFIC_KEYS`]) that the file holds.
    pub kept_settings: Vec<String>,
}

/// The answer of `config_import_apply`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub written: usize,
    pub unchanged: usize,
    /// The file name of the backup zip in `<data>/import-backups`; `None` when nothing was
    /// replaced.
    pub backup: Option<String>,
}

/// A file the export left out, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    pub path: String,
    pub reason: String,
}

/// The answer of `config_export`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub files: usize,
    pub bytes: u64,
    pub skipped: Vec<Skipped>,
}

// ---------------------------------------------------------------------------
// P4.36: small helpers
// ---------------------------------------------------------------------------

/// What the apply answers when the archive is not the one the preview read (§6.9 rule 29).
pub const CHANGED: &str = "the file changed since it was previewed; open it again";

/// The most backup zips `<data>/import-backups` keeps (§6.9 rule 30).
pub const MAX_IMPORT_BACKUPS: usize = 10;

/// The prefix of a backup zip's name: `before-import-<yyyymmdd-hhmmss>[-<n>].zip`.
pub const BACKUP_PREFIX: &str = "before-import-";

/// The most rows of `skipped` the export's manifest lists (the rest are counted), so a folder
/// with thousands of stray files cannot make a manifest the import refuses as too big.
const MAX_SKIPPED_IN_MANIFEST: usize = 200;

/// The longest value text a preview line shows.
const MAX_ITEM_CHARS: usize = 120;

/// `(year, month, day, hour, minute, second)` in UTC of `secs` since 1970 (proleptic Gregorian).
fn utc_parts(secs: u64) -> (i64, i64, i64, u64, u64, u64) {
    let (days, rest) = ((secs / 86_400) as i64, secs % 86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day, rest / 3_600, rest % 3_600 / 60, rest % 60)
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `2026-10-27T10:00:00Z`.
fn iso_utc(secs: u64) -> String {
    let (y, mo, d, h, mi, s) = utc_parts(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// `20261027-100000`.
fn stamp_utc(secs: u64) -> String {
    let (y, mo, d, h, mi, s) = utc_parts(secs);
    format!("{y:04}{mo:02}{d:02}-{h:02}{mi:02}{s:02}")
}

/// Whether `meta` (of `symlink_metadata`) is a link: a symbolic link, or on Windows any reparse
/// point (a junction included).
fn is_link(meta: &std::fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

/// `<base>/<seg>/<seg>…`: the only way a path is built from an entry name (rule 22).
fn join_segments(base: &Path, segments: &[&str]) -> PathBuf {
    let mut path = base.to_path_buf();
    for segment in segments {
        path.push(segment);
    }
    path
}

/// What two entry names are the same under: the name without a closing `/`, case folded (a file
/// system that folds case keeps one of two such files). The inventory refuses an archive holding
/// two such names; the export uses the same key to leave the second out.
fn duplicate_key(name: &str) -> String {
    name.trim_end_matches('/').to_lowercase()
}

/// The bytes a JSON object is written as (the shape `config::save_json_object` writes).
fn pretty(object: &Map<String, Value>) -> Vec<u8> {
    let mut bytes = serde_json::to_vec_pretty(object).unwrap_or_default();
    bytes.push(b'\n');
    bytes
}

/// A value as one line of text for the preview, shortened.
fn value_text(value: &Value) -> String {
    let text = match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    if text.chars().count() > MAX_ITEM_CHARS {
        let cut: String = text.chars().take(MAX_ITEM_CHARS).collect();
        format!("{cut}…")
    } else {
        text
    }
}

fn item(label: &str, from: Option<&Value>, to: Option<&Value>) -> ImportItem {
    ImportItem {
        label: label.to_string(),
        from: from.map(value_text),
        to: to.map(value_text),
    }
}

/// A script's bytes: UTF-8 text without NUL (rule 32).
fn is_script_text(bytes: &[u8]) -> bool {
    !bytes.contains(&0) && std::str::from_utf8(bytes).is_ok()
}

/// The refusals of an archive as one English line, for the apply's error.
fn refusal_text(refusals: &[Refusal]) -> String {
    let parts: Vec<String> = refusals
        .iter()
        .take(5)
        .map(|r| {
            let reason = serde_json::to_value(r.reason)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default();
            if r.path.is_empty() {
                reason
            } else {
                format!("{}: {reason}", r.path)
            }
        })
        .collect();
    format!("the file is refused ({})", parts.join(", "))
}

/// Cuts a refusal list to [`MAX_REFUSALS_LISTED`], with the "and more" row of [`inventory`].
fn capped(mut refusals: Vec<Refusal>) -> Vec<Refusal> {
    if refusals.len() > MAX_REFUSALS_LISTED {
        let first = refusals[0].reason;
        refusals.truncate(MAX_REFUSALS_LISTED);
        refusals.push(Refusal::new("", first));
    }
    refusals
}

// ---------------------------------------------------------------------------
// What is on disk now (rule 28: never into a folder that is a link)
// ---------------------------------------------------------------------------

/// What is at the target of an entry below `<config>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OnDisk {
    /// Nothing there yet (or a folder on the way does not exist yet).
    Missing,
    /// A plain file.
    File,
    /// Not written; the reason id the preview lists.
    Skip(&'static str),
}

/// Looks at every folder from `<config>` down to the target without following anything: a
/// folder on the way that is a link, or a target that is a link or no plain file, is skipped.
/// `<config>` itself may be a link (the user put the whole folder somewhere); nothing below it.
fn on_disk(config: &Path, segments: &[&str]) -> OnDisk {
    let mut path = config.to_path_buf();
    for (index, segment) in segments.iter().enumerate() {
        path.push(segment);
        let last = index + 1 == segments.len();
        match std::fs::symlink_metadata(&path) {
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return OnDisk::Missing,
            Err(_) => return OnDisk::Skip("unreadable"),
            Ok(meta) if is_link(&meta) => {
                return OnDisk::Skip(if last {
                    "target-link"
                } else {
                    "link-on-the-way"
                });
            }
            Ok(meta) if last => {
                return if meta.is_file() {
                    OnDisk::File
                } else {
                    OnDisk::Skip("not-a-file")
                };
            }
            Ok(meta) if !meta.is_dir() => return OnDisk::Skip("not-a-folder"),
            Ok(_) => {}
        }
    }
    OnDisk::Missing
}

/// A JSON file on disk as the merge sees it.
enum CurrentJson {
    Missing,
    Object(Map<String, Value>),
    /// There, but not a JSON object: replaced, and the backup keeps it.
    Broken,
}

/// `current` read as a versioned JSON object. `Err` is the skip reason of a file from a newer
/// gEdit, which is read and never overwritten (the rule of `config.rs`).
fn current_json(current: Option<&[u8]>, version_now: u32) -> Result<CurrentJson, &'static str> {
    let Some(bytes) = current else {
        return Ok(CurrentJson::Missing);
    };
    match serde_json::from_slice::<Value>(bytes) {
        Ok(Value::Object(object)) => {
            if newer(&object, version_now) {
                Err("newer-file")
            } else {
                Ok(CurrentJson::Object(object))
            }
        }
        _ => Ok(CurrentJson::Broken),
    }
}

/// Whether `object` carries a `$version` above `version_now`.
fn newer(object: &Map<String, Value>, version_now: u32) -> bool {
    object
        .get(crate::config::VERSION_KEY)
        .and_then(Value::as_u64)
        .is_some_and(|v| v > u64::from(version_now))
}

// ---------------------------------------------------------------------------
// The merges (rule 27)
// ---------------------------------------------------------------------------

/// The outcome of a merge: the bytes to write, whether they change nothing, and the lines.
#[derive(Debug, Default)]
struct Merged {
    bytes: Vec<u8>,
    same: bool,
    items: Vec<ImportItem>,
    notes: Vec<String>,
}

const BROKEN_NOTE: &str =
    "the file on this computer is not a JSON object; it is replaced, and the backup keeps it";

fn base_of(current: &CurrentJson) -> (Map<String, Value>, Vec<String>) {
    match current {
        CurrentJson::Object(object) => (object.clone(), Vec::new()),
        CurrentJson::Missing => (Map::new(), Vec::new()),
        CurrentJson::Broken => (Map::new(), vec![BROKEN_NOTE.to_string()]),
    }
}

/// The note under a `packages.disabled` line the union changed (the preview shows it as is).
const DISABLED_NOTE: &str = "packages switched off on this computer stay off: a configuration file can switch packages off, not on";

/// `packages.disabled` after an import: the names on this computer, in their order, then the
/// file's names that are new. A value that is not a list of names counts as an empty list, on
/// either side. Adds [`DISABLED_NOTE`] when the file's list lacks a name of this computer's.
fn disabled_union(local: Option<&Value>, zip: &Value, notes: &mut Vec<String>) -> Value {
    fn names(value: Option<&Value>) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        if let Some(Value::Array(list)) = value {
            for name in list.iter().filter_map(Value::as_str) {
                if !out.iter().any(|seen| seen == name) {
                    out.push(name.to_string());
                }
            }
        }
        out
    }
    let ours = names(local);
    let theirs = names(Some(zip));
    if ours.iter().any(|name| !theirs.contains(name)) {
        notes.push(DISABLED_NOTE.to_string());
    }
    let mut all = ours;
    for name in theirs {
        if !all.contains(&name) {
            all.push(name);
        }
    }
    Value::Array(all.into_iter().map(Value::String).collect())
}

/// `settings.json`, key by key: the zip's keys win, the others stay, and
/// [`MACHINE_SPECIFIC_KEYS`] are never taken. Answers the merge and the kept keys.
fn merge_settings(zip: &Map<String, Value>, current: &CurrentJson) -> (Merged, Vec<String>) {
    use crate::config::{SETTINGS_VERSION, VERSION_KEY};
    let (base, mut notes) = base_of(current);
    let mut merged = base.clone();
    let mut items = Vec::new();
    let mut kept = Vec::new();
    let mut keys: Vec<&String> = zip.keys().collect();
    keys.sort();
    for key in keys {
        if key == VERSION_KEY {
            continue;
        }
        if MACHINE_SPECIFIC_KEYS.contains(&key.as_str()) {
            kept.push(key.clone());
            notes.push(format!(
                "{key} is not taken from the file; the value on this computer stays"
            ));
            continue;
        }
        let value = &zip[key];
        // A file may switch packages off, never on (the owner's Q4g-2: a file cannot choose
        // what runs): the list is the union of this computer's and the file's.
        let union;
        let value = if key == crate::packages::KEY_PACKAGES_DISABLED {
            union = disabled_union(base.get(key), value, &mut notes);
            if base.get(key).is_none() && union == Value::Array(Vec::new()) {
                continue;
            }
            &union
        } else {
            value
        };
        if base.get(key) != Some(value) {
            items.push(item(key, base.get(key), Some(value)));
            merged.insert(key.clone(), value.clone());
        }
    }
    merged.insert(VERSION_KEY.into(), Value::from(SETTINGS_VERSION));
    let same = matches!(current, CurrentJson::Object(_)) && items.is_empty();
    (
        Merged {
            bytes: pretty(&merged),
            same,
            items,
            notes,
        },
        kept,
    )
}

/// One command's binding after an import: a string or `null` of the zip replaces the whole
/// value (both platforms); an object `{"mac":…,"other":…}` of the zip is laid member by member
/// over this computer's value, so a platform the zip does not name keeps the user's key (a
/// string here counts as both members, `null` as both unbound).
fn merge_binding(local: Option<&Value>, zip: &Value) -> Value {
    let Value::Object(theirs) = zip else {
        return zip.clone();
    };
    let mut merged = match local {
        Some(Value::Object(ours)) => ours.clone(),
        Some(single @ (Value::String(_) | Value::Null)) => {
            let mut both = Map::new();
            both.insert("mac".into(), single.clone());
            both.insert("other".into(), single.clone());
            both
        }
        _ => Map::new(),
    };
    for (member, value) in theirs {
        merged.insert(member.clone(), value.clone());
    }
    Value::Object(merged)
}

/// `keybindings.json` by command id: the zip's binding wins, the user's other bindings stay.
/// `Err` is a skip reason.
fn merge_keybindings(
    zip: &Map<String, Value>,
    current: &CurrentJson,
) -> Result<Merged, &'static str> {
    use crate::config::VERSION_KEY;
    use crate::keybindings::{KEYBINDINGS_VERSION, MAX_BINDINGS};
    let (base, notes) = base_of(current);
    let mut merged = base.clone();
    let mut items = Vec::new();
    for (key, value) in zip {
        if key == VERSION_KEY || key == "bindings" {
            continue;
        }
        if base.get(key) != Some(value) {
            items.push(item(key, base.get(key), Some(value)));
            merged.insert(key.clone(), value.clone());
        }
    }
    match zip.get("bindings") {
        None => {}
        Some(Value::Object(theirs)) => {
            let mut bindings = match base.get("bindings") {
                Some(Value::Object(ours)) => ours.clone(),
                _ => Map::new(),
            };
            let mut ids: Vec<&String> = theirs.keys().collect();
            ids.sort();
            for id in ids {
                let value = &merge_binding(bindings.get(id), &theirs[id]);
                if bindings.get(id) != Some(value) {
                    items.push(item(id, bindings.get(id), Some(value)));
                    bindings.insert(id.clone(), value.clone());
                }
            }
            if bindings.len() > MAX_BINDINGS {
                return Err("too-many-keys");
            }
            merged.insert("bindings".into(), Value::Object(bindings));
        }
        Some(_) => return Err("bad-content"),
    }
    merged.insert(VERSION_KEY.into(), Value::from(KEYBINDINGS_VERSION));
    let same = matches!(current, CurrentJson::Object(_)) && items.is_empty();
    Ok(Merged {
        bytes: pretty(&merged),
        same,
        items,
        notes,
    })
}

/// `machines.json` by machine id: the zip's machine replaces the same id in place, a new id is
/// added at the end, the user's other machines stay; `defaults` are merged key by key. `Err` is
/// a skip reason.
fn merge_machines(zip: &Map<String, Value>, current: &CurrentJson) -> Result<Merged, &'static str> {
    use crate::config::VERSION_KEY;
    use crate::machines::MACHINES_VERSION;
    let (base, mut notes) = base_of(current);
    let mut merged = base.clone();
    let mut items = Vec::new();
    for (key, value) in zip {
        if matches!(key.as_str(), VERSION_KEY | "machines" | "defaults") {
            continue;
        }
        if base.get(key) != Some(value) {
            items.push(item(key, base.get(key), Some(value)));
            merged.insert(key.clone(), value.clone());
        }
    }
    let id_of = |machine: &Value| -> Option<String> {
        machine
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let name_of = |machine: &Value| -> Value {
        machine
            .get("name")
            .cloned()
            .or_else(|| machine.get("id").cloned())
            .unwrap_or(Value::Null)
    };
    match zip.get("machines") {
        None => {}
        Some(Value::Array(theirs)) => {
            let mut machines = match base.get("machines") {
                Some(Value::Array(ours)) => ours.clone(),
                Some(_) => {
                    notes.push(
                        "the machine list on this computer is not a list; it is replaced".into(),
                    );
                    Vec::new()
                }
                None => Vec::new(),
            };
            let mut without_id = 0usize;
            for machine in theirs {
                let Some(id) = id_of(machine) else {
                    without_id += 1;
                    continue;
                };
                match machines
                    .iter()
                    .position(|m| id_of(m).as_deref() == Some(id.as_str()))
                {
                    Some(index) if machines[index] == *machine => {}
                    Some(index) => {
                        items.push(item(
                            &id,
                            Some(&name_of(&machines[index])),
                            Some(&name_of(machine)),
                        ));
                        machines[index] = machine.clone();
                    }
                    None => {
                        items.push(item(&id, None, Some(&name_of(machine))));
                        machines.push(machine.clone());
                    }
                }
            }
            if without_id > 0 {
                notes.push(format!(
                    "{without_id} machine(s) in the file have no id and are left out"
                ));
            }
            merged.insert("machines".into(), Value::Array(machines));
        }
        Some(_) => return Err("bad-content"),
    }
    match zip.get("defaults") {
        None => {}
        Some(Value::Object(theirs)) => {
            let mut defaults = match base.get("defaults") {
                Some(Value::Object(ours)) => ours.clone(),
                _ => Map::new(),
            };
            let mut keys: Vec<&String> = theirs.keys().collect();
            keys.sort();
            for key in keys {
                let value = &theirs[key];
                if defaults.get(key) != Some(value) {
                    items.push(item(
                        &format!("defaults.{key}"),
                        defaults.get(key),
                        Some(value),
                    ));
                    defaults.insert(key.clone(), value.clone());
                }
            }
            merged.insert("defaults".into(), Value::Object(defaults));
        }
        Some(_) => return Err("bad-content"),
    }
    merged.insert(VERSION_KEY.into(), Value::from(MACHINES_VERSION));
    let same = matches!(current, CurrentJson::Object(_)) && items.is_empty();
    Ok(Merged {
        bytes: pretty(&merged),
        same,
        items,
        notes,
    })
}

// ---------------------------------------------------------------------------
// The plan: what an import would write (shared by preview and apply)
// ---------------------------------------------------------------------------

/// One file the import would write or leave.
#[derive(Debug, Clone)]
struct Planned {
    member: Member,
    group: String,
    /// The entry name, which is the path below `<config>`.
    path: String,
    /// What is written (the merged file for the three merged ones).
    bytes: Vec<u8>,
    /// What is on disk now; `None` for a new file.
    current: Option<Vec<u8>>,
    action: FileAction,
    items: Vec<ImportItem>,
    notes: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct Plan {
    manifest: ManifestInfo,
    files: Vec<Planned>,
    /// `(path, reason id)` of entries and targets not written.
    ignored: Vec<(String, String)>,
    system_files: usize,
    kept_settings: Vec<String>,
}

/// The order the preview lists the groups in.
fn group_rank(member: &Member) -> u8 {
    match member {
        Member::Manifest | Member::Settings => 0,
        Member::Keybindings => 1,
        Member::Machines => 2,
        Member::Profile(_) => 3,
        Member::Code(_) => 4,
        Member::Script { .. } => 5,
        Member::Package { .. } => 6,
    }
}

/// The order apply writes in (rule 32): packages, scripts, code files, profiles, machines, keys,
/// settings, so that a half-done import never switches on something that is not there yet.
fn write_rank(member: &Member) -> u8 {
    match member {
        Member::Package { .. } => 0,
        Member::Script { .. } => 1,
        Member::Code(_) => 2,
        Member::Profile(_) => 3,
        Member::Machines => 4,
        Member::Keybindings => 5,
        Member::Settings | Member::Manifest => 6,
    }
}

/// The manifest's informational header, or why the archive is refused.
fn read_manifest(bytes: &[u8]) -> Result<ManifestInfo, RefusalReason> {
    let Ok(Value::Object(object)) = serde_json::from_slice::<Value>(bytes) else {
        return Err(RefusalReason::BadManifest);
    };
    if object.get("app").and_then(Value::as_str) != Some("gEdit") {
        return Err(RefusalReason::BadManifest);
    }
    match object.get("format").and_then(Value::as_u64) {
        Some(format) if format > u64::from(FORMAT) => return Err(RefusalReason::NewerFormat),
        Some(format) if format >= 1 => {}
        _ => return Err(RefusalReason::BadManifest),
    }
    let text = |key: &str| {
        object
            .get(key)
            .and_then(Value::as_str)
            .map(|s| s.chars().take(MAX_ITEM_CHARS).collect())
            .unwrap_or_default()
    };
    Ok(ManifestInfo {
        app_version: text("version"),
        created: text("created"),
        platform: text("platform"),
    })
}

/// Reads every member of the archive (rules 22–24 again, on the bytes really produced), checks
/// the manifest and every file's content, merges the three merged files and compares each file
/// with what is on disk now. Writes nothing. `Err` lists every refusal found.
fn plan(dirs: &AppDirs, archive_bytes: &[u8], inv: &Inventory) -> Result<Plan, Vec<Refusal>> {
    let mut archive = zip::ZipArchive::new(Cursor::new(archive_bytes))
        .map_err(|_| vec![Refusal::new("", RefusalReason::NotZip)])?;
    let mut refusals = Vec::new();
    let mut read: Vec<(&Entry, &Member, Vec<u8>)> = Vec::new();
    let mut budget = MAX_TOTAL_BYTES;
    for (entry, member) in inv.members() {
        match read_entry(&mut archive, entry.index, entry.size, &mut budget) {
            Ok(bytes) => read.push((entry, member, bytes)),
            Err(reason) => refusals.push(Refusal::new(&entry.name, reason)),
        }
    }
    let mut out = Plan {
        system_files: inv.system_files(),
        ..Plan::default()
    };
    match read
        .iter()
        .find(|(_, member, _)| **member == Member::Manifest)
    {
        Some((_, _, bytes)) => match read_manifest(bytes) {
            Ok(info) => out.manifest = info,
            Err(reason) => refusals.push(Refusal::new(MANIFEST_NAME, reason)),
        },
        None if refusals.iter().any(|r| r.path == MANIFEST_NAME) => {}
        None => refusals.push(Refusal::new(MANIFEST_NAME, RefusalReason::NoManifest)),
    }
    // A versioned file from a newer gEdit is refused like a newer manifest: its meaning is
    // unknown to this build (rule 27 for machines.json; settings and keys alike).
    for (entry, member, bytes) in &read {
        let version_now = match member {
            Member::Settings => crate::config::SETTINGS_VERSION,
            Member::Keybindings => crate::keybindings::KEYBINDINGS_VERSION,
            Member::Machines => crate::machines::MACHINES_VERSION,
            _ => continue,
        };
        if let Ok(Value::Object(object)) = serde_json::from_slice::<Value>(bytes) {
            if newer(&object, version_now) {
                refusals.push(Refusal::new(&entry.name, RefusalReason::NewerFormat));
            }
        }
    }
    if !refusals.is_empty() {
        return Err(capped(refusals));
    }

    for (name, reason) in inv.ignored() {
        out.ignored.push((name.to_string(), reason.to_string()));
    }
    // What is read from disk is bounded too: the backup zip holds it.
    let mut disk_budget = MAX_TOTAL_BYTES;
    for (entry, member, bytes) in read {
        if *member == Member::Manifest {
            continue;
        }
        let name = entry.name.as_str();
        let mut ignore = |reason: &str| out.ignored.push((name.to_string(), reason.to_string()));
        // The content first: what would never be written is not looked up on disk.
        let content_ok = match member {
            Member::Settings | Member::Keybindings | Member::Machines => {
                matches!(
                    serde_json::from_slice::<Value>(&bytes),
                    Ok(Value::Object(_))
                )
            }
            Member::Profile(_)
            | Member::Code(_)
            | Member::Package {
                part: PackagePart::Manifest | PackagePart::Profile(_) | PackagePart::Code(_),
                ..
            } => crate::userfiles::check_object(&bytes).is_ok(),
            Member::Script { .. }
            | Member::Package {
                part: PackagePart::Script { .. },
                ..
            } => is_script_text(&bytes),
            Member::Manifest => false,
        };
        if !content_ok {
            ignore(if member.is_runnable() {
                "not-text"
            } else {
                "not-json-object"
            });
            continue;
        }
        let segments: Vec<&str> = name.split('/').collect();
        let path = join_segments(&dirs.config, &segments);
        let current = match on_disk(&dirs.config, &segments) {
            OnDisk::Missing => None,
            OnDisk::Skip(reason) => {
                ignore(reason);
                continue;
            }
            OnDisk::File => match crate::userfiles::read_regular_max(
                &path,
                MAX_ENTRY_BYTES.min(disk_budget),
                "too big",
            ) {
                Ok(current) => {
                    disk_budget -= current.len() as u64;
                    Some(current)
                }
                Err(err) if err == "too big" => {
                    ignore("too-big-on-disk");
                    continue;
                }
                Err(_) => {
                    ignore("unreadable");
                    continue;
                }
            },
        };
        let merged = match member {
            Member::Settings => {
                let zip_object = as_map(&bytes);
                match current_json(current.as_deref(), crate::config::SETTINGS_VERSION) {
                    Ok(cur) => {
                        let (merged, kept) = merge_settings(&zip_object, &cur);
                        out.kept_settings = kept;
                        Some(merged)
                    }
                    Err(reason) => {
                        ignore(reason);
                        continue;
                    }
                }
            }
            Member::Keybindings => {
                let zip_object = as_map(&bytes);
                match current_json(current.as_deref(), crate::keybindings::KEYBINDINGS_VERSION)
                    .and_then(|cur| merge_keybindings(&zip_object, &cur))
                {
                    Ok(merged) => Some(merged),
                    Err(reason) => {
                        ignore(reason);
                        continue;
                    }
                }
            }
            Member::Machines => {
                let zip_object = as_map(&bytes);
                match current_json(current.as_deref(), crate::machines::MACHINES_VERSION)
                    .and_then(|cur| merge_machines(&zip_object, &cur))
                {
                    Ok(merged) => Some(merged),
                    Err(reason) => {
                        ignore(reason);
                        continue;
                    }
                }
            }
            _ => None,
        };
        let planned = match merged {
            Some(merged) => {
                if merged.bytes.len() as u64 > MAX_ENTRY_BYTES {
                    ignore("merged-too-big");
                    continue;
                }
                let action = match (&current, merged.same) {
                    (None, _) => FileAction::New,
                    (Some(_), true) => FileAction::Same,
                    (Some(_), false) => FileAction::Replace,
                };
                Planned {
                    member: member.clone(),
                    group: member.group().unwrap_or_default(),
                    path: name.to_string(),
                    bytes: merged.bytes,
                    current,
                    action,
                    items: merged.items,
                    notes: merged.notes,
                }
            }
            None => {
                let action = match &current {
                    None => FileAction::New,
                    Some(old) if *old == bytes => FileAction::Same,
                    Some(_) => FileAction::Replace,
                };
                Planned {
                    member: member.clone(),
                    group: member.group().unwrap_or_default(),
                    path: name.to_string(),
                    bytes,
                    current,
                    action,
                    items: Vec::new(),
                    notes: Vec::new(),
                }
            }
        };
        out.files.push(planned);
    }
    out.files.sort_by(|a, b| {
        (group_rank(&a.member), &a.group, &a.path).cmp(&(group_rank(&b.member), &b.group, &b.path))
    });
    Ok(out)
}

fn as_map(bytes: &[u8]) -> Map<String, Value> {
    match serde_json::from_slice::<Value>(bytes) {
        Ok(Value::Object(object)) => object,
        _ => Map::new(),
    }
}

impl Plan {
    /// The groups in preview order, each with its files and whether it holds code.
    fn groups(&self) -> Vec<ImportGroup> {
        let mut groups: Vec<ImportGroup> = Vec::new();
        for file in &self.files {
            if groups.last().map(|g| g.id.as_str()) != Some(file.group.as_str()) {
                groups.push(ImportGroup {
                    id: file.group.clone(),
                    runnable: false,
                    files: Vec::new(),
                });
            }
            let group = groups.last_mut().expect("pushed above");
            group.runnable |= file.member.is_runnable();
            group.files.push(ImportFile {
                path: file.path.clone(),
                action: file.action,
                bytes: file.bytes.len() as u64,
                items: file.items.clone(),
                notes: file.notes.clone(),
            });
        }
        groups
    }
}

// ---------------------------------------------------------------------------
// Writing a zip (export and the backup)
// ---------------------------------------------------------------------------

/// A zip of `manifest` and `files`, deflated, every date the zip epoch (equal content, equal
/// bytes), plain file mode.
fn write_zip(manifest: &[u8], files: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .last_modified_time(zip::DateTime::default())
        .unix_permissions(0o644);
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let mut put = |name: &str, bytes: &[u8]| -> zip::result::ZipResult<()> {
        writer.start_file(name, options)?;
        writer.write_all(bytes)?;
        Ok(())
    };
    put(MANIFEST_NAME, manifest).map_err(|err| format!("the zip could not be built: {err}"))?;
    for (name, bytes) in files {
        put(name, bytes).map_err(|err| format!("the zip could not be built: {err}"))?;
    }
    writer
        .finish()
        .map(Cursor::into_inner)
        .map_err(|err| format!("the zip could not be built: {err}"))
}

/// The manifest of a zip gEdit writes (rule 16).
fn manifest_bytes(
    app_version: &str,
    created: &str,
    counts: Map<String, Value>,
    omitted: &[String],
    skipped: &[Skipped],
) -> Vec<u8> {
    let mut object = Map::new();
    object.insert("format".into(), Value::from(FORMAT));
    object.insert("app".into(), Value::from("gEdit"));
    object.insert("version".into(), Value::from(app_version));
    object.insert("created".into(), Value::from(created));
    object.insert("platform".into(), Value::from(std::env::consts::OS));
    object.insert("counts".into(), Value::Object(counts));
    object.insert(
        "omitted".into(),
        Value::Array(omitted.iter().map(|k| Value::from(k.as_str())).collect()),
    );
    object.insert(
        "skipped".into(),
        Value::Array(
            skipped
                .iter()
                .take(MAX_SKIPPED_IN_MANIFEST)
                .map(|s| serde_json::json!({ "path": s.path, "reason": s.reason }))
                .collect(),
        ),
    );
    if skipped.len() > MAX_SKIPPED_IN_MANIFEST {
        object.insert("skippedCount".into(), Value::from(skipped.len()));
    }
    pretty(&object)
}

// ---------------------------------------------------------------------------
// Export (rules 16–20)
// ---------------------------------------------------------------------------

/// The files an export collects, under the import's own limits.
#[derive(Default)]
struct Collector {
    files: Vec<(String, Vec<u8>)>,
    skipped: Vec<Skipped>,
    total: u64,
    /// A bound on the size of the zip: every file's bytes plus deflate's worst case and the
    /// headers, so the archive never passes [`MAX_ARCHIVE_BYTES`].
    estimate: u64,
    omitted: Vec<String>,
    /// The [`duplicate_key`] of every entry admitted so far.
    seen: HashSet<String>,
}

/// What the manifest and the headers may take of the 16 MiB.
const ARCHIVE_RESERVE: u64 = 256 * 1024;

impl Collector {
    fn skip(&mut self, path: &str, reason: &str) {
        self.skipped.push(Skipped {
            path: path.to_string(),
            reason: reason.to_string(),
        });
    }

    /// Whether `name` is an entry the import reads, else skipped with the reason.
    fn admits(&mut self, name: &str) -> Option<Member> {
        if let Err(reason) = check_shape(name) {
            let reason = serde_json::to_value(reason)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default();
            self.skip(name, &format!("a name the import refuses ({reason})"));
            return None;
        }
        match classify(name) {
            Classified::Member(member) => {
                if !self.seen.insert(duplicate_key(name)) {
                    self.skip(name, "duplicate");
                    return None;
                }
                Some(member)
            }
            Classified::Ignored("system-file") => None,
            Classified::Ignored(reason) => {
                self.skip(name, reason);
                None
            }
        }
    }

    /// Reads `path` as entry `name` when the import would take it, and adds it.
    fn take(&mut self, name: &str, path: &Path) {
        let Some(member) = self.admits(name) else {
            return;
        };
        let bytes =
            match crate::userfiles::read_regular_max(path, MAX_ENTRY_BYTES, "larger than 1 MiB") {
                Ok(bytes) => bytes,
                Err(reason) => {
                    self.skip(name, &reason);
                    return;
                }
            };
        let bytes = match member {
            Member::Settings => match serde_json::from_slice::<Value>(&bytes) {
                Ok(Value::Object(mut object)) => {
                    for key in MACHINE_SPECIFIC_KEYS {
                        if object.remove(key).is_some() {
                            self.omitted.push(key.to_string());
                        }
                    }
                    pretty(&object)
                }
                _ => {
                    self.skip(name, "not a JSON object");
                    return;
                }
            },
            ref m if m.is_runnable() => {
                if !is_script_text(&bytes) {
                    self.skip(name, "not UTF-8 text");
                    return;
                }
                bytes
            }
            _ => {
                if let Err(reason) = crate::userfiles::check_object(&bytes) {
                    self.skip(name, &reason);
                    return;
                }
                bytes
            }
        };
        self.add(name, bytes);
    }

    fn add(&mut self, name: &str, bytes: Vec<u8>) {
        let len = bytes.len() as u64;
        if self.files.len() + 1 >= MAX_ENTRIES {
            self.skip(name, "more than 2,000 files");
            return;
        }
        if self.total + len > MAX_TOTAL_BYTES {
            self.skip(name, "the files together would pass 32 MiB");
            return;
        }
        let estimate = len + len / 1000 + 64 + 200 + 2 * name.len() as u64;
        if self.estimate + estimate > MAX_ARCHIVE_BYTES - ARCHIVE_RESERVE {
            self.skip(name, "the zip would pass 16 MiB");
            return;
        }
        self.total += len;
        self.estimate += estimate;
        self.files.push((name.to_string(), bytes));
    }

    /// The names of a folder, sorted; `None` when it does not exist. A folder that is a link is
    /// not listed (skipped with the reason); hidden names, `__pycache__` and `.bak` files are
    /// passed over in silence.
    fn list(&mut self, entry: &str, dir: &Path) -> Option<Vec<(String, bool)>> {
        match std::fs::symlink_metadata(dir) {
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
            Err(err) => {
                self.skip(entry, crate::userfiles::why(&err));
                return None;
            }
            Ok(meta) if is_link(&meta) => {
                self.skip(entry, "a link, not followed");
                return None;
            }
            Ok(meta) if !meta.is_dir() => {
                self.skip(entry, "not a folder");
                return None;
            }
            Ok(_) => {}
        }
        let read = match std::fs::read_dir(dir) {
            Ok(read) => read,
            Err(err) => {
                self.skip(entry, crate::userfiles::why(&err));
                return None;
            }
        };
        let mut names = Vec::new();
        for item in read.filter_map(Result::ok) {
            let Ok(name) = item.file_name().into_string() else {
                self.skip(entry, "a name that is not readable text");
                continue;
            };
            if name.starts_with('.') || name == "__pycache__" || name.ends_with(".bak") {
                continue;
            }
            let is_dir = std::fs::symlink_metadata(item.path())
                .map(|meta| meta.is_dir() && !is_link(&meta))
                .unwrap_or(false);
            names.push((name, is_dir));
        }
        names.sort();
        Some(names)
    }

    /// `<folder>/*.json` (profiles or codes, of the user or a package).
    fn json_folder(&mut self, prefix: &str, dir: &Path) {
        for (name, is_dir) in self
            .list(prefix.trim_end_matches('/'), dir)
            .unwrap_or_default()
        {
            let entry = format!("{prefix}{name}");
            if is_dir {
                self.skip(&entry, "outside-layout");
            } else {
                self.take(&entry, &dir.join(&name));
            }
        }
    }

    /// `<folder>/[<group>/]<name>.py`.
    fn script_folder(&mut self, prefix: &str, dir: &Path) {
        for (name, is_dir) in self
            .list(prefix.trim_end_matches('/'), dir)
            .unwrap_or_default()
        {
            let entry = format!("{prefix}{name}");
            if !is_dir {
                self.take(&entry, &dir.join(&name));
                continue;
            }
            let group_dir = dir.join(&name);
            for (file, inner_dir) in self.list(&entry, &group_dir).unwrap_or_default() {
                let inner = format!("{entry}/{file}");
                if inner_dir {
                    self.skip(&inner, "outside-layout");
                } else {
                    self.take(&inner, &group_dir.join(&file));
                }
            }
        }
    }
}

/// Whether `dest` is inside `config` (the export must not include itself). Both are compared
/// after resolving what exists of them, case folded where the file system folds it.
fn inside(config: &Path, dest: &Path) -> bool {
    let resolve = |path: &Path| -> PathBuf {
        let mut probe = path.to_path_buf();
        let mut rest: Vec<std::ffi::OsString> = Vec::new();
        loop {
            if let Ok(real) = std::fs::canonicalize(&probe) {
                let mut out = real;
                for part in rest.iter().rev() {
                    out.push(part);
                }
                return out;
            }
            match (probe.file_name().map(|n| n.to_os_string()), probe.parent()) {
                (Some(name), Some(parent)) => {
                    rest.push(name);
                    probe = parent.to_path_buf();
                }
                _ => return path.to_path_buf(),
            }
        }
    };
    let fold = |path: PathBuf| -> String {
        let text = path.to_string_lossy().into_owned();
        if paths::FOLD_CASE {
            text.to_lowercase()
        } else {
            text
        }
    };
    let config = fold(resolve(config));
    let dest = fold(resolve(dest));
    let sep = std::path::MAIN_SEPARATOR;
    dest == config || dest.starts_with(&format!("{}{sep}", config.trim_end_matches(sep)))
}

/// Writes the configuration of `dirs` to the zip at `dest` (§6.9 rules 16–20).
pub fn export(dirs: &AppDirs, dest: &Path, app_version: &str) -> Result<ExportResult, String> {
    let text = dest.to_string_lossy();
    if text.contains('\0') || !dest.is_absolute() {
        return Err("not an absolute path".into());
    }
    if dest
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("path is not a plain absolute path".into());
    }
    if inside(&dirs.config, dest) {
        return Err("the zip cannot be saved inside the configuration folder".into());
    }

    let config = &dirs.config;
    let mut c = Collector::default();
    for name in [
        paths::SETTINGS_FILE_NAME,
        paths::KEYBINDINGS_FILE_NAME,
        paths::MACHINES_FILE_NAME,
    ] {
        let path = config.join(name);
        if std::fs::symlink_metadata(&path).is_ok() {
            c.take(name, &path);
        }
    }
    c.json_folder("profiles/", &dirs.profiles_dir());
    c.json_folder("codes/", &dirs.codes_dir());
    c.script_folder("scripts/", &dirs.user_scripts_dir());
    let packages_dir = dirs.packages_dir();
    let mut packages = 0usize;
    for (package, is_dir) in c.list("packages", &packages_dir).unwrap_or_default() {
        let base = format!("packages/{package}");
        if !is_dir {
            c.skip(&base, "outside-layout");
            continue;
        }
        if let Some(reason) = crate::packages::validate_package_name(&package) {
            c.skip(&base, reason);
            continue;
        }
        let before = c.files.len();
        let dir = packages_dir.join(&package);
        for (name, inner_dir) in c.list(&base, &dir).unwrap_or_default() {
            let entry = format!("{base}/{name}");
            match (name.as_str(), inner_dir) {
                ("profiles" | "codes", true) => {
                    c.json_folder(&format!("{entry}/"), &dir.join(&name))
                }
                ("scripts", true) => c.script_folder(&format!("{entry}/"), &dir.join(&name)),
                (_, false) => c.take(&entry, &dir.join(&name)),
                (_, true) => c.skip(&entry, "outside-layout"),
            }
        }
        if c.files.len() > before {
            packages += 1;
        }
    }

    let created = iso_utc(now_secs());
    let count = |c: &Collector, f: &dyn Fn(&Member) -> bool| -> usize {
        c.files
            .iter()
            .filter(|(name, _)| matches!(classify(name), Classified::Member(ref m) if f(m)))
            .count()
    };
    // The import is the judge: what it would refuse is dropped and listed, and the zip is built
    // again (a name twice once case is folded on a file system that does not fold it, an entry
    // that compresses past 200 : 1).
    for _round in 0..3 {
        let mut counts = Map::new();
        counts.insert(
            "settings".into(),
            Value::from(count(&c, &|m| *m == Member::Settings)),
        );
        counts.insert(
            "keys".into(),
            Value::from(count(&c, &|m| *m == Member::Keybindings)),
        );
        counts.insert(
            "machines".into(),
            Value::from(count(&c, &|m| *m == Member::Machines)),
        );
        counts.insert(
            "profiles".into(),
            Value::from(count(&c, &|m| matches!(m, Member::Profile(_)))),
        );
        counts.insert(
            "codes".into(),
            Value::from(count(&c, &|m| matches!(m, Member::Code(_)))),
        );
        counts.insert(
            "scripts".into(),
            Value::from(count(&c, &|m| matches!(m, Member::Script { .. }))),
        );
        counts.insert("packages".into(), Value::from(packages));
        let manifest = manifest_bytes(app_version, &created, counts, &c.omitted, &c.skipped);
        let bytes = write_zip(&manifest, &c.files)?;
        match inventory(&bytes) {
            Ok(_) => {
                crate::atomic::write_atomic(dest, &bytes).map_err(|err| {
                    format!(
                        "the zip could not be written: {}",
                        crate::userfiles::why(&err)
                    )
                })?;
                return Ok(ExportResult {
                    files: c.files.len(),
                    bytes: bytes.len() as u64,
                    skipped: c.skipped,
                });
            }
            Err(refusals)
                if refusals
                    .iter()
                    .all(|r| !r.path.is_empty() && r.path != MANIFEST_NAME) =>
            {
                for refusal in refusals {
                    c.files.retain(|(name, _)| *name != refusal.path);
                    c.skip(&refusal.path, &refusal_text(std::slice::from_ref(&refusal)));
                }
            }
            Err(refusals) => return Err(refusal_text(&refusals)),
        }
    }
    Err("the zip could not be built within the import's limits".into())
}

// ---------------------------------------------------------------------------
// Preview (rules 21–27)
// ---------------------------------------------------------------------------

/// Reads the archive and says what an import would do; writes nothing and grants nothing
/// (§6.9 rules 21–27).
pub fn preview(dirs: &AppDirs, archive: &[u8]) -> Result<ImportPreview, String> {
    let refused = |refusals: Vec<Refusal>| ImportPreview {
        ok: false,
        refusals,
        ..ImportPreview::default()
    };
    let inv = match inventory(archive) {
        Ok(inv) => inv,
        Err(refusals) => return Ok(refused(refusals)),
    };
    let plan = match plan(dirs, archive, &inv) {
        Ok(plan) => plan,
        Err(refusals) => return Ok(refused(refusals)),
    };
    let groups = plan.groups();
    let ignored_count = plan.ignored.len() + plan.system_files;
    Ok(ImportPreview {
        ok: true,
        fingerprint: fingerprint(archive),
        manifest: plan.manifest,
        needs_trust: groups.iter().any(|g| g.runnable),
        groups,
        ignored: plan
            .ignored
            .iter()
            .take(MAX_REFUSALS_LISTED)
            .map(|(path, reason)| format!("{path}: {reason}"))
            .collect(),
        ignored_count,
        refusals: Vec::new(),
        kept_settings: plan.kept_settings,
    })
}

// ---------------------------------------------------------------------------
// Apply (rules 28–33)
// ---------------------------------------------------------------------------

/// Whether `name` is a backup zip this module wrote: `before-import-<8 digits>-<6 digits>` with an
/// optional `-<n>`, `.zip`. Answers the sort key.
fn backup_key(name: &str) -> Option<(String, u64)> {
    let body = name.strip_prefix(BACKUP_PREFIX)?.strip_suffix(".zip")?;
    let (stamp, n) = match body.get(15..) {
        Some("") => (body, 0),
        Some(rest) => (&body[..15], rest.strip_prefix('-')?.parse::<u64>().ok()?),
        None => return None,
    };
    let bytes = stamp.as_bytes();
    let ok = bytes.len() == 15
        && bytes[8] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 8 || b.is_ascii_digit());
    ok.then(|| (stamp.to_string(), n))
}

/// Writes the backup zip of `replaced` to `<data>/import-backups` and keeps the last
/// [`MAX_IMPORT_BACKUPS`]. Answers the file name.
fn write_backup(dirs: &AppDirs, replaced: &[&Planned], secs: u64) -> Result<String, String> {
    let dir = dirs.import_backups_dir();
    std::fs::create_dir_all(&dir).map_err(|err| crate::userfiles::why(&err).to_string())?;
    match std::fs::symlink_metadata(&dir) {
        Ok(meta) if meta.is_dir() && !is_link(&meta) => {}
        Ok(_) => return Err("the backup folder is a link or not a folder".into()),
        Err(err) => return Err(crate::userfiles::why(&err).to_string()),
    }
    let _ = paths::restrict(&dir);
    let files: Vec<(String, Vec<u8>)> = replaced
        .iter()
        .filter_map(|f| f.current.clone().map(|old| (f.path.clone(), old)))
        .collect();
    let mut counts = Map::new();
    counts.insert("files".into(), Value::from(files.len()));
    let manifest = manifest_bytes(env!("CARGO_PKG_VERSION"), &iso_utc(secs), counts, &[], &[]);
    let bytes = write_zip(&manifest, &files)?;
    let stamp = stamp_utc(secs);
    let mut n = 0u32;
    let name = loop {
        let name = if n == 0 {
            format!("{BACKUP_PREFIX}{stamp}.zip")
        } else {
            format!("{BACKUP_PREFIX}{stamp}-{n}.zip")
        };
        if std::fs::symlink_metadata(dir.join(&name)).is_err() {
            break name;
        }
        n += 1;
    };
    crate::atomic::write_atomic(&dir.join(&name), &bytes)
        .map_err(|err| crate::userfiles::why(&err).to_string())?;
    prune_backups(&dir, &name);
    Ok(name)
}

/// Removes the oldest backup zips so that [`MAX_IMPORT_BACKUPS`] remain, `keep` (the file just
/// written, the undo of this import) among them whatever its date says: a clock that ran ahead
/// and was corrected leaves newer-dated backups behind, and those must not cost the new one its
/// place. Only plain files of the backup name pattern are ever removed.
fn prune_backups(dir: &Path, keep: &str) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    let mut found: Vec<((String, u64), PathBuf)> = read
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            if name == keep {
                return None;
            }
            let key = backup_key(&name)?;
            let meta = std::fs::symlink_metadata(entry.path()).ok()?;
            (meta.is_file() && !is_link(&meta)).then(|| (key, entry.path()))
        })
        .collect();
    found.sort();
    let excess = found.len().saturating_sub(MAX_IMPORT_BACKUPS - 1);
    for (_, path) in found.into_iter().take(excess) {
        let _ = std::fs::remove_file(path);
    }
}

/// Applies the selected groups: re-reads the archive, compares the fingerprint, writes the backup
/// zip, stages, then swaps (§6.9 rules 28–36).
pub fn apply(
    dirs: &AppDirs,
    archive: &[u8],
    fingerprint: &str,
    groups: &[String],
    accept_scripts: bool,
) -> Result<ImportResult, String> {
    apply_with(
        dirs,
        archive,
        fingerprint,
        groups,
        accept_scripts,
        now_secs(),
        &mut |path, bytes| crate::atomic::write_atomic(path, bytes),
    )
}

/// The writer apply uses for the configuration files; a test hands in one that fails.
type Writer<'a> = dyn FnMut(&Path, &[u8]) -> std::io::Result<()> + 'a;

/// [`apply`] with the clock and the writer handed in.
fn apply_with(
    dirs: &AppDirs,
    archive: &[u8],
    expected: &str,
    groups: &[String],
    accept_scripts: bool,
    secs: u64,
    write: &mut Writer<'_>,
) -> Result<ImportResult, String> {
    // 1. The archive again, under every rule of the preview.
    let inv = inventory(archive).map_err(|refusals| refusal_text(&refusals))?;
    // 2. The same archive as the preview read.
    if self::fingerprint(archive) != expected {
        return Err(CHANGED.into());
    }
    // 3. Every entry read and checked again, the merges built, in memory.
    let plan = plan(dirs, archive, &inv).map_err(|refusals| refusal_text(&refusals))?;
    // 4. The selection names groups of this archive.
    let known: HashSet<&str> = plan.files.iter().map(|f| f.group.as_str()).collect();
    if let Some(unknown) = groups.iter().find(|g| !known.contains(g.as_str())) {
        return Err(format!("{unknown:?} is not a group of this file"));
    }
    let selected: Vec<&Planned> = plan
        .files
        .iter()
        .filter(|f| groups.contains(&f.group))
        .collect();
    // 5. Code needs the user's trust, whatever the webview did.
    if !accept_scripts && selected.iter().any(|f| f.member.is_runnable()) {
        return Err(
            "scripts and packages with scripts are imported only when you trust the file".into(),
        );
    }
    let unchanged = selected
        .iter()
        .filter(|f| f.action == FileAction::Same)
        .count();
    let mut to_write: Vec<&Planned> = selected
        .into_iter()
        .filter(|f| f.action != FileAction::Same)
        .collect();
    to_write
        .sort_by(|a, b| (write_rank(&a.member), &a.path).cmp(&(write_rank(&b.member), &b.path)));
    if to_write.is_empty() {
        return Ok(ImportResult {
            written: 0,
            unchanged,
            backup: None,
        });
    }
    // 6. The backup before the first write; without it nothing is imported.
    let replaced: Vec<&Planned> = to_write
        .iter()
        .copied()
        .filter(|f| f.current.is_some())
        .collect();
    let backup = if replaced.is_empty() {
        None
    } else {
        Some(write_backup(dirs, &replaced, secs).map_err(|err| {
            format!("the backup could not be written ({err}), so nothing was imported")
        })?)
    };
    // 7. Swap, in order; a failure puts back what was already written.
    let mut done: Vec<&Planned> = Vec::new();
    // The folders this apply created on the way to a new file, parents first.
    let mut created: Vec<PathBuf> = Vec::new();
    for file in &to_write {
        let segments: Vec<&str> = file.path.split('/').collect();
        let path = join_segments(&dirs.config, &segments);
        let state = on_disk(&dirs.config, &segments);
        let expected_state = if file.current.is_some() {
            OnDisk::File
        } else {
            OnDisk::Missing
        };
        let result = if state == expected_state {
            note_new_folders(&dirs.config, &segments, &mut created);
            write(&path, &file.bytes).map_err(|err| crate::userfiles::why(&err).to_string())
        } else {
            Err("changed on disk during the import".to_string())
        };
        if let Err(why) = result {
            let failed = rollback(dirs, &done, &created, write);
            let mut message = format!("{} could not be written ({why})", file.path);
            if failed.is_empty() {
                message.push_str("; the files already written were put back");
            } else {
                message.push_str(&format!(
                    "; these could not be put back: {}",
                    failed.join(", ")
                ));
            }
            if let Some(name) = &backup {
                message.push_str(&format!("; the backup is {name}"));
            }
            return Err(message);
        }
        done.push(file);
    }
    Ok(ImportResult {
        written: done.len(),
        unchanged,
        backup,
    })
}

/// Adds to `created` the folders on the way to the file `segments` (below `base`) that do not
/// exist yet, parents first, before the writer makes them.
fn note_new_folders(base: &Path, segments: &[&str], created: &mut Vec<PathBuf>) {
    let mut path = base.to_path_buf();
    for segment in &segments[..segments.len().saturating_sub(1)] {
        path.push(segment);
        if std::fs::symlink_metadata(&path).is_err() && !created.contains(&path) {
            created.push(path.clone());
        }
    }
}

/// Puts back the files of `done`, newest first: a replaced file gets its old bytes, a new file
/// is removed again (it did not exist before this import). Then the folders in `created` (made
/// by this import) go, deepest first and only while empty: a folder that was there before, or
/// holds anything else, stays. Answers what could not be put back.
fn rollback(
    dirs: &AppDirs,
    done: &[&Planned],
    created: &[PathBuf],
    write: &mut Writer<'_>,
) -> Vec<String> {
    let mut failed = Vec::new();
    for file in done.iter().rev() {
        let segments: Vec<&str> = file.path.split('/').collect();
        let path = join_segments(&dirs.config, &segments);
        let result = match &file.current {
            Some(old) => write(&path, old),
            None => std::fs::remove_file(&path),
        };
        if result.is_err() {
            failed.push(file.path.clone());
        }
    }
    for folder in created.iter().rev() {
        let _ = std::fs::remove_dir(folder);
    }
    failed
}

/// "Export Configuration": writes the zip to `dest`, a path the user picked in the save dialog.
#[tauri::command]
pub async fn config_export(app: AppHandle, dest: String) -> Result<ExportResult, String> {
    let dirs = paths::app_dirs(&app)?;
    let scope = app.fs_scope();
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        if !scope.is_allowed(Path::new(&dest)) {
            return Err("path is not allowed".to_string());
        }
        export(&dirs, Path::new(&dest), &version)
    })
    .await
    .map_err(|_| "the export stopped unexpectedly".to_string())?
}

/// "Import Configuration", step 1: what the zip at `src` (a file the user picked in the open
/// dialog) would do. Writes nothing.
#[tauri::command]
pub async fn config_import_preview(app: AppHandle, src: String) -> Result<ImportPreview, String> {
    let dirs = paths::app_dirs(&app)?;
    let scope = app.fs_scope();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_archive_file(&src, |path| scope.is_allowed(path))?;
        preview(&dirs, &bytes)
    })
    .await
    .map_err(|_| "the preview stopped unexpectedly".to_string())?
}

/// "Import Configuration", step 2: applies the groups the user left ticked. `fingerprint` is
/// the preview's; `accept_scripts` is the user's trust, required when a selected group is
/// runnable.
#[tauri::command]
pub async fn config_import_apply(
    app: AppHandle,
    src: String,
    fingerprint: String,
    groups: Vec<String>,
    accept_scripts: bool,
) -> Result<ImportResult, String> {
    let dirs = paths::app_dirs(&app)?;
    let scope = app.fs_scope();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_archive_file(&src, |path| scope.is_allowed(path))?;
        apply(&dirs, &bytes, &fingerprint, &groups, accept_scripts)
    })
    .await
    .map_err(|_| "the import stopped unexpectedly".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source_scan;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    fn stored() -> SimpleFileOptions {
        SimpleFileOptions::default().compression_method(CompressionMethod::Stored)
    }

    fn deflated() -> SimpleFileOptions {
        SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
    }

    /// An archive with the given (name, bytes) entries, deflated, in order.
    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            writer.start_file(*name, deflated()).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn refused(bytes: &[u8]) -> Vec<(String, RefusalReason)> {
        match inventory(bytes) {
            Ok(_) => Vec::new(),
            Err(list) => list.into_iter().map(|r| (r.path, r.reason)).collect(),
        }
    }

    // --- the shape of a name ---

    #[test]
    fn a_name_that_leaves_the_folder_is_refused_in_every_spelling() {
        use RefusalReason::*;
        for (name, reason) in [
            ("../settings.json", ParentDir),
            ("profiles/../../x.json", ParentDir),
            ("a/b/../c", ParentDir),
            ("/etc/passwd", Absolute),
            ("C:/Windows/x", Colon),
            ("C:x", Colon),
            ("profiles/lathe.json:stream", Colon),
            ("..\\x", Backslash),
            ("profiles\\lathe.json", Backslash),
            ("profiles//lathe.json", EmptySegment),
            ("", EmptySegment),
            ("./settings.json", BadSegment),
            ("profiles/./a.json", BadSegment),
            ("scripts/a.py.", BadSegment),
            ("scripts/a.py ", BadSegment),
            ("scripts/a?.py", BadSegment),
            ("scripts/con.py", BadSegment),
            ("scripts/a\u{0}.py", Control),
            ("scripts/a\n.py", Control),
            ("a/b/c/d/e/f.py", TooDeep),
        ] {
            assert_eq!(check_shape(name), Err(reason), "{name:?}");
        }
        let long = format!("scripts/{}.py", "a".repeat(MAX_NAME_BYTES));
        assert_eq!(check_shape(&long), Err(NameTooLong));
    }

    #[test]
    fn the_names_gedit_writes_pass_the_shape_check() {
        for name in [
            "gedit-config.json",
            "profiles/",
            "profiles/lathe-shop.json",
            "scripts/finish/chamfer.py",
            "packages/shop-a/scripts/finish/chamfer.py",
            "packages/shop-a/package.json",
        ] {
            assert_eq!(check_shape(name), Ok(()), "{name}");
        }
    }

    // --- the layout ---

    fn member(name: &str) -> Member {
        match classify(name) {
            Classified::Member(member) => member,
            other => panic!("{name}: {other:?}"),
        }
    }

    #[test]
    fn the_layout_is_the_config_folder() {
        assert_eq!(member("settings.json"), Member::Settings);
        assert_eq!(member("keybindings.json"), Member::Keybindings);
        assert_eq!(member("machines.json"), Member::Machines);
        assert_eq!(member("gedit-config.json"), Member::Manifest);
        assert_eq!(member("profiles/a.json"), Member::Profile("a.json".into()));
        assert_eq!(member("codes/a.json"), Member::Code("a.json".into()));
        assert_eq!(
            member("scripts/x.py"),
            Member::Script {
                group: None,
                name: "x.py".into()
            }
        );
        assert_eq!(
            member("scripts/g/x.py"),
            Member::Script {
                group: Some("g".into()),
                name: "x.py".into()
            }
        );
        assert_eq!(
            member("packages/shop/scripts/g/x.py"),
            Member::Package {
                package: "shop".into(),
                part: PackagePart::Script {
                    group: Some("g".into()),
                    name: "x.py".into()
                }
            }
        );
        assert_eq!(
            member("packages/shop/profiles/p.json"),
            Member::Package {
                package: "shop".into(),
                part: PackagePart::Profile("p.json".into())
            }
        );
        assert_eq!(
            member("packages/shop/package.json"),
            Member::Package {
                package: "shop".into(),
                part: PackagePart::Manifest
            }
        );
    }

    #[test]
    fn what_is_not_a_configuration_file_is_ignored_with_a_reason_not_written() {
        for (name, reason) in [
            ("readme.txt", "outside-layout"),
            ("state.json", "outside-layout"),
            ("backups/a.json", "outside-layout"),
            (".window-state.json", "outside-layout"),
            ("profiles/Lathe.json", "name-not-allowed"),
            ("profiles/a.txt", "name-not-allowed"),
            ("profiles/sub/a.json", "outside-layout"),
            ("scripts/gedit_nc.py", "reserved-name"),
            ("scripts/x.txt", "name-not-allowed"),
            ("scripts/.hidden.py", "name-not-allowed"),
            ("scripts/a/b/c.py", "outside-layout"),
            ("scripts/__pycache__/x.pyc", "name-not-allowed"),
            ("packages/Shop/package.json", "name-not-allowed"),
            ("packages/shop/readme.md", "outside-layout"),
            ("packages/shop/profiles/Bad.json", "name-not-allowed"),
            ("__MACOSX/._settings.json", "system-file"),
            ("profiles/.DS_Store", "system-file"),
            ("Thumbs.db", "system-file"),
            ("nested.zip", "outside-layout"),
        ] {
            assert_eq!(classify(name), Classified::Ignored(reason), "{name}");
        }
    }

    #[test]
    fn the_library_name_is_reserved_as_a_script_group_too() {
        for name in [
            "scripts/gedit_nc/__init__.py",
            "scripts/gedit_nc/x.py",
            "scripts/GEDIT_NC/x.py",
            "packages/p/scripts/gedit_nc/__init__.py",
        ] {
            assert_eq!(
                classify(name),
                Classified::Ignored("reserved-name"),
                "{name}"
            );
        }
        // Helper modules of the user's own stay members, and export keeps them.
        for name in [
            "scripts/_common.py",
            "scripts/lib/__init__.py",
            "scripts/gedit_nc_tools/x.py",
            "packages/p/scripts/lib/__init__.py",
        ] {
            assert!(matches!(classify(name), Classified::Member(_)), "{name}");
        }
    }

    #[test]
    fn a_name_with_a_bidi_zero_width_or_format_character_is_ignored_and_does_not_refuse_the_archive(
    ) {
        for name in [
            "scripts/evil\u{202E}py.py",
            "scripts/a\u{200B}b.py",
            "scripts/\u{FEFF}x.py",
            "scripts/grp\u{2066}/x.py",
            "scripts/ok/x\u{00AD}.py",
            "packages/p/scripts/a\u{2028}b.py",
            "packages/p/scripts/g\u{061C}/x.py",
        ] {
            assert_eq!(
                classify(name),
                Classified::Ignored("name-not-allowed"),
                "{name:?}"
            );
        }
        let bytes = archive(&[
            (MANIFEST_NAME, b"{}"),
            ("scripts/ok.py", b"x = 1\n"),
            ("scripts/evil\u{202E}py.py", b"x = 1\n"),
            ("scripts/a\u{200B}b.py", b"x = 1\n"),
        ]);
        let inv = inventory(&bytes).unwrap();
        assert_eq!(inv.members().count(), 2, "the manifest and ok.py");
        assert_eq!(inv.ignored().len(), 2);
    }

    #[test]
    fn scripts_and_package_scripts_are_the_runnable_members() {
        assert!(member("scripts/x.py").is_runnable());
        assert!(member("packages/shop/scripts/x.py").is_runnable());
        for name in [
            "settings.json",
            "profiles/a.json",
            "packages/shop/codes/a.json",
            "packages/shop/package.json",
        ] {
            assert!(!member(name).is_runnable(), "{name}");
        }
        assert_eq!(
            member("packages/shop/codes/a.json").group().as_deref(),
            Some("package:shop")
        );
        assert_eq!(member("gedit-config.json").group(), None);
    }

    // --- the gate on one entry ---

    fn file_meta() -> EntryMeta {
        EntryMeta {
            is_dir: false,
            unix_mode: Some(0o100_644),
            encrypted: false,
            method: Method::Deflated,
            size: 1000,
            compressed: 400,
        }
    }

    #[test]
    fn a_plain_entry_passes_the_gate() {
        assert_eq!(check_entry(&file_meta()), Ok(()));
        assert_eq!(
            check_entry(&EntryMeta {
                unix_mode: None,
                ..file_meta()
            }),
            Ok(())
        );
        assert_eq!(
            check_entry(&EntryMeta {
                method: Method::Stored,
                ..file_meta()
            }),
            Ok(())
        );
    }

    #[test]
    fn links_and_special_files_are_refused_whatever_they_hold() {
        for (mode, reason) in [
            (0o120_777, RefusalReason::Link),
            (0o010_644, RefusalReason::SpecialFile),
            (0o020_644, RefusalReason::SpecialFile),
            (0o060_644, RefusalReason::SpecialFile),
            (0o140_644, RefusalReason::SpecialFile),
        ] {
            assert_eq!(
                check_entry(&EntryMeta {
                    unix_mode: Some(mode),
                    size: 12,
                    compressed: 12,
                    ..file_meta()
                }),
                Err(reason),
                "{mode:o}"
            );
        }
    }

    #[test]
    fn encryption_and_other_methods_are_refused() {
        assert_eq!(
            check_entry(&EntryMeta {
                encrypted: true,
                ..file_meta()
            }),
            Err(RefusalReason::Encrypted)
        );
        assert_eq!(
            check_entry(&EntryMeta {
                method: Method::Other,
                ..file_meta()
            }),
            Err(RefusalReason::Method)
        );
    }

    #[test]
    fn size_and_ratio_have_limits() {
        let big = MAX_ENTRY_BYTES + 1;
        assert_eq!(
            check_entry(&EntryMeta {
                size: big,
                compressed: big,
                ..file_meta()
            }),
            Err(RefusalReason::TooBig)
        );
        // Exactly at the cap is fine, with a ratio under the limit.
        assert_eq!(
            check_entry(&EntryMeta {
                size: MAX_ENTRY_BYTES,
                compressed: MAX_ENTRY_BYTES / 2,
                ..file_meta()
            }),
            Ok(())
        );
        // A bomb: 1 MiB from 100 bytes.
        assert_eq!(
            check_entry(&EntryMeta {
                size: MAX_ENTRY_BYTES,
                compressed: 100,
                ..file_meta()
            }),
            Err(RefusalReason::Ratio)
        );
        assert_eq!(
            check_entry(&EntryMeta {
                size: MAX_ENTRY_BYTES,
                compressed: 0,
                ..file_meta()
            }),
            Err(RefusalReason::Ratio)
        );
        // The same ratio under the floor is nothing.
        assert_eq!(
            check_entry(&EntryMeta {
                size: 60_000,
                compressed: 20,
                ..file_meta()
            }),
            Ok(())
        );
        // A folder entry with data is not a folder.
        assert_eq!(
            check_entry(&EntryMeta {
                is_dir: true,
                unix_mode: Some(0o040_755),
                size: 5,
                compressed: 5,
                ..file_meta()
            }),
            Err(RefusalReason::Corrupt)
        );
    }

    // --- real archives, written by the crate ---

    #[test]
    fn an_archive_the_crate_writes_is_inventoried_and_read_back() {
        let bytes = archive(&[
            (MANIFEST_NAME, br#"{"format":1}"#),
            ("settings.json", br#"{"editor.tabWidth":2}"#),
            ("scripts/g/x.py", b"print(1)\n"),
            ("notes.txt", b"hello"),
            ("__MACOSX/._x", b"junk"),
        ]);
        let inv = inventory(&bytes).unwrap();
        assert_eq!(inv.entries.len(), 5);
        assert_eq!(inv.members().count(), 3);
        assert_eq!(inv.ignored(), vec![("notes.txt", "outside-layout")]);
        assert_eq!(inv.system_files(), 1);
        let settings_text: &[u8] = br#"{"editor.tabWidth":2}"#;
        assert_eq!(inv.total, 12 + settings_text.len() as u64 + 9 + 5 + 4);

        let mut archive = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();
        let mut budget = MAX_TOTAL_BYTES;
        let settings = inv
            .entries
            .iter()
            .find(|e| e.name == "settings.json")
            .unwrap();
        let read = read_entry(&mut archive, settings.index, settings.size, &mut budget).unwrap();
        assert_eq!(read, br#"{"editor.tabWidth":2}"#);
        assert_eq!(budget, MAX_TOTAL_BYTES - settings_text.len() as u64);
    }

    #[test]
    fn the_fingerprint_changes_with_any_byte_and_not_with_nothing() {
        let a = archive(&[("settings.json", b"{}")]);
        let again = archive(&[("settings.json", b"{}")]);
        let other_bytes = archive(&[("settings.json", b"{ }")]);
        let other_name = archive(&[("machines.json", b"{}")]);
        assert_eq!(fingerprint(&a), fingerprint(&again));
        assert_ne!(fingerprint(&a), fingerprint(&other_bytes));
        assert_ne!(fingerprint(&a), fingerprint(&other_name));
        assert_eq!(fingerprint(&a).len(), 16);
    }

    #[test]
    fn an_archive_with_a_name_that_leaves_the_folder_is_refused_whole_and_every_entry_is_listed() {
        let bytes = archive(&[
            ("settings.json", b"{}"),
            ("../evil.json", b"{}"),
            ("/abs.json", b"{}"),
            ("profiles\\x.json", b"{}"),
        ]);
        let list = refused(&bytes);
        assert_eq!(
            list,
            vec![
                ("../evil.json".to_string(), RefusalReason::ParentDir),
                ("/abs.json".to_string(), RefusalReason::Absolute),
                ("profiles\\x.json".to_string(), RefusalReason::Backslash),
            ]
        );
    }

    #[test]
    fn a_symlink_entry_is_refused() {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("settings.json", deflated()).unwrap();
        writer.write_all(b"{}").unwrap();
        writer
            .add_symlink(
                "profiles/link.json",
                "/etc/passwd",
                SimpleFileOptions::default(),
            )
            .unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        assert_eq!(
            refused(&bytes),
            vec![("profiles/link.json".to_string(), RefusalReason::Link)]
        );
    }

    #[test]
    fn two_names_that_differ_only_in_case_are_refused() {
        let bytes = archive(&[
            ("profiles/Lathe.json", b"{}"),
            ("profiles/lathe.json", b"{}"),
        ]);
        assert_eq!(
            refused(&bytes),
            vec![("profiles/lathe.json".to_string(), RefusalReason::Duplicate)]
        );
    }

    #[test]
    fn a_stored_and_a_deflated_entry_are_both_read() {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("settings.json", stored()).unwrap();
        writer.write_all(b"{}").unwrap();
        writer.start_file("machines.json", deflated()).unwrap();
        writer.write_all(b"{}").unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        assert_eq!(inventory(&bytes).unwrap().entries.len(), 2);
    }

    #[test]
    fn a_zip_bomb_is_refused_before_anything_is_read() {
        // 1 MiB of zeros deflates to about a kilobyte: a ratio over 200 : 1.
        let zeros = vec![0u8; MAX_ENTRY_BYTES as usize];
        let bytes = archive(&[("scripts/zeros.py", &zeros)]);
        assert_eq!(
            refused(&bytes),
            vec![("scripts/zeros.py".to_string(), RefusalReason::Ratio)]
        );
    }

    #[test]
    fn an_entry_over_the_file_cap_is_refused_by_its_declared_size() {
        let big: Vec<u8> = (0..=MAX_ENTRY_BYTES).map(|i| (i % 251) as u8).collect();
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file("scripts/big.py", stored()).unwrap();
        writer.write_all(&big).unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        assert_eq!(
            refused(&bytes),
            vec![("scripts/big.py".to_string(), RefusalReason::TooBig)]
        );
    }

    #[test]
    fn too_many_entries_are_refused() {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for i in 0..=MAX_ENTRIES {
            writer
                .start_file(format!("scripts/s{i}.py"), stored())
                .unwrap();
        }
        let bytes = writer.finish().unwrap().into_inner();
        assert_eq!(
            refused(&bytes),
            vec![(String::new(), RefusalReason::TooManyEntries)]
        );
    }

    #[test]
    fn what_is_not_a_zip_is_refused() {
        assert_eq!(
            refused(b"not a zip at all"),
            vec![(String::new(), RefusalReason::NotZip)]
        );
        assert_eq!(refused(b""), vec![(String::new(), RefusalReason::NotZip)]);
        let mut cut = archive(&[("settings.json", b"{}")]);
        cut.truncate(cut.len() - 10);
        assert_eq!(refused(&cut), vec![(String::new(), RefusalReason::NotZip)]);
    }

    #[test]
    fn an_archive_file_over_the_cap_is_refused_without_opening_it() {
        let big = vec![0u8; MAX_ARCHIVE_BYTES as usize + 1];
        assert_eq!(
            refused(&big),
            vec![(String::new(), RefusalReason::ArchiveTooBig)]
        );
    }

    #[test]
    fn an_entry_that_produces_more_than_it_declares_is_caught_by_counting() {
        // `read_entry` limits by the declared size; asked for a smaller size than the entry
        // holds, it stops one byte past it and refuses, however the central directory lied.
        let bytes = archive(&[("settings.json", br#"{"a":"0123456789"}"#)]);
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();
        let mut budget = MAX_TOTAL_BYTES;
        assert_eq!(
            read_entry(&mut archive, 0, 5, &mut budget),
            Err(RefusalReason::Corrupt)
        );
        assert_eq!(
            budget, MAX_TOTAL_BYTES,
            "nothing is charged for a refused read"
        );
    }

    #[test]
    fn the_total_budget_shrinks_and_runs_out() {
        let bytes = archive(&[("settings.json", b"0123456789")]);
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();
        let mut budget = 9;
        assert_eq!(
            read_entry(&mut archive, 0, 10, &mut budget),
            Err(RefusalReason::TotalTooBig)
        );
    }

    // --- the archive file ---

    #[test]
    fn the_archive_path_has_to_be_a_plain_absolute_path_the_scope_allows() {
        let allow = |_: &Path| true;
        assert!(read_archive_file("relative.zip", allow).is_err());
        assert!(read_archive_file("/a/../etc/x.zip", allow).is_err());
        assert!(read_archive_file("/a/b\0.zip", allow).is_err());
        assert_eq!(
            read_archive_file("/tmp/not-allowed.zip", |_: &Path| false),
            Err("path is not allowed".to_string())
        );
    }

    #[test]
    fn the_archive_file_is_read_whole_and_a_link_is_not_followed() {
        let dir = std::env::temp_dir().join(format!("gedit-configzip-{}-read", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("c.zip");
        let bytes = archive(&[("settings.json", b"{}")]);
        std::fs::write(&file, &bytes).unwrap();
        assert_eq!(
            read_archive_file(file.to_str().unwrap(), |_| true).unwrap(),
            bytes
        );
        #[cfg(unix)]
        {
            let link = dir.join("link.zip");
            std::os::unix::fs::symlink(&file, &link).unwrap();
            assert!(read_archive_file(link.to_str().unwrap(), |_| true).is_err());
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    // --- P4.36 ---

    use std::collections::BTreeMap;
    use std::fs;

    /// A config and a data folder of its own under the temp folder.
    fn scratch(name: &str) -> (PathBuf, AppDirs) {
        let root = std::env::temp_dir().join(format!("gedit-cz-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dirs = AppDirs {
            config: root.join("config"),
            data: root.join("data"),
        };
        dirs.ensure();
        (root, dirs)
    }

    fn put(dirs: &AppDirs, rel: &str, bytes: &[u8]) {
        let path = dirs.config.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn get(dirs: &AppDirs, rel: &str) -> Option<Vec<u8>> {
        fs::read(dirs.config.join(rel)).ok()
    }

    fn json_of(dirs: &AppDirs, rel: &str) -> Value {
        serde_json::from_slice(&get(dirs, rel).unwrap()).unwrap()
    }

    /// Every file and link under `dir`, with its bytes (a link: its target), never followed.
    fn snapshot(dir: &Path) -> BTreeMap<String, Vec<u8>> {
        fn walk(base: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
            let Ok(read) = fs::read_dir(dir) else { return };
            for entry in read.filter_map(Result::ok) {
                let path = entry.path();
                let rel = path
                    .strip_prefix(base)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned();
                let meta = fs::symlink_metadata(&path).unwrap();
                if meta.file_type().is_symlink() {
                    let target = fs::read_link(&path).unwrap();
                    out.insert(rel, format!("link:{}", target.display()).into_bytes());
                } else if meta.is_dir() {
                    out.insert(format!("{rel}/"), Vec::new());
                    walk(base, &path, out);
                } else {
                    out.insert(rel, fs::read(&path).unwrap());
                }
            }
        }
        let mut out = BTreeMap::new();
        walk(dir, dir, &mut out);
        out
    }

    const MANIFEST: &[u8] = br#"{"format":1,"app":"gEdit","version":"1.2.0"}"#;

    /// A configuration zip: the manifest, then `entries`.
    fn config_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut all: Vec<(&str, &[u8])> = vec![(MANIFEST_NAME, MANIFEST)];
        all.extend_from_slice(entries);
        archive(&all)
    }

    fn previewed(dirs: &AppDirs, bytes: &[u8]) -> ImportPreview {
        preview(dirs, bytes).unwrap()
    }

    fn group<'a>(p: &'a ImportPreview, id: &str) -> &'a ImportGroup {
        p.groups
            .iter()
            .find(|g| g.id == id)
            .unwrap_or_else(|| panic!("no group {id} in {:?}", p.groups))
    }

    fn action(p: &ImportPreview, path: &str) -> FileAction {
        p.groups
            .iter()
            .flat_map(|g| &g.files)
            .find(|f| f.path == path)
            .unwrap_or_else(|| panic!("no file {path}"))
            .action
    }

    fn all_groups(p: &ImportPreview) -> Vec<String> {
        p.groups.iter().map(|g| g.id.clone()).collect()
    }

    fn import_all(dirs: &AppDirs, bytes: &[u8]) -> Result<ImportResult, String> {
        let p = previewed(dirs, bytes);
        assert!(p.ok, "{:?}", p.refusals);
        apply(dirs, bytes, &p.fingerprint, &all_groups(&p), true)
    }

    // --- raw archives, for what the crate's writer will not write ---

    fn crc32(data: &[u8]) -> u32 {
        let mut crc = !0u32;
        for byte in data {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 != 0 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }

    /// One entry of a hand-built archive.
    #[derive(Clone)]
    struct Raw {
        name: Vec<u8>,
        /// The stored bytes (compressed when `method` is 8).
        data: Vec<u8>,
        method: u16,
        flags: u16,
        made_by: u16,
        external: u32,
        /// The declared uncompressed size; the data's length when `None`.
        size: Option<u32>,
        crc: Option<u32>,
        central_extra: Vec<u8>,
        /// Point the central record at another entry's local header.
        offset_of: Option<usize>,
    }

    impl Raw {
        fn new(name: &str, data: &[u8]) -> Self {
            Self {
                name: name.as_bytes().to_vec(),
                data: data.to_vec(),
                method: 0,
                flags: 0,
                made_by: 0x031e,
                external: 0o100_644 << 16,
                size: None,
                crc: None,
                central_extra: Vec::new(),
                offset_of: None,
            }
        }
    }

    fn raw_zip(entries: &[Raw]) -> Vec<u8> {
        fn u16le(out: &mut Vec<u8>, v: u16) {
            out.extend_from_slice(&v.to_le_bytes());
        }
        fn u32le(out: &mut Vec<u8>, v: u32) {
            out.extend_from_slice(&v.to_le_bytes());
        }
        let mut out = Vec::new();
        let mut offsets = Vec::new();
        for e in entries {
            offsets.push(out.len() as u32);
            let crc = e.crc.unwrap_or_else(|| crc32(&e.data));
            u32le(&mut out, 0x0403_4b50);
            u16le(&mut out, 20);
            u16le(&mut out, e.flags);
            u16le(&mut out, e.method);
            u16le(&mut out, 0);
            u16le(&mut out, 0x21);
            u32le(&mut out, crc);
            u32le(&mut out, e.data.len() as u32);
            u32le(&mut out, e.size.unwrap_or(e.data.len() as u32));
            u16le(&mut out, e.name.len() as u16);
            u16le(&mut out, 0);
            out.extend_from_slice(&e.name);
            out.extend_from_slice(&e.data);
        }
        let start = out.len();
        for (i, e) in entries.iter().enumerate() {
            let crc = e.crc.unwrap_or_else(|| crc32(&e.data));
            u32le(&mut out, 0x0201_4b50);
            u16le(&mut out, e.made_by);
            u16le(&mut out, 20);
            u16le(&mut out, e.flags);
            u16le(&mut out, e.method);
            u16le(&mut out, 0);
            u16le(&mut out, 0x21);
            u32le(&mut out, crc);
            u32le(&mut out, e.data.len() as u32);
            u32le(&mut out, e.size.unwrap_or(e.data.len() as u32));
            u16le(&mut out, e.name.len() as u16);
            u16le(&mut out, e.central_extra.len() as u16);
            u16le(&mut out, 0);
            u16le(&mut out, 0);
            u16le(&mut out, 0);
            u32le(&mut out, e.external);
            u32le(&mut out, offsets[e.offset_of.unwrap_or(i)]);
            out.extend_from_slice(&e.name);
            out.extend_from_slice(&e.central_extra);
        }
        let size = out.len() - start;
        u32le(&mut out, 0x0605_4b50);
        u16le(&mut out, 0);
        u16le(&mut out, 0);
        u16le(&mut out, entries.len() as u16);
        u16le(&mut out, entries.len() as u16);
        u32le(&mut out, size as u32);
        u32le(&mut out, start as u32);
        u16le(&mut out, 0);
        out
    }

    /// `bytes` deflated, with their checksum: (compressed, crc32).
    fn deflate(bytes: &[u8]) -> (Vec<u8>, u32) {
        let zipped = archive(&[("x", bytes)]);
        let mut archive = zip::ZipArchive::new(Cursor::new(zipped.as_slice())).unwrap();
        let mut raw = archive.by_index_raw(0).unwrap();
        let crc = raw.crc32();
        let mut out = Vec::new();
        raw.read_to_end(&mut out).unwrap();
        (out, crc)
    }

    fn manifest_raw() -> Raw {
        Raw::new(MANIFEST_NAME, MANIFEST)
    }

    /// Text of `len` bytes that deflates well but under 200 : 1.
    fn compressible(len: usize, seed: u32) -> Vec<u8> {
        let mut state = seed;
        let block: Vec<u8> = (0..4000)
            .map(|_| {
                state = state.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                b'a' + ((state >> 16) % 26) as u8
            })
            .collect();
        block.iter().copied().cycle().take(len).collect()
    }

    /// Every archive the import must refuse whole, with the reason it is refused for.
    fn bad_archives() -> Vec<(&'static str, Vec<u8>, Vec<RefusalReason>)> {
        use RefusalReason::*;
        let mut list: Vec<(&'static str, Vec<u8>, Vec<RefusalReason>)> = Vec::new();
        let named = |name: &str| raw_zip(&[manifest_raw(), Raw::new(name, b"{}")]);
        list.push((
            "a name with ..",
            named("profiles/../../evil.json"),
            vec![ParentDir],
        ));
        list.push(("an absolute name", named("/etc/evil.json"), vec![Absolute]));
        list.push((
            "a backslash name",
            named("profiles\\evil.json"),
            vec![Backslash],
        ));
        list.push(("a drive name", named("C:/evil.json"), vec![Colon]));
        list.push(("a NUL in a name", named("profiles/a\0.json"), vec![Control]));
        list.push((
            "a device name",
            named("profiles/con.json"),
            vec![BadSegment],
        ));
        // A symbolic link: its "content" is the path it points to.
        let mut link = Raw::new("profiles/link.json", b"/etc/passwd");
        link.external = 0o120_777 << 16;
        list.push(("a symlink", raw_zip(&[manifest_raw(), link]), vec![Link]));
        let mut fifo = Raw::new("profiles/fifo.json", b"");
        fifo.external = 0o010_644 << 16;
        list.push((
            "a pipe",
            raw_zip(&[manifest_raw(), fifo]),
            vec![SpecialFile],
        ));
        let mut secret = Raw::new("settings.json", b"{}");
        secret.flags = 1;
        list.push((
            "an encrypted entry",
            raw_zip(&[manifest_raw(), secret]),
            vec![Encrypted],
        ));
        let mut bzip = Raw::new("settings.json", b"{}");
        bzip.method = 12;
        list.push((
            "another method",
            raw_zip(&[manifest_raw(), bzip]),
            vec![Method],
        ));
        // Declared small, produces large: counted, never trusted.
        let text = compressible(100_000, 1);
        let (packed, crc) = deflate(&text);
        let mut bomb = Raw::new("scripts/bomb.py", &packed);
        bomb.method = 8;
        bomb.crc = Some(crc);
        bomb.size = Some(10);
        list.push((
            "a bomb that lies",
            raw_zip(&[manifest_raw(), bomb]),
            vec![Corrupt],
        ));
        // A real bomb: 1 MiB of zeros from about a kilobyte.
        list.push((
            "a ratio bomb",
            config_zip(&[("scripts/zeros.py", &vec![0u8; MAX_ENTRY_BYTES as usize])]),
            vec![Ratio],
        ));
        list.push((
            "a case duplicate",
            config_zip(&[("scripts/Run.py", b"1"), ("scripts/run.py", b"2")]),
            vec![Duplicate],
        ));
        // Two records over one local header.
        let mut second = Raw::new("profiles/b.json", b"{}");
        second.offset_of = Some(1);
        list.push((
            "overlapping entries",
            raw_zip(&[manifest_raw(), Raw::new("profiles/a.json", b"{}"), second]),
            vec![Inconsistent],
        ));
        // A Unicode-path extra field that renames the entry.
        let mut renamed = Raw::new("profiles/a.json", b"{}");
        let new_name = b"../../evil.json";
        let mut extra = vec![0x75, 0x70];
        extra.extend_from_slice(&((5 + new_name.len()) as u16).to_le_bytes());
        extra.push(1);
        extra.extend_from_slice(&crc32(b"profiles/a.json").to_le_bytes());
        extra.extend_from_slice(new_name);
        renamed.central_extra = extra;
        list.push((
            "a renaming extra field",
            raw_zip(&[manifest_raw(), renamed]),
            vec![NameEncoding, Inconsistent],
        ));
        let mut many = vec![manifest_raw()];
        for i in 0..MAX_ENTRIES {
            many.push(Raw::new(&format!("scripts/s{i}.py"), b""));
        }
        list.push(("too many entries", raw_zip(&many), vec![TooManyEntries]));
        let big: Vec<u8> = (0..=MAX_ENTRY_BYTES)
            .map(|i| b'a' + (i % 26) as u8)
            .collect();
        list.push((
            "a file over 1 MiB",
            raw_zip(&[manifest_raw(), Raw::new("scripts/big.py", &big)]),
            vec![TooBig],
        ));
        list.push((
            "no manifest",
            archive(&[("settings.json", b"{}")]),
            vec![NoManifest],
        ));
        list.push((
            "not a gEdit manifest",
            archive(&[(MANIFEST_NAME, br#"{"format":1,"app":"other"}"#)]),
            vec![BadManifest],
        ));
        list.push((
            "a newer format",
            archive(&[(MANIFEST_NAME, br#"{"format":2,"app":"gEdit"}"#)]),
            vec![NewerFormat],
        ));
        list.push((
            "a newer machines file",
            config_zip(&[("machines.json", br#"{"$version":99,"machines":[]}"#)]),
            vec![NewerFormat],
        ));
        list.push(("not a zip", b"PK\x03\x04 not really".to_vec(), vec![NotZip]));
        list
    }

    #[test]
    fn every_unsafe_archive_is_refused_whole_and_nothing_is_written() {
        let (root, dirs) = scratch("refused");
        put(&dirs, "settings.json", br#"{"editor.tabWidth":4}"#);
        put(&dirs, "profiles/mine.json", b"{}");
        let before = snapshot(&root);
        for (what, bytes, reasons) in bad_archives() {
            let p = preview(&dirs, &bytes).unwrap();
            assert!(!p.ok, "{what}: not refused");
            assert!(p.groups.is_empty(), "{what}");
            assert!(
                p.refusals.iter().any(|r| reasons.contains(&r.reason)),
                "{what}: {:?}",
                p.refusals
            );
            // Apply refuses too, whatever fingerprint it is handed, and with trust given.
            let groups: Vec<String> = FIXED_GROUPS.iter().map(|s| s.to_string()).collect();
            assert!(
                apply(&dirs, &bytes, &p.fingerprint, &groups, true).is_err(),
                "{what}"
            );
            assert!(
                apply(&dirs, &bytes, "0000000000000000", &groups, true).is_err(),
                "{what}"
            );
            assert_eq!(snapshot(&root), before, "{what}: something was written");
        }
        let _ = fs::remove_dir_all(&root);
    }

    const FIXED_GROUPS: [&str; 6] = [
        "settings", "keys", "machines", "profiles", "codes", "scripts",
    ];

    #[test]
    fn the_files_together_over_32_mib_are_refused() {
        let chunk = compressible(MAX_ENTRY_BYTES as usize, 7);
        let names: Vec<String> = (0..33).map(|i| format!("scripts/c{i}.py")).collect();
        let mut entries: Vec<(&str, &[u8])> = Vec::new();
        for name in &names {
            entries.push((name, &chunk));
        }
        let bytes = config_zip(&entries);
        assert!(bytes.len() as u64 <= MAX_ARCHIVE_BYTES);
        assert_eq!(
            refused(&bytes),
            vec![(String::new(), RefusalReason::TotalTooBig)]
        );
    }

    #[test]
    fn more_than_fifty_refusals_are_cut_with_a_count_row() {
        let mut entries = vec![manifest_raw()];
        for i in 0..60 {
            entries.push(Raw::new(&format!("../x{i}.json"), b"{}"));
        }
        let p = previewed(&scratch("fifty").1, &raw_zip(&entries));
        assert!(!p.ok);
        assert_eq!(p.refusals.len(), MAX_REFUSALS_LISTED + 1);
        assert_eq!(p.refusals.last().unwrap().path, "");
    }

    // --- the preview ---

    #[test]
    fn the_preview_writes_nothing_and_says_new_replace_or_same() {
        let (root, dirs) = scratch("preview");
        put(&dirs, "profiles/a.json", br#"{"id":"a"}"#);
        put(&dirs, "profiles/b.json", br#"{"id":"b"}"#);
        let bytes = config_zip(&[
            ("profiles/a.json", br#"{"id":"a"}"#),
            ("profiles/b.json", br#"{"id":"b2"}"#),
            ("profiles/c.json", br#"{"id":"c"}"#),
            ("scripts/x.py", b"print(1)\n"),
            ("readme.txt", b"hello"),
            ("__MACOSX/._x", b"junk"),
            ("profiles/.DS_Store", b"junk"),
        ]);
        let before = snapshot(&root);
        let p = previewed(&dirs, &bytes);
        assert_eq!(snapshot(&root), before);
        assert!(p.ok);
        assert_eq!(p.manifest.app_version, "1.2.0");
        assert_eq!(all_groups(&p), vec!["profiles", "scripts"]);
        assert_eq!(action(&p, "profiles/a.json"), FileAction::Same);
        assert_eq!(action(&p, "profiles/b.json"), FileAction::Replace);
        assert_eq!(action(&p, "profiles/c.json"), FileAction::New);
        assert!(group(&p, "scripts").runnable);
        assert!(!group(&p, "profiles").runnable);
        assert!(p.needs_trust);
        assert_eq!(p.ignored, vec!["readme.txt: outside-layout".to_string()]);
        assert_eq!(
            p.ignored_count, 3,
            "the two system files are counted, not listed"
        );
        assert_eq!(p.fingerprint.len(), 16);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn content_that_is_not_a_json_object_or_script_text_is_ignored_not_written() {
        let (root, dirs) = scratch("content");
        let bytes = config_zip(&[
            ("profiles/a.json", b"[1,2]"),
            ("codes/b.json", b"not json"),
            ("scripts/c.py", b"bin\0ary"),
            ("scripts/d.py", &[0xff, 0xfe]),
            ("settings.json", b"[]"),
            ("profiles/ok.json", b"{}"),
        ]);
        let p = previewed(&dirs, &bytes);
        assert!(p.ok);
        assert_eq!(all_groups(&p), vec!["profiles"]);
        let mut ignored = p.ignored.clone();
        ignored.sort();
        assert_eq!(
            ignored,
            vec![
                "codes/b.json: not-json-object",
                "profiles/a.json: not-json-object",
                "scripts/c.py: not-text",
                "scripts/d.py: not-text",
                "settings.json: not-json-object",
            ]
        );
        assert!(!p.needs_trust, "no script will be written");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_reserved_or_wrong_name_is_ignored_and_listed() {
        let (root, dirs) = scratch("names");
        let bytes = config_zip(&[
            ("scripts/gedit_nc.py", b"x = 1\n"),
            ("profiles/Lathe.json", b"{}"),
            ("state.json", b"{}"),
            ("nested.zip", b"PK"),
        ]);
        let p = previewed(&dirs, &bytes);
        assert!(p.ok);
        assert!(p.groups.is_empty());
        let mut ignored = p.ignored.clone();
        ignored.sort();
        assert_eq!(
            ignored,
            vec![
                "nested.zip: outside-layout",
                "profiles/Lathe.json: name-not-allowed",
                "scripts/gedit_nc.py: reserved-name",
                "state.json: outside-layout",
            ]
        );
        let _ = fs::remove_dir_all(&root);
    }

    // --- the merges ---

    #[test]
    fn settings_are_merged_key_by_key_and_never_take_the_interpreter_or_the_folders() {
        let (root, dirs) = scratch("settings");
        put(
            &dirs,
            "settings.json",
            br#"{"$version":1,"editor.tabWidth":4,"scripts.python":"/usr/bin/python3","ui.theme":"dark"}"#,
        );
        let bytes = config_zip(&[(
            "settings.json",
            br#"{"$version":1,"editor.tabWidth":2,"scripts.python":"/evil/python","scripts.folders":["/evil"],"editor.rulers":[80]}"#,
        )]);
        let p = previewed(&dirs, &bytes);
        let file = &group(&p, "settings").files[0];
        assert_eq!(file.action, FileAction::Replace);
        assert_eq!(
            file.items,
            vec![
                ImportItem {
                    label: "editor.rulers".into(),
                    from: None,
                    to: Some("[80]".into())
                },
                ImportItem {
                    label: "editor.tabWidth".into(),
                    from: Some("4".into()),
                    to: Some("2".into())
                },
            ]
        );
        assert_eq!(p.kept_settings, vec!["scripts.folders", "scripts.python"]);
        assert_eq!(file.notes.len(), 2);
        apply(&dirs, &bytes, &p.fingerprint, &["settings".into()], false).unwrap();
        let after = json_of(&dirs, "settings.json");
        assert_eq!(after["editor.tabWidth"], 2);
        assert_eq!(after["editor.rulers"], serde_json::json!([80]));
        assert_eq!(
            after["ui.theme"], "dark",
            "a key the zip does not hold stays"
        );
        assert_eq!(
            after["scripts.python"], "/usr/bin/python3",
            "the user's interpreter stays"
        );
        assert!(
            after.get("scripts.folders").is_none(),
            "the folders are never taken"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_file_switches_packages_off_and_never_on() {
        let (root, dirs) = scratch("disabled");
        put(
            &dirs,
            "settings.json",
            br#"{"editor.tabWidth":4,"packages.disabled":["old-tool"]}"#,
        );
        let bytes = config_zip(&[(
            "settings.json",
            br#"{"editor.tabWidth":4,"packages.disabled":["shop-b"]}"#,
        )]);
        let p = previewed(&dirs, &bytes);
        let file = &group(&p, "settings").files[0];
        assert_eq!(file.action, FileAction::Replace);
        assert_eq!(
            file.items,
            vec![ImportItem {
                label: "packages.disabled".into(),
                from: Some(r#"["old-tool"]"#.into()),
                to: Some(r#"["old-tool","shop-b"]"#.into())
            }]
        );
        assert_eq!(file.notes, vec![DISABLED_NOTE.to_string()]);
        apply(&dirs, &bytes, &p.fingerprint, &["settings".into()], false).unwrap();
        assert_eq!(
            json_of(&dirs, "settings.json")["packages.disabled"],
            serde_json::json!(["old-tool", "shop-b"])
        );
        let _ = fs::remove_dir_all(&root);

        // A file with an empty list does not switch on what is off here.
        let (root, dirs) = scratch("disabled-same");
        put(&dirs, "settings.json", br#"{"packages.disabled":["shop"]}"#);
        let bytes = config_zip(&[("settings.json", br#"{"packages.disabled":[]}"#)]);
        let p = previewed(&dirs, &bytes);
        assert_eq!(action(&p, "settings.json"), FileAction::Same);
        let before = snapshot(&root);
        let result = apply(&dirs, &bytes, &p.fingerprint, &["settings".into()], false).unwrap();
        assert_eq!(result.written, 0);
        assert_eq!(snapshot(&root), before);
        // A file without the key, or with the same list, says nothing about it.
        let bytes = config_zip(&[("settings.json", br#"{"packages.disabled":["shop"]}"#)]);
        let p = previewed(&dirs, &bytes);
        assert_eq!(action(&p, "settings.json"), FileAction::Same);
        assert!(group(&p, "settings").files[0].notes.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_settings_file_with_only_the_interpreter_changes_nothing() {
        let (root, dirs) = scratch("settings-same");
        put(&dirs, "settings.json", br#"{"editor.tabWidth":4}"#);
        let bytes = config_zip(&[(
            "settings.json",
            br#"{"editor.tabWidth":4,"scripts.python":"/evil/python"}"#,
        )]);
        let p = previewed(&dirs, &bytes);
        assert_eq!(action(&p, "settings.json"), FileAction::Same);
        let before = snapshot(&root);
        let result = apply(&dirs, &bytes, &p.fingerprint, &["settings".into()], false).unwrap();
        assert_eq!(
            (result.written, result.unchanged, result.backup),
            (0, 1, None)
        );
        assert_eq!(snapshot(&root), before);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn machines_are_merged_by_id_and_the_defaults_key_by_key() {
        let (root, dirs) = scratch("machines");
        put(
            &dirs,
            "machines.json",
            br#"{"$version":1,"machines":[{"id":"m1","name":"Lathe","profile":"fanuc"},{"id":"m2","name":"Mill","profile":"fanuc"}],"defaults":{"fanuc":"m1","heidenhain":"m2"}}"#,
        );
        let bytes = config_zip(&[(
            "machines.json",
            br#"{"$version":1,"machines":[{"id":"m2","name":"Mill 2","profile":"fanuc"},{"id":"m3","name":"New","profile":"okuma"},{"name":"no id"}],"defaults":{"fanuc":"m3"}}"#,
        )]);
        let p = previewed(&dirs, &bytes);
        let file = &group(&p, "machines").files[0];
        assert_eq!(file.action, FileAction::Replace);
        let labels: Vec<(&str, Option<&str>, Option<&str>)> = file
            .items
            .iter()
            .map(|i| (i.label.as_str(), i.from.as_deref(), i.to.as_deref()))
            .collect();
        assert_eq!(
            labels,
            vec![
                ("m2", Some("Mill"), Some("Mill 2")),
                ("m3", None, Some("New")),
                ("defaults.fanuc", Some("m1"), Some("m3")),
            ]
        );
        assert_eq!(file.notes.len(), 1, "the machine without an id");
        apply(&dirs, &bytes, &p.fingerprint, &["machines".into()], false).unwrap();
        let after = json_of(&dirs, "machines.json");
        let ids: Vec<&str> = after["machines"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["id"].as_str().unwrap())
            .collect();
        assert_eq!(
            ids,
            vec!["m1", "m2", "m3"],
            "the user's m1 stays, m2 in place, m3 added"
        );
        assert_eq!(after["machines"][1]["name"], "Mill 2");
        assert_eq!(
            after["defaults"],
            serde_json::json!({"fanuc":"m3","heidenhain":"m2"})
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn keys_are_merged_by_command_id() {
        let (root, dirs) = scratch("keys");
        put(
            &dirs,
            "keybindings.json",
            br#"{"$version":1,"bindings":{"file.save":"Mod+S","view.splitEditor":null}}"#,
        );
        let bytes = config_zip(&[(
            "keybindings.json",
            br#"{"$version":1,"bindings":{"view.splitEditor":"Mod+Alt+S","edit.find":"F3"}}"#,
        )]);
        let p = previewed(&dirs, &bytes);
        let labels: Vec<&str> = group(&p, "keys").files[0]
            .items
            .iter()
            .map(|i| i.label.as_str())
            .collect();
        assert_eq!(labels, vec!["edit.find", "view.splitEditor"]);
        apply(&dirs, &bytes, &p.fingerprint, &["keys".into()], false).unwrap();
        assert_eq!(
            json_of(&dirs, "keybindings.json")["bindings"],
            serde_json::json!({"file.save":"Mod+S","view.splitEditor":"Mod+Alt+S","edit.find":"F3"})
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_key_with_a_member_per_platform_is_merged_member_by_member() {
        let (root, dirs) = scratch("keys-members");
        put(
            &dirs,
            "keybindings.json",
            br#"{"$version":1,"bindings":{"a":{"mac":"Mod+L"},"b":"Mod+B","c":{"mac":"Mod+C","other":"Ctrl+C"},"d":"Mod+D","e":null}}"#,
        );
        let bytes = config_zip(&[(
            "keybindings.json",
            br#"{"$version":1,"bindings":{"a":{"other":"Mod+K"},"b":{"other":"Alt+B"},"c":"Mod+Z","d":null,"e":{"mac":"Mod+E"},"f":{"other":"F2"}}}"#,
        )]);
        let p = previewed(&dirs, &bytes);
        apply(&dirs, &bytes, &p.fingerprint, &["keys".into()], false).unwrap();
        assert_eq!(
            json_of(&dirs, "keybindings.json")["bindings"],
            serde_json::json!({
                "a": {"mac": "Mod+L", "other": "Mod+K"},
                "b": {"mac": "Mod+B", "other": "Alt+B"},
                "c": "Mod+Z",
                "d": null,
                "e": {"mac": "Mod+E", "other": null},
                "f": {"other": "F2"}
            })
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_file_on_this_computer_from_a_newer_gedit_is_left_alone() {
        let (root, dirs) = scratch("newer-here");
        put(&dirs, "machines.json", br#"{"$version":99,"machines":[]}"#);
        let bytes = config_zip(&[("machines.json", br#"{"machines":[]}"#)]);
        let p = previewed(&dirs, &bytes);
        assert!(p.groups.is_empty());
        assert_eq!(p.ignored, vec!["machines.json: newer-file".to_string()]);
        let _ = fs::remove_dir_all(&root);
    }

    // --- apply ---

    /// Two archives of the same length and the same entries that differ only in the zip comment:
    /// the old fingerprint (entry names, checksums, sizes) could not tell them apart.
    #[test]
    fn an_archive_that_differs_only_in_a_byte_the_entries_do_not_show_is_another_archive() {
        let (root, dirs) = scratch("changed-comment");
        put(&dirs, "profiles/a.json", br#"{"id":"a"}"#);
        let with_comment = |comment: &str| {
            let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
            for (name, bytes) in [
                (MANIFEST_NAME, MANIFEST),
                ("profiles/a.json", br#"{"id":"a2"}"# as &[u8]),
            ] {
                writer.start_file(name, deflated()).unwrap();
                writer.write_all(bytes).unwrap();
            }
            writer.set_comment(comment).unwrap();
            writer.finish().unwrap().into_inner()
        };
        let first = with_comment("aaaa");
        let second = with_comment("bbbb");
        assert_eq!(first.len(), second.len());
        let p = previewed(&dirs, &first);
        assert_ne!(p.fingerprint, previewed(&dirs, &second).fingerprint);
        let before = snapshot(&root);
        assert_eq!(
            apply(&dirs, &second, &p.fingerprint, &["profiles".into()], false),
            Err(CHANGED.to_string())
        );
        assert_eq!(snapshot(&root), before);
        // The archive that was previewed still applies.
        assert!(apply(&dirs, &first, &p.fingerprint, &["profiles".into()], false).is_ok());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_archive_that_changed_since_the_preview_writes_nothing() {
        let (root, dirs) = scratch("changed");
        put(&dirs, "profiles/a.json", br#"{"id":"a"}"#);
        let first = config_zip(&[("profiles/a.json", br#"{"id":"a2"}"#)]);
        let second = config_zip(&[("profiles/a.json", br#"{"id":"a3"}"#)]);
        let p = previewed(&dirs, &first);
        let before = snapshot(&root);
        assert_eq!(
            apply(&dirs, &second, &p.fingerprint, &["profiles".into()], false),
            Err(CHANGED.to_string())
        );
        assert_eq!(snapshot(&root), before);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_unknown_group_is_refused() {
        let (root, dirs) = scratch("unknown-group");
        let bytes = config_zip(&[("profiles/a.json", b"{}")]);
        let p = previewed(&dirs, &bytes);
        for bad in ["package:other", "state", "../x"] {
            assert!(
                apply(&dirs, &bytes, &p.fingerprint, &[bad.into()], true).is_err(),
                "{bad}"
            );
        }
        assert!(get(&dirs, "profiles/a.json").is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn scripts_and_package_scripts_need_the_trust_flag_in_rust() {
        let (root, dirs) = scratch("trust");
        let bytes = config_zip(&[
            ("scripts/x.py", b"print(1)\n"),
            ("packages/shop/scripts/y.py", b"print(2)\n"),
            ("packages/plain/profiles/p.json", b"{}"),
            ("profiles/a.json", b"{}"),
        ]);
        let p = previewed(&dirs, &bytes);
        assert!(group(&p, "scripts").runnable);
        assert!(group(&p, "package:shop").runnable);
        assert!(!group(&p, "package:plain").runnable);
        let before = snapshot(&root);
        for runnable in ["scripts", "package:shop"] {
            let groups = vec!["profiles".to_string(), runnable.to_string()];
            assert!(apply(&dirs, &bytes, &p.fingerprint, &groups, false).is_err());
            assert_eq!(snapshot(&root), before, "{runnable}");
        }
        // A package of profiles only needs no trust.
        let groups = vec!["profiles".to_string(), "package:plain".to_string()];
        let result = apply(&dirs, &bytes, &p.fingerprint, &groups, false).unwrap();
        assert_eq!(result.written, 2);
        assert!(get(&dirs, "scripts/x.py").is_none());
        // With the user's trust the code comes too.
        let result = apply(&dirs, &bytes, &p.fingerprint, &all_groups(&p), true).unwrap();
        assert_eq!((result.written, result.unchanged), (2, 2));
        assert_eq!(
            get(&dirs, "packages/shop/scripts/y.py").unwrap(),
            b"print(2)\n"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_import_never_deletes_a_file_the_zip_does_not_hold() {
        let (root, dirs) = scratch("no-delete");
        put(&dirs, "profiles/a.json", br#"{"id":"a"}"#);
        put(&dirs, "profiles/b.json", br#"{"id":"b"}"#);
        put(&dirs, "scripts/mine.py", b"print(0)\n");
        put(&dirs, "state.json", b"{}");
        let bytes = config_zip(&[("profiles/a.json", br#"{"id":"a2"}"#)]);
        import_all(&dirs, &bytes).unwrap();
        assert_eq!(get(&dirs, "profiles/a.json").unwrap(), br#"{"id":"a2"}"#);
        assert_eq!(get(&dirs, "profiles/b.json").unwrap(), br#"{"id":"b"}"#);
        assert_eq!(get(&dirs, "scripts/mine.py").unwrap(), b"print(0)\n");
        assert_eq!(get(&dirs, "state.json").unwrap(), b"{}");
        let _ = fs::remove_dir_all(&root);
    }

    fn backups(dirs: &AppDirs) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dirs.import_backups_dir())
            .map(|read| {
                read.filter_map(Result::ok)
                    .filter_map(|e| e.file_name().into_string().ok())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    #[test]
    fn the_backup_holds_what_was_replaced_and_importing_it_undoes_the_import() {
        let (root, dirs) = scratch("backup");
        put(&dirs, "profiles/a.json", br#"{"id":"a"}"#);
        put(
            &dirs,
            "settings.json",
            br#"{"editor.tabWidth":4,"scripts.python":"/py"}"#,
        );
        let bytes = config_zip(&[
            ("profiles/a.json", br#"{"id":"a2"}"#),
            ("profiles/new.json", br#"{"id":"n"}"#),
            ("settings.json", br#"{"editor.tabWidth":2}"#),
        ]);
        let p = previewed(&dirs, &bytes);
        let result = apply(&dirs, &bytes, &p.fingerprint, &all_groups(&p), false).unwrap();
        assert_eq!(result.written, 3);
        let name = result.backup.unwrap();
        assert_eq!(backups(&dirs), vec![name.clone()]);
        assert!(backup_key(&name).is_some(), "{name}");
        let zip = fs::read(dirs.import_backups_dir().join(&name)).unwrap();
        let inv = inventory(&zip).unwrap();
        let mut names: Vec<&str> = inv.entries.iter().map(|e| e.name.as_str()).collect();
        names.sort();
        assert_eq!(
            names,
            vec![MANIFEST_NAME, "profiles/a.json", "settings.json"],
            "a new file has nothing to back up"
        );
        // Importing the backup puts the old versions back (the new file stays: an import never deletes).
        import_all(&dirs, &zip).unwrap();
        assert_eq!(get(&dirs, "profiles/a.json").unwrap(), br#"{"id":"a"}"#);
        assert_eq!(json_of(&dirs, "settings.json")["editor.tabWidth"], 4);
        assert_eq!(json_of(&dirs, "settings.json")["scripts.python"], "/py");
        assert!(get(&dirs, "profiles/new.json").is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn when_the_backup_cannot_be_written_nothing_is_imported() {
        let (root, dirs) = scratch("backup-fails");
        put(&dirs, "profiles/a.json", br#"{"id":"a"}"#);
        // The backup folder's place is taken by a file.
        let _ = fs::remove_dir_all(dirs.import_backups_dir());
        fs::write(dirs.import_backups_dir(), b"in the way").unwrap();
        let bytes = config_zip(&[
            ("profiles/a.json", br#"{"id":"a2"}"#),
            ("profiles/b.json", br#"{"id":"b"}"#),
        ]);
        let p = previewed(&dirs, &bytes);
        let before = snapshot(&root);
        let err = apply(&dirs, &bytes, &p.fingerprint, &["profiles".into()], false).unwrap_err();
        assert!(err.contains("backup"), "{err}");
        assert_eq!(snapshot(&root), before);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_failing_write_part_way_puts_back_what_was_written() {
        let (root, dirs) = scratch("rollback");
        put(&dirs, "profiles/a.json", br#"{"id":"a"}"#);
        put(&dirs, "settings.json", br#"{"editor.tabWidth":4}"#);
        let bytes = config_zip(&[
            ("codes/new.json", br#"{"codes":{}}"#),
            ("profiles/a.json", br#"{"id":"a2"}"#),
            ("settings.json", br#"{"editor.tabWidth":2}"#),
        ]);
        let p = previewed(&dirs, &bytes);
        let before = snapshot(&dirs.config);
        // The order is codes, profiles, settings: the third write fails.
        let mut calls = 0usize;
        let mut writer = |path: &Path, bytes: &[u8]| -> std::io::Result<()> {
            calls += 1;
            if calls == 3 {
                return Err(std::io::Error::other("disk full"));
            }
            crate::atomic::write_atomic(path, bytes)
        };
        let err = apply_with(
            &dirs,
            &bytes,
            &p.fingerprint,
            &all_groups(&p),
            false,
            0,
            &mut writer,
        )
        .unwrap_err();
        assert!(
            err.starts_with("settings.json could not be written"),
            "{err}"
        );
        assert!(err.contains("put back"), "{err}");
        assert!(err.contains("before-import-19700101-000000.zip"), "{err}");
        assert_eq!(
            snapshot(&dirs.config),
            before,
            "the config folder is as it was"
        );
        assert_eq!(
            backups(&dirs),
            vec!["before-import-19700101-000000.zip".to_string()]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_failing_write_also_removes_the_folders_the_import_made_and_only_those() {
        let (root, dirs) = scratch("rollback-folders");
        put(&dirs, "settings.json", br#"{"editor.tabWidth":4}"#);
        // A folder that is there before the import, empty.
        fs::create_dir_all(dirs.config.join("packages/oldpkg/profiles")).unwrap();
        let bytes = config_zip(&[
            ("packages/newpkg/profiles/a.json", br#"{"id":"a"}"#),
            ("packages/oldpkg/profiles/b.json", br#"{"id":"b"}"#),
            ("settings.json", br#"{"editor.tabWidth":2}"#),
        ]);
        let p = previewed(&dirs, &bytes);
        let before = snapshot(&dirs.config);
        assert!(before.contains_key("packages/oldpkg/profiles/"));
        // The order is packages, then settings: the third write fails.
        let mut calls = 0usize;
        let mut writer = |path: &Path, bytes: &[u8]| -> std::io::Result<()> {
            calls += 1;
            if calls == 3 {
                return Err(std::io::Error::other("disk full"));
            }
            crate::atomic::write_atomic(path, bytes)
        };
        let err = apply_with(
            &dirs,
            &bytes,
            &p.fingerprint,
            &all_groups(&p),
            true,
            0,
            &mut writer,
        )
        .unwrap_err();
        assert!(err.contains("put back"), "{err}");
        assert!(
            !dirs.config.join("packages/newpkg").exists(),
            "a folder this import made is removed again"
        );
        assert_eq!(
            snapshot(&dirs.config),
            before,
            "the config folder is as it was, the old empty folder included"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_files_are_written_packages_first_and_settings_last() {
        let (root, dirs) = scratch("order");
        let bytes = config_zip(&[
            ("settings.json", b"{}"),
            ("keybindings.json", b"{}"),
            ("machines.json", b"{}"),
            ("profiles/a.json", b"{}"),
            ("codes/a.json", b"{}"),
            ("scripts/a.py", b"\n"),
            ("packages/shop/package.json", b"{}"),
        ]);
        let p = previewed(&dirs, &bytes);
        let mut order = Vec::new();
        let mut writer = |path: &Path, bytes: &[u8]| -> std::io::Result<()> {
            order.push(
                path.strip_prefix(&dirs.config)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
            crate::atomic::write_atomic(path, bytes)
        };
        apply_with(
            &dirs,
            &bytes,
            &p.fingerprint,
            &all_groups(&p),
            true,
            0,
            &mut writer,
        )
        .unwrap();
        assert_eq!(
            order,
            vec![
                "packages/shop/package.json",
                "scripts/a.py",
                "codes/a.json",
                "profiles/a.json",
                "machines.json",
                "keybindings.json",
                "settings.json",
            ]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn only_the_last_ten_backups_are_kept_and_nothing_else_is_removed() {
        let (root, dirs) = scratch("prune");
        let dir = dirs.import_backups_dir();
        for i in 0..12 {
            fs::write(
                dir.join(format!(
                    "before-import-2026010{}-0000{:02}.zip",
                    i % 9 + 1,
                    i
                )),
                b"x",
            )
            .unwrap();
        }
        fs::write(dir.join("before-import-20260101-000000-3.zip"), b"x").unwrap();
        fs::write(dir.join("notes.txt"), b"mine").unwrap();
        fs::write(dir.join("before-import-x.zip"), b"mine").unwrap();
        prune_backups(&dir, "before-import-20260109-000008.zip");
        let left = backups(&dirs);
        assert!(left.contains(&"notes.txt".to_string()));
        assert!(left.contains(&"before-import-x.zip".to_string()));
        assert_eq!(
            left.iter().filter(|n| backup_key(n).is_some()).count(),
            MAX_IMPORT_BACKUPS
        );
        assert!(
            !left.contains(&"before-import-20260101-000000.zip".to_string()),
            "the oldest went"
        );
        assert_eq!(
            backup_key("before-import-20260101-000000-3.zip"),
            Some(("20260101-000000".into(), 3))
        );
        assert_eq!(backup_key("before-import-2026-0101.zip"), None);
        let _ = fs::remove_dir_all(&root);
    }

    /// Ten backups a clock that ran ahead left behind, dated after any real date.
    fn future_backups(dirs: &AppDirs) {
        let dir = dirs.import_backups_dir();
        fs::create_dir_all(&dir).unwrap();
        for i in 0..MAX_IMPORT_BACKUPS {
            fs::write(
                dir.join(format!("before-import-20300101-0000{i:02}.zip")),
                b"x",
            )
            .unwrap();
        }
    }

    #[test]
    fn the_backup_just_written_is_never_pruned_even_when_older_ones_are_dated_later() {
        // Real clock: ten backups dated 2030 sort after today's.
        let (root, dirs) = scratch("prune-future");
        put(&dirs, "profiles/a.json", br#"{"id":"a"}"#);
        future_backups(&dirs);
        let bytes = config_zip(&[("profiles/a.json", br#"{"id":"a2"}"#)]);
        let p = previewed(&dirs, &bytes);
        let result = apply(&dirs, &bytes, &p.fingerprint, &all_groups(&p), true).unwrap();
        let name = result.backup.unwrap();
        let left = backups(&dirs);
        assert!(
            left.contains(&name),
            "the undo of this import is gone: {left:?}"
        );
        assert_eq!(left.len(), MAX_IMPORT_BACKUPS);
        let _ = fs::remove_dir_all(&root);

        // A clock that went back: the same through the injected clock.
        let (root, dirs) = scratch("prune-back");
        put(&dirs, "profiles/a.json", br#"{"id":"a"}"#);
        future_backups(&dirs);
        let p = previewed(&dirs, &bytes);
        let secs = 1_735_689_600; // 2025-01-01
        let result = apply_with(
            &dirs,
            &bytes,
            &p.fingerprint,
            &all_groups(&p),
            true,
            secs,
            &mut |path, bytes| crate::atomic::write_atomic(path, bytes),
        )
        .unwrap();
        let name = result.backup.unwrap();
        assert!(name.starts_with("before-import-20250101-"), "{name}");
        let left = backups(&dirs);
        assert!(left.contains(&name), "{left:?}");
        assert_eq!(left.len(), MAX_IMPORT_BACKUPS);
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_is_a_link_is_never_written_into() {
        use std::os::unix::fs::symlink;
        let (root, dirs) = scratch("links");
        let outside = root.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("target.json"), b"{\"outside\":true}").unwrap();
        // A package folder that is a link, and a profile that is a link.
        fs::create_dir_all(dirs.packages_dir()).unwrap();
        symlink(&outside, dirs.packages_dir().join("shop")).unwrap();
        symlink(
            outside.join("target.json"),
            dirs.profiles_dir().join("a.json"),
        )
        .unwrap();
        let bytes = config_zip(&[
            ("packages/shop/profiles/p.json", b"{}"),
            ("profiles/a.json", b"{}"),
            ("profiles/b.json", b"{}"),
        ]);
        let p = previewed(&dirs, &bytes);
        let mut ignored = p.ignored.clone();
        ignored.sort();
        assert_eq!(
            ignored,
            vec![
                "packages/shop/profiles/p.json: link-on-the-way",
                "profiles/a.json: target-link",
            ]
        );
        assert_eq!(all_groups(&p), vec!["profiles"]);
        import_all(&dirs, &bytes).unwrap();
        assert_eq!(snapshot(&outside).len(), 1, "nothing written outside");
        assert_eq!(
            fs::read(outside.join("target.json")).unwrap(),
            b"{\"outside\":true}"
        );
        assert!(get(&dirs, "profiles/b.json").is_some());
        let _ = fs::remove_dir_all(&root);
    }

    // --- export ---

    /// A configuration with one file of every kind, and the things an export leaves out.
    fn full_config(dirs: &AppDirs) {
        put(dirs, "settings.json", br#"{"$version":1,"editor.tabWidth":2,"scripts.python":"/opt/py","scripts.folders":["/x"]}"#);
        put(
            dirs,
            "keybindings.json",
            br#"{"$version":1,"bindings":{"file.save":"Mod+S"}}"#,
        );
        put(dirs, "machines.json", br#"{"$version":1,"machines":[{"id":"m1","name":"Lathe","profile":"fanuc"}],"defaults":{}}"#);
        put(dirs, "profiles/lathe.json", br#"{"id":"lathe"}"#);
        put(dirs, "codes/shop.json", br#"{"codes":{}}"#);
        put(dirs, "scripts/facing.py", b"print('facing')\n");
        put(dirs, "scripts/finish/chamfer.py", b"print('chamfer')\n");
        put(
            dirs,
            "packages/shop-a/package.json",
            br#"{"name":"Shop A"}"#,
        );
        put(dirs, "packages/shop-a/profiles/p.json", br#"{"id":"p"}"#);
        put(dirs, "packages/shop-a/codes/c.json", br#"{"codes":{}}"#);
        put(dirs, "packages/shop-a/scripts/g/s.py", b"print('s')\n");
        // Never exported, in silence.
        put(dirs, "state.json", b"{}");
        put(dirs, ".window-state.json", b"{}");
        put(dirs, "settings.json.bak", b"{}");
        put(dirs, "profiles/.hidden.json", b"{}");
        put(dirs, "scripts/__pycache__/x.pyc", b"\0");
        fs::write(dirs.data.join("state.json"), b"{}").unwrap();
    }

    fn exported(dirs: &AppDirs, root: &Path) -> (ExportResult, Vec<u8>) {
        let dest = root.join("out").join("config.zip");
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        let result = export(dirs, &dest, "1.2.0").unwrap();
        (result, fs::read(dest).unwrap())
    }

    #[test]
    fn export_writes_the_manifest_first_and_the_layout_of_the_folder() {
        let (root, dirs) = scratch("export");
        full_config(&dirs);
        let (result, bytes) = exported(&dirs, &root);
        assert!(result.skipped.is_empty(), "{:?}", result.skipped);
        let inv = inventory(&bytes).unwrap();
        let names: Vec<&str> = inv.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                MANIFEST_NAME,
                "settings.json",
                "keybindings.json",
                "machines.json",
                "profiles/lathe.json",
                "codes/shop.json",
                "scripts/facing.py",
                "scripts/finish/chamfer.py",
                "packages/shop-a/codes/c.json",
                "packages/shop-a/package.json",
                "packages/shop-a/profiles/p.json",
                "packages/shop-a/scripts/g/s.py",
            ]
        );
        assert_eq!(result.files, names.len() - 1);
        assert_eq!(result.bytes, bytes.len() as u64);
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();
        let mut budget = MAX_TOTAL_BYTES;
        let manifest: Value = serde_json::from_slice(
            &read_entry(&mut archive, 0, inv.entries[0].size, &mut budget).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["format"], 1);
        assert_eq!(manifest["app"], "gEdit");
        assert_eq!(manifest["version"], "1.2.0");
        assert_eq!(
            manifest["omitted"],
            serde_json::json!(["scripts.python", "scripts.folders"])
        );
        assert_eq!(manifest["counts"]["scripts"], 2);
        assert_eq!(manifest["counts"]["packages"], 1);
        let settings: Value = serde_json::from_slice(
            &read_entry(&mut archive, 1, inv.entries[1].size, &mut budget).unwrap(),
        )
        .unwrap();
        assert!(settings.get("scripts.python").is_none());
        assert!(settings.get("scripts.folders").is_none());
        assert_eq!(settings["editor.tabWidth"], 2);
        // Equal content, equal entries: the dates are the zip epoch.
        let file = archive.by_index_raw(2).unwrap();
        assert_eq!(file.last_modified(), Some(zip::DateTime::default()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn export_then_preview_shows_every_file_as_same() {
        let (root, dirs) = scratch("export-same");
        full_config(&dirs);
        put(&dirs, "profiles/Bad Name.json", b"{}");
        let (_, bytes) = exported(&dirs, &root);
        let p = previewed(&dirs, &bytes);
        assert!(p.ok, "{:?}", p.refusals);
        assert!(p.ignored.is_empty(), "{:?}", p.ignored);
        for group in &p.groups {
            for file in &group.files {
                assert_eq!(file.action, FileAction::Same, "{}", file.path);
            }
        }
        assert_eq!(p.groups.iter().map(|g| g.files.len()).sum::<usize>(), 11);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_round_trip_carries_every_kind_of_file_to_another_computer() {
        let (root, from) = scratch("trip-from");
        full_config(&from);
        let (_, bytes) = exported(&from, &root);
        let (root2, to) = scratch("trip-to");
        put(&to, "settings.json", br#"{"scripts.python":"/here/py"}"#);
        let result = import_all(&to, &bytes).unwrap();
        assert_eq!(result.written, 11);
        // The two merged files are written as gEdit writes them: the same content.
        for rel in ["keybindings.json", "machines.json"] {
            assert_eq!(json_of(&to, rel), json_of(&from, rel), "{rel}");
        }
        // Every other file byte for byte.
        for rel in [
            "profiles/lathe.json",
            "codes/shop.json",
            "scripts/facing.py",
            "scripts/finish/chamfer.py",
            "packages/shop-a/package.json",
            "packages/shop-a/profiles/p.json",
            "packages/shop-a/codes/c.json",
            "packages/shop-a/scripts/g/s.py",
        ] {
            assert_eq!(get(&to, rel), get(&from, rel), "{rel}");
        }
        let settings = json_of(&to, "settings.json");
        assert_eq!(settings["editor.tabWidth"], 2);
        assert_eq!(settings["scripts.python"], "/here/py");
        assert!(settings.get("scripts.folders").is_none());
        assert!(get(&to, "state.json").is_none());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&root2);
    }

    #[test]
    fn export_skips_a_second_name_that_is_equal_once_case_is_folded() {
        let mut c = Collector::default();
        assert!(c.admits("scripts/Mill.py").is_some());
        assert!(c.admits("scripts/mill.py").is_none());
        assert!(c.admits("scripts/other.py").is_some());
        assert_eq!(c.skipped.len(), 1);
        assert_eq!(
            (c.skipped[0].path.as_str(), c.skipped[0].reason.as_str()),
            ("scripts/mill.py", "duplicate")
        );
        // The same key as the import's: what export lets through the import accepts.
        let bytes = archive(&[("scripts/Mill.py", b"x\n"), ("scripts/mill.py", b"x\n")]);
        assert_eq!(
            refused(&bytes),
            vec![("scripts/mill.py".into(), RefusalReason::Duplicate)]
        );
    }

    #[test]
    fn export_skips_a_script_the_import_would_ignore_for_its_name() {
        let (root, dirs) = scratch("export-format");
        put(&dirs, "scripts/ok.py", b"x = 1\n");
        put(&dirs, "scripts/evil\u{202E}py.py", b"x = 1\n");
        put(&dirs, "scripts/gedit_nc/__init__.py", b"x = 1\n");
        put(&dirs, "scripts/lib/__init__.py", b"x = 1\n");
        let (result, bytes) = exported(&dirs, &root);
        let mut skipped: Vec<(String, String)> = result
            .skipped
            .iter()
            .map(|s| (s.path.clone(), s.reason.clone()))
            .collect();
        skipped.sort();
        assert_eq!(
            skipped,
            vec![
                (
                    "scripts/evil\u{202E}py.py".to_string(),
                    "name-not-allowed".to_string()
                ),
                (
                    "scripts/gedit_nc/__init__.py".to_string(),
                    "reserved-name".to_string()
                ),
            ]
        );
        let inv = inventory(&bytes).unwrap();
        let mut names: Vec<&str> = inv.entries.iter().map(|e| e.name.as_str()).collect();
        names.sort();
        assert_eq!(
            names,
            vec![MANIFEST_NAME, "scripts/lib/__init__.py", "scripts/ok.py"]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn export_skips_and_lists_what_the_import_would_refuse() {
        let (root, dirs) = scratch("export-skip");
        put(&dirs, "profiles/Bad Name.json", b"{}");
        put(&dirs, "profiles/broken.json", b"not json");
        put(
            &dirs,
            "profiles/big.json",
            &vec![b' '; MAX_ENTRY_BYTES as usize + 1],
        );
        put(&dirs, "scripts/notes.txt", b"hello");
        put(&dirs, "scripts/gedit_nc.py", b"x = 1\n");
        put(&dirs, "scripts/bin.py", b"\0\x01");
        put(&dirs, "scripts/a/b/deep.py", b"\n");
        put(&dirs, "packages/Bad/package.json", b"{}");
        put(&dirs, "packages/ok/readme.md", b"hi");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/hosts", dirs.profiles_dir().join("link.json"))
                .unwrap();
            std::os::unix::fs::symlink("/etc", dirs.user_scripts_dir().join("etc")).unwrap();
        }
        let (result, bytes) = exported(&dirs, &root);
        let mut skipped: Vec<String> = result.skipped.iter().map(|s| s.path.clone()).collect();
        skipped.sort();
        let mut expected = vec![
            "packages/Bad",
            "packages/ok/readme.md",
            "profiles/Bad Name.json",
            "profiles/big.json",
            "profiles/broken.json",
            "scripts/a/b",
            "scripts/bin.py",
            "scripts/gedit_nc.py",
            "scripts/notes.txt",
        ];
        #[cfg(unix)]
        expected.extend(["profiles/link.json", "scripts/etc"]);
        expected.sort();
        assert_eq!(skipped, expected);
        assert_eq!(result.files, 0);
        let inv = inventory(&bytes).unwrap();
        assert_eq!(inv.entries.len(), 1, "the manifest only");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn export_refuses_a_destination_inside_the_configuration_folder_or_not_absolute() {
        let (root, dirs) = scratch("export-dest");
        assert!(export(&dirs, &dirs.config.join("c.zip"), "1").is_err());
        assert!(export(&dirs, &dirs.profiles_dir().join("c.zip"), "1").is_err());
        assert!(export(&dirs, Path::new("relative.zip"), "1").is_err());
        assert!(export(&dirs, &root.join("a").join("..").join("c.zip"), "1").is_err());
        assert!(fs::read_dir(&dirs.config).unwrap().all(|e| !e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".zip")));
        // Beside the folder is fine.
        assert!(export(&dirs, &root.join("c.zip"), "1").is_ok());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_export_drops_what_the_import_would_refuse_and_builds_again() {
        // Two script names that are one name on macOS and Windows: on a file system that keeps
        // them apart, the second is left out rather than writing a zip the import refuses.
        let (root, dirs) = scratch("export-dup");
        put(&dirs, "scripts/Run.py", b"1\n");
        if get(&dirs, "scripts/run.py").is_none() {
            put(&dirs, "scripts/run.py", b"2\n");
            let (result, bytes) = exported(&dirs, &root);
            assert_eq!(result.files, 1);
            assert_eq!(result.skipped.len(), 1);
            assert!(inventory(&bytes).is_ok());
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_new_limits_are_the_numbers_of_the_contract() {
        assert_eq!(MAX_IMPORT_BACKUPS, 10);
        assert_eq!(BACKUP_PREFIX, "before-import-");
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(stamp_utc(1_793_102_400), "20261027-120000");
    }

    /// The crate's `extract` writes by its own rules; gEdit never calls it (§6.9 rule 17), and
    /// the module stays on the central-directory readers.
    #[test]
    fn the_crates_extract_is_never_called() {
        let source = source_scan::lf(include_str!("configzip.rs"));
        let before_tests = source.split("#[cfg(test)]").next().unwrap();
        for needle in [
            concat!(".ext", "ract("),
            concat!("ext", "ract_with_options"),
        ] {
            assert!(
                !before_tests.contains(needle),
                "{needle} is called in configzip.rs"
            );
        }
    }

    #[test]
    fn the_limits_are_the_numbers_of_the_contract() {
        assert_eq!(MAX_ARCHIVE_BYTES, 16 * 1024 * 1024);
        assert_eq!(MAX_ENTRIES, 2000);
        assert_eq!(MAX_ENTRY_BYTES, 1024 * 1024);
        assert_eq!(MAX_TOTAL_BYTES, 32 * 1024 * 1024);
        assert_eq!(MAX_RATIO, 200);
        assert_eq!(RATIO_FLOOR, 64 * 1024);
        assert_eq!(MAX_NAME_BYTES, 200);
        assert_eq!(MAX_DEPTH, 5);
        assert_eq!(FORMAT, 1);
    }
}
