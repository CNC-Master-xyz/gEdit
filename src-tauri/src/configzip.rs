//! The configuration zip: export, and import with a preview (Phase 4 plan §6.9 rules 16–36,
//! AD-56, Q4-23). Written by the P4g prelude; P4.36 owns it from here.
//!
//! **What is final in this file** (the security vocabulary; P4.36 builds on it and does not
//! loosen it): the limits, the shape check of an entry name, the layout that says which entry is
//! which configuration file ([`classify`]), the per-entry gate ([`check_entry`]), the inventory of
//! an archive that applies the crate's header-consistency check and collects every refusal
//! ([`inventory`]), the bounded read of one entry ([`read_entry`]), the fingerprint the apply
//! compares ([`fingerprint`]), and the bounded read of the archive file ([`read_archive_file`]).
//! **What P4.36 fills in:** [`export`], [`preview`] and [`apply`] (the three `NOT_IMPLEMENTED`
//! stubs), the settings and machines merges, the staging and the backup zip.
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

// The prelude's vocabulary is final and ahead of its callers: what is not called yet is called by
// P4.36. Remove this line when the module is complete.
#![allow(dead_code)]

use std::collections::HashSet;
use std::io::{Cursor, Read};
use std::path::Path;

use serde::Serialize;
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

/// What the three stubs answer until P4.36.
pub const NOT_IMPLEMENTED: &str = "not implemented: the configuration zip is P4.36";

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
    crate::scripts::discovery::is_safe_segment(segment)
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
        if !seen.insert(name.trim_end_matches('/').to_lowercase()) {
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

/// A 64-bit FNV-1a fingerprint of the archive's length and of every entry's name, checksum and
/// declared size, in order, as 16 hex digits. The preview hands it out and the apply compares it:
/// a file that changed in between is not applied. (Change detection, not a signature.)
pub fn fingerprint(inv: &Inventory) -> String {
    fn feed(hash: &mut u64, bytes: &[u8]) {
        for byte in bytes {
            *hash ^= u64::from(*byte);
            *hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    feed(&mut hash, &inv.archive_bytes.to_le_bytes());
    for entry in &inv.entries {
        feed(&mut hash, entry.name.as_bytes());
        feed(&mut hash, &[0]);
        feed(&mut hash, &entry.crc32.to_le_bytes());
        feed(&mut hash, &entry.size.to_le_bytes());
    }
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
// P4.36: the three bodies
// ---------------------------------------------------------------------------

/// Writes the configuration of `dirs` to the zip at `dest` (§6.9 rules 16–20). P4.36.
pub fn export(_dirs: &AppDirs, _dest: &Path, _app_version: &str) -> Result<ExportResult, String> {
    Err(NOT_IMPLEMENTED.into())
}

/// Reads the archive and says what an import would do; writes nothing (§6.9 rules 21–27). P4.36.
pub fn preview(_dirs: &AppDirs, _archive: &[u8]) -> Result<ImportPreview, String> {
    Err(NOT_IMPLEMENTED.into())
}

/// Applies the selected groups: re-reads the archive, compares the fingerprint, writes the backup
/// zip, stages, then swaps (§6.9 rules 28–36). P4.36.
pub fn apply(
    _dirs: &AppDirs,
    _archive: &[u8],
    _fingerprint: &str,
    _groups: &[String],
    _accept_scripts: bool,
) -> Result<ImportResult, String> {
    Err(NOT_IMPLEMENTED.into())
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
    fn the_fingerprint_changes_with_any_entry_and_not_with_nothing() {
        let a = inventory(&archive(&[("settings.json", b"{}")])).unwrap();
        let again = inventory(&archive(&[("settings.json", b"{}")])).unwrap();
        let other_bytes = inventory(&archive(&[("settings.json", b"{ }")])).unwrap();
        let other_name = inventory(&archive(&[("machines.json", b"{}")])).unwrap();
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

    // --- the stubs and the commands ---

    #[test]
    fn the_three_bodies_are_the_prelude_stubs() {
        let dirs = AppDirs {
            config: "/c".into(),
            data: "/d".into(),
        };
        assert_eq!(
            export(&dirs, Path::new("/x.zip"), "1.2.0").unwrap_err(),
            NOT_IMPLEMENTED
        );
        assert_eq!(preview(&dirs, b"").unwrap_err(), NOT_IMPLEMENTED);
        assert_eq!(
            apply(&dirs, b"", "", &[], false).unwrap_err(),
            NOT_IMPLEMENTED
        );
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
