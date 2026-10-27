//! The folder commands (plan Phase 4, AD-53, section 6.8; P4f). The limits, the wire types and
//! the command signatures were written by the P4f prelude; P4.27 fills the bodies. A signature
//! or a limit changes only with a numbered section 7 row, and a change of a limit goes to the
//! code reviewer first (the security part of section 6.8 is the contract this file is held to).
//!
//! Four commands, and they are the whole of what the webview may ask of a folder:
//!
//! - [`folder_search`]: walks a folder the user picked, read only, and streams the files that
//!   pass the name, date, size and text-prefilter checks. The matching of the user's query
//!   (a word such as `T17`, a text, a regular expression) is **not** done here: it needs the
//!   profile's tokenizer and the guarded regular-expression worker, which live in the
//!   webview. Rust finds and reads the files; the webview reads their lines.
//! - [`folder_search_cancel`]: stops the running search.
//! - [`folder_siblings`]: the names of the files next to an open document that fit a pattern
//!   (the channel files of a set), names only.
//! - [`folder_grant`]: lets the webview open one file the search found, by granting that one
//!   file to the fs scope (never the folder).
//!
//! None of them returns a path the webview did not already hold or a folder listing it did not
//! ask for by pattern, and none takes a path that is not inside the fs scope. The rules are in
//! the plan's section 6.8 ("Security: the limits"); the constants below are those limits.

use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};
use tauri_plugin_fs::FsExt;

use crate::{files, paths, state};

// --- the limits (section 6.8, "Security: the limits") ------------------------------------

/// Characters of a folder or file path the commands accept.
pub const MAX_PATH_CHARS: usize = 4096;
/// Folder levels below the root a search goes down (the root is level 0).
pub const MAX_DEPTH: usize = 16;
/// Directory entries looked at in one search, files, folders and links together.
pub const MAX_ENTRIES: usize = 200_000;
/// Entries of one folder; a folder with more is skipped as a whole and counted.
pub const MAX_DIR_ENTRIES: usize = 50_000;
/// Files opened and read in one search. Past it the search stops and says so.
pub const MAX_FILES_READ: usize = 20_000;
/// Bytes of one file. A larger file is not searched; it is counted and its name is listed.
/// (`MAX_OPEN_BYTES`, what the editor opens, is 50 MiB.)
pub const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
/// Bytes read in one search, all files together.
pub const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
/// Bytes sent to the webview in one search, all files together. Past it the search stops with
/// `stoppedBy: "bytes"`. Bounds what the webview holds if it reads slower than the walk sends.
pub const MAX_SENT_BYTES: u64 = 256 * 1024 * 1024;
/// Seconds one search may run. The user can stop it sooner.
pub const MAX_SECONDS: u64 = 600;
/// Bytes at the start of a file that decide whether it is binary (a NUL byte, no BOM).
pub const BINARY_PROBE_BYTES: usize = 8192;
/// Name patterns in one request, and characters in one.
pub const MAX_PATTERNS: usize = 16;
pub const MAX_PATTERN_CHARS: usize = 128;
/// Bytes of the text prefilter (`contains`).
pub const MAX_CONTAINS_BYTES: usize = 256;
/// Names of too-large files the summary lists.
pub const MAX_LISTED_NAMES: usize = 20;
/// Searches whose thread is stuck in a read after they were stopped. Past it no new search
/// starts (a hung share must not pile up threads).
pub const MAX_ABANDONED_SEARCHES: usize = 4;
/// Names `folder_siblings` answers, and the smallest number of literal characters its
/// pattern must hold (a pattern such as `*` lists the whole folder and is refused).
pub const MAX_SIBLING_NAMES: usize = 5_000;
pub const MIN_SIBLING_LITERALS: usize = 2;

/// What a search asks for. camelCase on the wire; passed as `req`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FolderSearchRequest {
    /// `^[a-z0-9-]{1,64}$`; the key `folder_search_cancel` stops it by. One search runs at a
    /// time; a second request while one runs is refused.
    pub id: String,
    /// An absolute path of a folder the fs scope allows (the user picked or dropped it).
    pub root: String,
    /// Go into subfolders (up to [`MAX_DEPTH`]).
    pub recursive: bool,
    /// File-name patterns, `*` and `?` only, case-insensitive, matched on the name alone.
    /// Empty: every name.
    #[serde(default)]
    pub name_patterns: Vec<String>,
    /// Modified-time window, milliseconds since the epoch; `after` inclusive, `before`
    /// exclusive. Checked from the directory entry's metadata, before the file is opened.
    pub modified_after: Option<i64>,
    pub modified_before: Option<i64>,
    /// A text every matching line of the query contains verbatim (ASCII, 1 to
    /// [`MAX_CONTAINS_BYTES`] bytes). A file whose bytes do not hold it is not sent. A file that
    /// starts with a UTF-16 byte-order mark is always sent (its bytes are not ASCII).
    pub contains: Option<FolderContains>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FolderContains {
    pub text: String,
    pub case_sensitive: bool,
}

/// One message of the stream, as JSON. A `File` message is followed by **one raw message**
/// of exactly `bytes` bytes (the file's content): the channel carries both
/// ([`InvokeResponseBody::Json`], [`InvokeResponseBody::Raw`]), in order.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FolderEvent {
    #[serde(rename_all = "camelCase")]
    File {
        /// 0, 1, 2, ... in the order sent.
        index: u32,
        /// The path as the walk found it: the canonical root, then the names. Absolute.
        path: String,
        /// The path below the root, `/`-separated, for the Results column.
        rel: String,
        bytes: u64,
        mtime_ms: Option<f64>,
    },
    /// Every 250 ms while the walk runs, so the form can show it is alive.
    #[serde(rename_all = "camelCase")]
    Progress { entries_seen: u32, files_read: u32 },
}

/// Why a search ended before the whole folder was read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderStop {
    Cancelled,
    Entries,
    Files,
    Bytes,
    Time,
}

/// What was not read, counted. Nothing is skipped silently.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSkipped {
    /// A NUL byte in the first [`BINARY_PROBE_BYTES`] and no UTF-16 mark.
    pub binary: u32,
    pub too_large: u32,
    /// Could not be opened or read (permission, a vanished file, a share that failed).
    pub unreadable: u32,
    /// Symbolic links, Windows junctions and other reparse points: never followed.
    pub links: u32,
    /// Names that start with `.` and, on Windows, entries with the hidden or system flag.
    pub hidden: u32,
    /// Subfolders below [`MAX_DEPTH`].
    pub too_deep: u32,
    /// Folders with more than [`MAX_DIR_ENTRIES`] entries, skipped whole.
    pub big_folders: u32,
}

/// The end of a search. camelCase on the wire.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSummary {
    pub entries_seen: u32,
    /// Files that passed the name and date checks and were opened.
    pub files_read: u32,
    /// Files sent (the ones the `contains` prefilter let through).
    pub files_sent: u32,
    pub bytes_read: u64,
    pub skipped: FolderSkipped,
    pub stopped_by: Option<FolderStop>,
    /// Up to [`MAX_LISTED_NAMES`] paths below the root of the too-large files.
    pub too_large_names: Vec<String>,
}

/// `folder_siblings`' answer: plain file names, sorted, never a path.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSiblings {
    pub names: Vec<String>,
    /// More than [`MAX_SIBLING_NAMES`] fit; the first are listed.
    pub truncated: bool,
    /// The folder did not answer in time (a hung share); `names` is then empty.
    pub unavailable: bool,
}

// --- the answers (a closed list) -----------------------------------------------------------
//
// Every command answers `Err` with one of these sentences and with nothing else: never the text
// of an operating-system error, which can hold a path. A path that is not allowed and a path
// that does not exist give the same answer, so the commands cannot be used to probe the file
// system. `REFUSALS` is the whole list; a test holds it equal to the constants.

pub const E_PATH: &str = "path is not a plain absolute path";
pub const E_PATH_LONG: &str = "path is too long";
pub const E_NOT_ALLOWED: &str = "path is not allowed";
pub const E_NOT_FOLDER: &str = "path is not a folder";
pub const E_DRIVE_ROOT: &str = "the root of a drive or of the file system cannot be searched";
pub const E_NOT_IN_FOLDER: &str = "file is not in that folder";
pub const E_ID: &str = "search id is not valid";
pub const E_BUSY: &str = "another search is already running";
pub const E_STUCK: &str = "earlier searches are still waiting on a folder that does not answer; wait for them or restart gEdit";
pub const E_PATTERN_COUNT: &str = "too many name patterns";
pub const E_PATTERN: &str =
    "a name pattern is empty, too long or holds a character no file name may have";
pub const E_CONTAINS: &str = "search text must be 1 to 256 plain ASCII characters";
pub const E_SIBLING_PATTERN: &str = "the pattern needs at least two fixed characters";
pub const E_FAILED: &str = "the folder command failed";

/// Every sentence a folder command may answer with (the tests hold the list equal to the constants).
#[cfg(test)]
pub const REFUSALS: [&str; 14] = [
    E_PATH,
    E_PATH_LONG,
    E_NOT_ALLOWED,
    E_NOT_FOLDER,
    E_DRIVE_ROOT,
    E_NOT_IN_FOLDER,
    E_ID,
    E_BUSY,
    E_STUCK,
    E_PATTERN_COUNT,
    E_PATTERN,
    E_CONTAINS,
    E_SIBLING_PATTERN,
    E_FAILED,
];

// --- the limits of one run, as a value so the tests can lower them ----------------------------

/// The numeric limits one search obeys. [`Limits::default`] is the plan's table; the tests build
/// smaller ones so a stop reason can be met without 20,000 files.
#[derive(Debug, Clone)]
pub struct Limits {
    pub depth: usize,
    pub entries: usize,
    pub dir_entries: usize,
    pub files: usize,
    pub file_bytes: u64,
    pub total_bytes: u64,
    pub sent_bytes: u64,
    pub time: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            depth: MAX_DEPTH,
            entries: MAX_ENTRIES,
            dir_entries: MAX_DIR_ENTRIES,
            files: MAX_FILES_READ,
            file_bytes: MAX_FILE_BYTES,
            total_bytes: MAX_TOTAL_BYTES,
            sent_bytes: MAX_SENT_BYTES,
            time: Duration::from_secs(MAX_SECONDS),
        }
    }
}

/// How often a `Progress` message is sent.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);
/// How long after a cancel (or the deadline) the command waits for the walking thread to end
/// by itself before it answers anyway and counts the thread as abandoned.
const ABANDON_GRACE: Duration = Duration::from_millis(250);
/// How often the command looks at its flags while the walk runs.
const POLL: Duration = Duration::from_millis(20);
/// The size of one read. The cancel flag and the deadline are looked at between reads.
const READ_CHUNK: usize = 64 * 1024;
/// `folder_siblings` stops reading a folder after this many entries.
const MAX_SIBLING_ENTRIES: usize = 50_000;

// --- the shape of a path (S1) --------------------------------------------------------------

/// S1, the text part: UTF-8 (a `&str` is), at most [`MAX_PATH_CHARS`] characters, no NUL,
/// **absolute** (`/...`, a drive `X:\...` or a UNC `\\host\share\...`; the verbatim and device
/// prefixes `\\?\` and `\\.\` are refused) and with no `..` component. Nothing is expanded.
///
/// `windows` selects how Windows reads the text; the commands pass `cfg!(windows)`, the tests
/// pass both, so the Windows rules run on every platform.
pub fn check_path_text(path: &str, windows: bool) -> Result<(), &'static str> {
    if path.chars().take(MAX_PATH_CHARS + 1).count() > MAX_PATH_CHARS {
        return Err(E_PATH_LONG);
    }
    if path.is_empty() || path.contains('\0') {
        return Err(E_PATH);
    }
    if windows {
        let text = path.replace('/', "\\");
        if text.starts_with(r"\\?\") || text.starts_with(r"\\.\") {
            return Err(E_PATH);
        }
        let bytes = text.as_bytes();
        let drive = bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && bytes[2] == b'\\';
        let unc = text.starts_with(r"\\") && {
            let mut parts = text[2..].split('\\');
            matches!(
                (parts.next(), parts.next()),
                (Some(server), Some(share)) if !server.is_empty() && !share.is_empty()
            )
        };
        if !drive && !unc {
            return Err(E_PATH);
        }
        // A colon after the drive letter is an alternate data stream (`a.nc:stream`).
        let after_drive = if drive { &text[2..] } else { &text[..] };
        if after_drive.contains(':') {
            return Err(E_PATH);
        }
    } else if !path.starts_with('/') {
        return Err(E_PATH);
    }
    for part in path.split(|c: char| c == '/' || (windows && c == '\\')) {
        if part == ".." {
            return Err(E_PATH);
        }
        // Windows drops trailing dots and spaces: `...` and `.. ` are `..` to it.
        if windows
            && !part.is_empty()
            && part != "."
            && part.trim_end_matches([' ', '.']).is_empty()
        {
            return Err(E_PATH);
        }
    }
    Ok(())
}

/// Whether `path` is the root of a drive or of the file system (`/`, `C:\`). A UNC share root
/// (`\\dnc\machine1`) is not: it is where a DNC folder lives.
pub fn is_filesystem_root(path: &Path) -> bool {
    let mut share = false;
    let mut names = 0;
    for part in path.components() {
        match part {
            Component::Prefix(prefix) => {
                share = matches!(prefix.kind(), Prefix::UNC(..) | Prefix::VerbatimUNC(..));
            }
            Component::RootDir => {}
            _ => names += 1,
        }
    }
    names == 0 && !share
}

/// S1 for a folder: the text checks, then the fs scope (before anything is listed or opened),
/// then the folder resolved **once** (`canonicalize`, in the ordinary Windows spelling). Every
/// later path of the walk is built from the answer. A path that is not allowed and one that does
/// not exist give the same sentence.
pub fn resolve_root(
    root: &str,
    is_allowed: &dyn Fn(&Path) -> bool,
) -> Result<PathBuf, &'static str> {
    check_path_text(root, cfg!(windows))?;
    let given = Path::new(root);
    if !is_allowed(given) {
        return Err(E_NOT_ALLOWED);
    }
    let canonical = fs::canonicalize(given).map_err(|_| E_NOT_ALLOWED)?;
    let canonical = paths::plain(&canonical).into_owned();
    if !fs::metadata(&canonical).is_ok_and(|meta| meta.is_dir()) {
        return Err(E_NOT_FOLDER);
    }
    if is_filesystem_root(&canonical) {
        return Err(E_DRIVE_ROOT);
    }
    Ok(canonical)
}

// --- Windows attribute bits, as pure predicates ---------------------------------------------

const ATTR_HIDDEN: u32 = 0x0000_0002;
const ATTR_SYSTEM: u32 = 0x0000_0004;
const ATTR_REPARSE_POINT: u32 = 0x0000_0400;
/// `FILE_FLAG_OPEN_REPARSE_POINT`: open the link itself, never what it points at.
#[cfg(windows)]
const FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
/// Share mode read, write and delete: a CAM post can still write the file while it is read.
#[cfg(windows)]
const SHARE_ALL: u32 = 0x0000_0007;

/// A junction, a mount point, a symbolic link or any other reparse point.
pub fn is_reparse(attributes: u32) -> bool {
    attributes & ATTR_REPARSE_POINT != 0
}

/// Hidden or system, the entries Windows itself hides.
pub fn is_hidden_attributes(attributes: u32) -> bool {
    attributes & (ATTR_HIDDEN | ATTR_SYSTEM) != 0
}

/// The attribute bits of a metadata record; 0 where the platform has none.
#[cfg(windows)]
fn attributes_of(meta: &fs::Metadata) -> u32 {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes()
}
#[cfg(not(windows))]
fn attributes_of(_meta: &fs::Metadata) -> u32 {
    0
}

/// The attribute bits of a directory entry. On Windows they come with the listing; elsewhere
/// there are none and no call is made.
#[cfg(windows)]
fn entry_attributes(entry: &fs::DirEntry) -> io::Result<u32> {
    entry.metadata().map(|meta| attributes_of(&meta))
}
#[cfg(not(windows))]
#[allow(clippy::unnecessary_wraps)]
fn entry_attributes(_entry: &fs::DirEntry) -> io::Result<u32> {
    Ok(0)
}

// --- name patterns and the text prefilter ----------------------------------------------------

/// A name pattern, case-folded per character. Only `*` and `?` are wildcards.
fn fold(text: &str) -> Vec<char> {
    text.chars()
        .map(|c| c.to_lowercase().next().unwrap_or(c))
        .collect()
}

/// A pattern the request may carry: 1 to [`MAX_PATTERN_CHARS`] characters, none that no file
/// name may hold (`/ \ : " < > |` and the control characters; the webview refuses the same).
fn compile_pattern(text: &str) -> Result<Vec<char>, &'static str> {
    let chars = text.chars().count();
    if chars == 0 || chars > MAX_PATTERN_CHARS {
        return Err(E_PATTERN);
    }
    if text
        .chars()
        .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '"' | '<' | '>' | '|'))
    {
        return Err(E_PATTERN);
    }
    Ok(fold(text))
}

/// Glob match of a folded pattern against a folded name: `*` any run, `?` any one character.
/// Iterative with one backtrack point, so it is quadratic at worst, never exponential.
pub fn glob_match(pattern: &[char], name: &[char]) -> bool {
    let (mut p, mut n) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while n < name.len() {
        if p < pattern.len() && pattern[p] == '*' {
            star = Some((p, n));
            p += 1;
        } else if p < pattern.len() && (pattern[p] == '?' || pattern[p] == name[n]) {
            p += 1;
            n += 1;
        } else if let Some((star_p, star_n)) = star {
            p = star_p + 1;
            n = star_n + 1;
            star = Some((star_p, star_n + 1));
        } else {
            return false;
        }
    }
    while p < pattern.len() && pattern[p] == '*' {
        p += 1;
    }
    p == pattern.len()
}

/// The literal text of the prefilter, with its failure table (Knuth-Morris-Pratt: linear in the
/// file, whatever the file holds).
#[derive(Debug, Clone)]
struct Needle {
    bytes: Vec<u8>,
    fail: Vec<usize>,
    case_sensitive: bool,
}

impl Needle {
    fn new(text: &str, case_sensitive: bool) -> Result<Self, &'static str> {
        if text.is_empty() || text.len() > MAX_CONTAINS_BYTES || !text.is_ascii() {
            return Err(E_CONTAINS);
        }
        let bytes: Vec<u8> = if case_sensitive {
            text.as_bytes().to_vec()
        } else {
            text.to_ascii_lowercase().into_bytes()
        };
        let mut fail = vec![0; bytes.len()];
        let mut k = 0;
        for i in 1..bytes.len() {
            while k > 0 && bytes[i] != bytes[k] {
                k = fail[k - 1];
            }
            if bytes[i] == bytes[k] {
                k += 1;
            }
            fail[i] = k;
        }
        Ok(Self {
            bytes,
            fail,
            case_sensitive,
        })
    }

    /// Whether `haystack` holds the text (ASCII case folding when it was not asked to match case).
    fn is_in(&self, haystack: &[u8]) -> bool {
        let mut k = 0;
        for &byte in haystack {
            let byte = if self.case_sensitive {
                byte
            } else {
                byte.to_ascii_lowercase()
            };
            while k > 0 && self.bytes[k] != byte {
                k = self.fail[k - 1];
            }
            if self.bytes[k] == byte {
                k += 1;
                if k == self.bytes.len() {
                    return true;
                }
            }
        }
        false
    }
}

/// A request that passed its checks.
#[derive(Debug, Clone)]
pub struct Checked {
    pub id: String,
    recursive: bool,
    patterns: Vec<Vec<char>>,
    after: Option<i64>,
    before: Option<i64>,
    needle: Option<Needle>,
}

impl Checked {
    /// The checks of the request itself (everything but the folder): the id, the patterns, the
    /// prefilter text. The folder is checked by [`resolve_root`].
    pub fn new(req: &FolderSearchRequest) -> Result<Self, &'static str> {
        let id_ok = !req.id.is_empty()
            && req.id.len() <= 64
            && req
                .id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        if !id_ok {
            return Err(E_ID);
        }
        if req.name_patterns.len() > MAX_PATTERNS {
            return Err(E_PATTERN_COUNT);
        }
        let patterns = req
            .name_patterns
            .iter()
            .map(|text| compile_pattern(text))
            .collect::<Result<Vec<_>, _>>()?;
        let needle = match &req.contains {
            Some(contains) => Some(Needle::new(&contains.text, contains.case_sensitive)?),
            None => None,
        };
        Ok(Self {
            id: req.id.clone(),
            recursive: req.recursive,
            patterns,
            after: req.modified_after,
            before: req.modified_before,
            needle,
        })
    }

    fn name_fits(&self, name: &str) -> bool {
        if self.patterns.is_empty() {
            return true;
        }
        let folded = fold(name);
        self.patterns.iter().any(|p| glob_match(p, &folded))
    }
}

/// UTF-16 byte-order mark (little or big endian).
fn has_utf16_bom(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF])
}

/// A NUL byte in the probe and no UTF-16 mark: not text.
fn is_binary(probe: &[u8]) -> bool {
    !has_utf16_bom(probe) && probe.contains(&0)
}

/// Milliseconds since the Unix epoch, negative before it.
fn epoch_ms(time: SystemTime) -> f64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(after) => after.as_secs_f64() * 1000.0,
        Err(before) => -(before.duration().as_secs_f64() * 1000.0),
    }
}

/// File names sort case-insensitively, then bytewise, so a repeated search sends the same files
/// in the same order.
fn sort_names<T>(entries: &mut [(String, T)]) {
    entries.sort_by_cached_key(|(name, _)| (name.to_lowercase(), name.clone()));
}

// --- the registry: one search at a time, and the ones that got stuck -------------------------

/// One running search: the cancel flag the command and the walk share, the counts so far (what
/// the command answers with if the thread is stuck and has to be left behind), and the two flags
/// of the abandoned bookkeeping (read and written under the registry's lock).
pub struct Search {
    cancel: AtomicBool,
    ended: AtomicBool,
    abandoned: AtomicBool,
    summary: Mutex<FolderSummary>,
}

impl Search {
    fn new() -> Self {
        Self {
            cancel: AtomicBool::new(false),
            ended: AtomicBool::new(false),
            abandoned: AtomicBool::new(false),
            summary: Mutex::new(FolderSummary::default()),
        }
    }

    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    fn summary(&self) -> MutexGuard<'_, FolderSummary> {
        // Nothing in the summary can be half-updated by a panic.
        self.summary.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[derive(Default)]
struct RegistryInner {
    running: Option<(String, Arc<Search>)>,
    abandoned: usize,
}

/// Managed state (`lib.rs`): the search that is running (`id` and cancel flag) and how many
/// stopped searches still have a thread stuck in a read.
#[derive(Clone, Default)]
pub struct SearchRegistry {
    inner: Arc<Mutex<RegistryInner>>,
}

impl SearchRegistry {
    fn lock(&self) -> MutexGuard<'_, RegistryInner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Takes the one slot. Refused while a search runs, and while [`MAX_ABANDONED_SEARCHES`]
    /// stopped ones are still stuck.
    pub fn begin(&self, id: &str) -> Result<Arc<Search>, &'static str> {
        let mut inner = self.lock();
        if inner.abandoned >= MAX_ABANDONED_SEARCHES {
            return Err(E_STUCK);
        }
        if inner.running.is_some() {
            return Err(E_BUSY);
        }
        let search = Arc::new(Search::new());
        inner.running = Some((id.to_owned(), Arc::clone(&search)));
        Ok(search)
    }

    /// Asks the search `id` to stop. Whether one with that id was running.
    pub fn cancel(&self, id: &str) -> bool {
        match &self.lock().running {
            Some((running, search)) if running == id => {
                search.cancel.store(true, Ordering::Relaxed);
                true
            }
            _ => false,
        }
    }

    /// Frees the slot (if `search` still holds it).
    fn release(&self, search: &Arc<Search>) {
        let mut inner = self.lock();
        if inner
            .running
            .as_ref()
            .is_some_and(|(_, held)| Arc::ptr_eq(held, search))
        {
            inner.running = None;
        }
    }

    /// The command stops waiting for a thread that has not ended: the slot is free again and the
    /// thread counts until it ends. Under the lock, so a thread that ends just now is not counted.
    fn abandon(&self, search: &Arc<Search>) {
        let mut inner = self.lock();
        search.cancel.store(true, Ordering::Relaxed);
        if !search.ended.load(Ordering::Relaxed) && !search.abandoned.swap(true, Ordering::Relaxed)
        {
            inner.abandoned += 1;
        }
        if inner
            .running
            .as_ref()
            .is_some_and(|(_, held)| Arc::ptr_eq(held, search))
        {
            inner.running = None;
        }
    }

    /// The walking thread's last step.
    fn ended(&self, search: &Arc<Search>) {
        let mut inner = self.lock();
        search.ended.store(true, Ordering::Relaxed);
        if search.abandoned.load(Ordering::Relaxed) {
            inner.abandoned -= 1;
        }
    }

    /// Searches whose thread is stuck after they were stopped.
    #[cfg(test)]
    pub fn abandoned_count(&self) -> usize {
        self.lock().abandoned
    }
}

/// Dropped when the walking thread ends, also by a panic.
struct EndGuard {
    registry: SearchRegistry,
    search: Arc<Search>,
}

impl Drop for EndGuard {
    fn drop(&mut self) {
        self.registry.ended(&self.search);
    }
}

/// Runs `job` on a thread of its own and answers as soon as it is done, or as soon as it has
/// been cancelled (or has run past `limits.time`) for [`ABANDON_GRACE`] without ending. A read
/// stuck in the operating system (a hung share) cannot be interrupted: the thread is left, the
/// slot is freed and the answer is `stoppedBy: cancelled` (or `time`) with the counts so far.
///
/// This function blocks; the command calls it on the blocking pool.
pub fn supervise<F>(
    registry: &SearchRegistry,
    id: &str,
    limits: &Limits,
    job: F,
) -> Result<FolderSummary, &'static str>
where
    F: FnOnce(&Arc<Search>) -> Result<FolderSummary, &'static str> + Send + 'static,
{
    let search = registry.begin(id)?;
    let (tx, rx) = mpsc::channel();
    let spawned = {
        let (registry, search) = (registry.clone(), Arc::clone(&search));
        std::thread::Builder::new()
            .name("gedit-folder-walk".into())
            .spawn(move || {
                let _end = EndGuard {
                    registry,
                    search: Arc::clone(&search),
                };
                let answer = job(&search);
                let _ = tx.send(answer);
            })
    };
    if spawned.is_err() {
        registry.release(&search);
        return Err(E_FAILED);
    }

    let give_up_at = Instant::now() + limits.time + ABANDON_GRACE;
    let mut cancelled_at: Option<Instant> = None;
    loop {
        match rx.recv_timeout(POLL) {
            Ok(answer) => {
                registry.release(&search);
                return answer;
            }
            Err(RecvTimeoutError::Disconnected) => {
                registry.release(&search);
                return Err(E_FAILED);
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        let stop = if search.cancelled() {
            let since = *cancelled_at.get_or_insert_with(Instant::now);
            (since.elapsed() >= ABANDON_GRACE).then_some(FolderStop::Cancelled)
        } else {
            (Instant::now() >= give_up_at).then_some(FolderStop::Time)
        };
        if let Some(reason) = stop {
            registry.abandon(&search);
            // The thread may have answered while the decision was made: that answer is the better one.
            if let Ok(answer) = rx.try_recv() {
                return answer;
            }
            let mut summary = search.summary().clone();
            summary.stopped_by = Some(reason);
            return Ok(summary);
        }
    }
}

// --- the walk (S2, S3) ----------------------------------------------------------------------

/// Where the walk puts what it found. The command's sink is the IPC channel; the tests collect.
pub trait Sink {
    /// A file passed. `false` when it could not be delivered (the window is gone): the walk stops.
    fn file(&mut self, event: FolderEvent, data: Vec<u8>) -> bool;
    /// A progress message. `false` as above.
    fn progress(&mut self, entries_seen: u32, files_read: u32) -> bool;
}

impl<T: Sink + ?Sized> Sink for &mut T {
    fn file(&mut self, event: FolderEvent, data: Vec<u8>) -> bool {
        (**self).file(event, data)
    }
    fn progress(&mut self, entries_seen: u32, files_read: u32) -> bool {
        (**self).progress(entries_seen, files_read)
    }
}

/// The IPC channel of one search: a `File` message as JSON, then its bytes as one raw message.
struct ChannelSink {
    channel: Channel<InvokeResponseBody>,
}

impl Sink for ChannelSink {
    fn file(&mut self, event: FolderEvent, data: Vec<u8>) -> bool {
        let Ok(json) = serde_json::to_string(&event) else {
            return false;
        };
        self.channel.send(InvokeResponseBody::Json(json)).is_ok()
            && self.channel.send(InvokeResponseBody::Raw(data)).is_ok()
    }

    fn progress(&mut self, entries_seen: u32, files_read: u32) -> bool {
        let event = FolderEvent::Progress {
            entries_seen,
            files_read,
        };
        serde_json::to_string(&event)
            .is_ok_and(|json| self.channel.send(InvokeResponseBody::Json(json)).is_ok())
    }
}

/// How opening a file failed.
enum OpenFailure {
    /// The file is a link (or became one): never followed.
    Link,
    Other,
}

/// Opens `path` for reading, never following a link and never blocking on a pipe.
#[cfg(unix)]
fn open_plain(path: &Path) -> Result<fs::File, OpenFailure> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(path)
        .map_err(|err| {
            if err.raw_os_error() == Some(libc::ELOOP) {
                OpenFailure::Link
            } else {
                OpenFailure::Other
            }
        })
}

/// Opens `path` for reading: the link itself if it is one, and shared with a CAM post that
/// writes the file at the same time.
#[cfg(windows)]
fn open_plain(path: &Path) -> Result<fs::File, OpenFailure> {
    use std::os::windows::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .read(true)
        .share_mode(SHARE_ALL)
        .custom_flags(FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| OpenFailure::Other)
}

/// What reading one file came to.
enum Outcome {
    /// The bytes and the modified time of the opened file.
    Data(Vec<u8>, Option<f64>),
    /// Read, and the prefilter text is not in it.
    Filtered,
    Binary,
    TooLarge,
    Link,
    Unreadable,
    /// The search stops (the reason is on the walker).
    Stopped,
}

struct Walker<'a, S: Sink> {
    root: PathBuf,
    req: &'a Checked,
    limits: &'a Limits,
    search: &'a Search,
    sink: S,
    deadline: Instant,
    last_progress: Instant,
    stop: Option<FolderStop>,
    next_index: u32,
    bytes_sent: u64,
    chunk: Vec<u8>,
}

impl<S: Sink> Walker<'_, S> {
    fn count(&self, change: impl FnOnce(&mut FolderSummary)) {
        change(&mut self.search.summary());
    }

    fn skip(&self, change: impl FnOnce(&mut FolderSkipped)) {
        self.count(|summary| change(&mut summary.skipped));
    }

    /// Whether the search must end now (the reason is then in `stop`). Looked at before every
    /// entry and every read; also sends the progress message.
    fn halted(&mut self) -> bool {
        if self.stop.is_some() {
            return true;
        }
        if self.search.cancelled() {
            self.stop = Some(FolderStop::Cancelled);
        } else if Instant::now() >= self.deadline {
            self.stop = Some(FolderStop::Time);
        } else if self.last_progress.elapsed() >= PROGRESS_EVERY {
            self.last_progress = Instant::now();
            let (entries, files) = {
                let summary = self.search.summary();
                (summary.entries_seen, summary.files_read)
            };
            if !self.sink.progress(entries, files) {
                self.stop = Some(FolderStop::Cancelled);
            }
        }
        self.stop.is_some()
    }

    fn walk_dir(&mut self, dir: &Path, rel: &str, depth: usize) {
        if self.halted() {
            return;
        }
        let Ok(listing) = fs::read_dir(dir) else {
            self.skip(|s| s.unreadable += 1);
            return;
        };
        let mut entries: Vec<(String, fs::DirEntry)> = Vec::new();
        let mut looked = 0usize;
        let mut unreadable = 0u32;
        let mut too_many = false;
        for item in listing {
            if looked >= self.limits.dir_entries {
                too_many = true;
                break;
            }
            looked += 1;
            match item {
                Ok(entry) => match entry.file_name().into_string() {
                    Ok(name) => entries.push((name, entry)),
                    Err(_) => unreadable += 1,
                },
                Err(_) => unreadable += 1,
            }
        }
        if too_many {
            // The whole folder is skipped and counted; what was looked at counts as looked at.
            let looked = u32::try_from(looked).unwrap_or(u32::MAX);
            self.count(|s| {
                s.entries_seen = s.entries_seen.saturating_add(looked);
                s.skipped.big_folders += 1;
            });
            if self.search.summary().entries_seen as usize > self.limits.entries {
                self.stop = Some(FolderStop::Entries);
            }
            return;
        }
        if unreadable > 0 {
            self.count(|s| {
                s.entries_seen += unreadable;
                s.skipped.unreadable += unreadable;
            });
        }
        sort_names(&mut entries);
        for (name, entry) in entries {
            if self.halted() {
                return;
            }
            if self.search.summary().entries_seen as usize >= self.limits.entries {
                self.stop = Some(FolderStop::Entries);
                return;
            }
            self.count(|s| s.entries_seen += 1);
            self.entry(dir, rel, depth, &name, &entry);
            if self.stop.is_some() {
                return;
            }
        }
    }

    fn entry(&mut self, dir: &Path, rel: &str, depth: usize, name: &str, entry: &fs::DirEntry) {
        let Ok(attributes) = entry_attributes(entry) else {
            self.skip(|s| s.unreadable += 1);
            return;
        };
        if name.starts_with('.') || is_hidden_attributes(attributes) {
            self.skip(|s| s.hidden += 1);
            return;
        }
        let Ok(kind) = entry.file_type() else {
            self.skip(|s| s.unreadable += 1);
            return;
        };
        // The entry's type does not follow a link. A reparse point (a junction, a mount point)
        // is skipped whatever `is_symlink` says.
        if kind.is_symlink() || is_reparse(attributes) {
            self.skip(|s| s.links += 1);
            return;
        }
        let child_rel = if rel.is_empty() {
            name.to_owned()
        } else {
            format!("{rel}/{name}")
        };
        if kind.is_dir() {
            if !self.req.recursive {
                return;
            }
            if depth + 1 > self.limits.depth {
                self.skip(|s| s.too_deep += 1);
                return;
            }
            self.walk_dir(&dir.join(name), &child_rel, depth + 1);
        } else if kind.is_file() {
            self.file(&dir.join(name), &child_rel, name, entry);
        } else if self.req.name_fits(name) {
            // A FIFO, a socket, a device node: never opened (it could block for ever).
            self.skip(|s| s.unreadable += 1);
        }
    }

    fn file(&mut self, path: &Path, rel: &str, name: &str, entry: &fs::DirEntry) {
        if !self.req.name_fits(name) {
            return;
        }
        // A DOS device name is not a file (`NUL.nc` opens the bit bucket).
        if cfg!(windows) && paths::is_device_name(name) {
            self.skip(|s| s.unreadable += 1);
            return;
        }
        if self.req.after.is_some() || self.req.before.is_some() {
            let modified = entry
                .metadata()
                .ok()
                .and_then(|meta| meta.modified().ok())
                .map(|time| epoch_ms(time).floor() as i64);
            let Some(modified) = modified else {
                self.skip(|s| s.unreadable += 1);
                return;
            };
            let too_old = self.req.after.is_some_and(|after| modified < after);
            let too_new = self.req.before.is_some_and(|before| modified >= before);
            if too_old || too_new {
                return;
            }
        }
        if self.search.summary().files_read as usize >= self.limits.files {
            self.stop = Some(FolderStop::Files);
            return;
        }
        self.count(|s| s.files_read += 1);
        match self.read_file(path) {
            Outcome::Data(data, modified) => self.deliver(rel, path, data, modified),
            Outcome::Filtered | Outcome::Stopped => {}
            Outcome::Binary => self.skip(|s| s.binary += 1),
            Outcome::Link => self.skip(|s| s.links += 1),
            Outcome::Unreadable => self.skip(|s| s.unreadable += 1),
            Outcome::TooLarge => self.count(|s| {
                s.skipped.too_large += 1;
                if s.too_large_names.len() < MAX_LISTED_NAMES {
                    s.too_large_names.push(rel.to_owned());
                }
            }),
        }
    }

    /// Sends one file that passed. The cap on what is sent is checked before the send.
    fn deliver(&mut self, rel: &str, path: &Path, data: Vec<u8>, modified: Option<f64>) {
        let size = data.len() as u64;
        if self.bytes_sent.saturating_add(size) > self.limits.sent_bytes {
            self.stop = Some(FolderStop::Bytes);
            return;
        }
        if self.search.cancelled() {
            self.stop = Some(FolderStop::Cancelled);
            return;
        }
        let Some(path_text) = path.to_str() else {
            self.skip(|s| s.unreadable += 1);
            return;
        };
        let event = FolderEvent::File {
            index: self.next_index,
            path: path_text.to_owned(),
            rel: rel.to_owned(),
            bytes: size,
            mtime_ms: modified,
        };
        if !self.sink.file(event, data) {
            self.stop = Some(FolderStop::Cancelled);
            return;
        }
        self.next_index += 1;
        self.bytes_sent += size;
        self.count(|s| s.files_sent += 1);
    }

    /// Opens `path`, checks the handle, and reads it (S2).
    fn read_file(&mut self, path: &Path) -> Outcome {
        let file = match open_plain(path) {
            Ok(file) => file,
            Err(OpenFailure::Link) => return Outcome::Link,
            Err(OpenFailure::Other) => return Outcome::Unreadable,
        };
        // The handle is asked again: its type and its length are the ones that count, not the
        // directory entry's.
        let Ok(meta) = file.metadata() else {
            return Outcome::Unreadable;
        };
        if is_reparse(attributes_of(&meta)) {
            return Outcome::Link;
        }
        if !meta.is_file() {
            return Outcome::Unreadable;
        }
        if meta.len() > self.limits.file_bytes {
            return Outcome::TooLarge;
        }
        // The file's own resolved path must lie below the resolved root.
        match fs::canonicalize(path) {
            Ok(real) if paths::plain(&real).starts_with(&self.root) => {}
            Ok(_) => return Outcome::Link,
            Err(_) => return Outcome::Unreadable,
        }
        let modified = meta.modified().ok().map(epoch_ms);
        match self.read_body(file, meta.len()) {
            Outcome::Data(data, _) => Outcome::Data(data, modified),
            other => other,
        }
    }

    /// Reads at most `limits.file_bytes + 1` bytes of `reader` (a file that grows while it is
    /// read is too large), probing the start for binary content before the rest is read.
    fn read_body(&mut self, reader: impl Read, declared: u64) -> Outcome {
        let cap = self.limits.file_bytes;
        let mut reader = reader.take(cap + 1);
        let mut data: Vec<u8> =
            Vec::with_capacity(usize::try_from(declared).unwrap_or(0).min(1 << 24) + 1);
        let mut probed = false;
        loop {
            if self.halted() {
                return Outcome::Stopped;
            }
            let room = self
                .limits
                .total_bytes
                .saturating_sub(self.search.summary().bytes_read);
            if room == 0 {
                self.stop = Some(FolderStop::Bytes);
                return Outcome::Stopped;
            }
            let want = self
                .chunk
                .len()
                .min(usize::try_from(room).unwrap_or(usize::MAX));
            let read = match reader.read(&mut self.chunk[..want]) {
                Ok(n) => n,
                Err(err) if err.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => return Outcome::Unreadable,
            };
            data.extend_from_slice(&self.chunk[..read]);
            self.count(|s| s.bytes_read += read as u64);
            if data.len() as u64 > cap {
                return Outcome::TooLarge;
            }
            let at_end = read == 0;
            if !probed && (data.len() >= BINARY_PROBE_BYTES || at_end) {
                probed = true;
                if is_binary(&data[..data.len().min(BINARY_PROBE_BYTES)]) {
                    return Outcome::Binary;
                }
            }
            if at_end {
                break;
            }
        }
        // S5: the prefilter is only a necessary condition; a UTF-16 file (its bytes are not
        // ASCII) always goes through.
        if let Some(needle) = &self.req.needle {
            if !has_utf16_bom(&data) && !needle.is_in(&data) {
                return Outcome::Filtered;
            }
        }
        Outcome::Data(data, None)
    }
}

/// Walks the resolved `root` and sends what passes the request to `sink` (S2, S3). The count and
/// the stop reason are the result. `search` carries the cancel flag and the running counts.
pub fn walk<S: Sink>(
    root: &Path,
    req: &Checked,
    limits: &Limits,
    search: &Search,
    sink: S,
) -> FolderSummary {
    let mut walker = Walker {
        root: root.to_path_buf(),
        req,
        limits,
        search,
        sink,
        deadline: Instant::now() + limits.time,
        last_progress: Instant::now(),
        stop: None,
        next_index: 0,
        bytes_sent: 0,
        chunk: vec![0; READ_CHUNK],
    };
    walker.walk_dir(root, "", 0);
    let mut summary = search.summary().clone();
    summary.stopped_by = walker.stop;
    summary
}

// --- the siblings (S1, S4) -------------------------------------------------------------------

/// A pattern for `folder_siblings`: valid as a name pattern, with at least
/// [`MIN_SIBLING_LITERALS`] characters that are not wildcards (`*` alone would list the folder).
fn compile_sibling_pattern(text: &str) -> Result<Vec<char>, &'static str> {
    let pattern = compile_pattern(text).map_err(|_| E_SIBLING_PATTERN)?;
    let literals = pattern.iter().filter(|c| !matches!(c, '*' | '?')).count();
    if literals < MIN_SIBLING_LITERALS {
        return Err(E_SIBLING_PATTERN);
    }
    Ok(pattern)
}

/// What listing one folder came to.
#[derive(Clone)]
enum Listing {
    Names { names: Vec<String>, truncated: bool },
    Absent,
    Unavailable,
}

/// The regular files of `folder` whose names fit `pattern`: no directory, no link, no content.
fn list_folder(folder: &Path, pattern: &[char], max_names: usize, max_entries: usize) -> Listing {
    let listing = match fs::read_dir(folder) {
        Ok(listing) => listing,
        Err(err)
            if matches!(
                err.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
            ) =>
        {
            return Listing::Absent
        }
        Err(_) => return Listing::Unavailable,
    };
    let mut names: Vec<(String, ())> = Vec::new();
    let mut truncated = false;
    for (looked, item) in listing.enumerate() {
        if looked >= max_entries {
            truncated = true;
            break;
        }
        let Ok(entry) = item else { continue };
        // The entry's own type: a link is a link, not the file it points at.
        if !entry.file_type().is_ok_and(|kind| kind.is_file()) {
            continue;
        }
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if glob_match(pattern, &fold(&name)) {
            names.push((name, ()));
        }
    }
    sort_names(&mut names);
    if names.len() > max_names {
        names.truncate(max_names);
        truncated = true;
    }
    Listing::Names {
        names: names.into_iter().map(|(name, ())| name).collect(),
        truncated,
    }
}

/// The body of `folder_siblings` with the scope predicate and the time budget injected.
pub fn siblings_of(
    path: &str,
    pattern: &str,
    budget: Duration,
    is_allowed: &dyn Fn(&Path) -> bool,
) -> Result<FolderSiblings, &'static str> {
    check_path_text(path, cfg!(windows))?;
    let pattern = compile_sibling_pattern(pattern)?;
    let document = Path::new(path);
    if !is_allowed(document) {
        return Err(E_NOT_ALLOWED);
    }
    let folder = match document.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => return Err(E_NOT_ALLOWED),
    };
    let key = folder.to_string_lossy().into_owned();
    let listed = files::run_bounded(vec![key], budget, move |_| {
        list_folder(&folder, &pattern, MAX_SIBLING_NAMES, MAX_SIBLING_ENTRIES)
    })
    .into_iter()
    .next()
    .flatten();
    match listed {
        Some(Listing::Names { names, truncated }) => Ok(FolderSiblings {
            names,
            truncated,
            unavailable: false,
        }),
        // A folder that is not there answers like a path that is not allowed.
        Some(Listing::Absent) => Err(E_NOT_ALLOWED),
        Some(Listing::Unavailable) | None => Ok(FolderSiblings {
            unavailable: true,
            ..FolderSiblings::default()
        }),
    }
}

// --- the grant (S6) ----------------------------------------------------------------------------

/// The checks of `folder_grant`. `root` passes S1 and is a folder; `path` is absolute, has no `..`
/// and lies below the resolved root by components; every step below the root is a plain folder
/// (no link, no reparse point) and the last a regular file; it is not gEdit's own state file.
/// Answers the path to grant: the resolved root with the file's own components.
pub fn grant_target(
    root: &str,
    path: &str,
    is_allowed: &dyn Fn(&Path) -> bool,
    state_file: &Path,
) -> Result<PathBuf, &'static str> {
    let resolved = resolve_root(root, is_allowed)?;
    check_path_text(path, cfg!(windows))?;
    let given = Path::new(path);
    let below = given
        .strip_prefix(&resolved)
        .or_else(|_| given.strip_prefix(root))
        .map_err(|_| E_NOT_IN_FOLDER)?;
    let steps: Vec<Component<'_>> = below.components().collect();
    if steps.is_empty() {
        return Err(E_NOT_IN_FOLDER);
    }
    let mut target = resolved;
    for (at, step) in steps.iter().enumerate() {
        let Component::Normal(name) = step else {
            return Err(E_NOT_IN_FOLDER);
        };
        target.push(name);
        let meta = fs::symlink_metadata(&target).map_err(|_| E_NOT_IN_FOLDER)?;
        if is_reparse(attributes_of(&meta)) || meta.file_type().is_symlink() {
            return Err(E_NOT_IN_FOLDER);
        }
        let last = at + 1 == steps.len();
        if last {
            let device = cfg!(windows) && name.to_str().is_none_or(paths::is_device_name);
            if !meta.is_file() || device {
                return Err(E_NOT_IN_FOLDER);
            }
        } else if !meta.is_dir() {
            return Err(E_NOT_IN_FOLDER);
        }
    }
    if state::is_state_file(&target, state_file) {
        return Err(E_NOT_IN_FOLDER);
    }
    Ok(target)
}

// --- the commands --------------------------------------------------------------------------------

/// Walks the folder `req.root` and streams what passes the checks of the request. See the
/// plan's section 6.8 for every rule; the summary is the command's result.
///
/// `async`: Tauri runs it off the main thread, and the walk itself runs on a thread of its own.
#[tauri::command]
pub async fn folder_search(
    app: AppHandle,
    registry: State<'_, SearchRegistry>,
    req: FolderSearchRequest,
    on_event: Channel<InvokeResponseBody>,
) -> Result<FolderSummary, String> {
    let checked = Checked::new(&req).map_err(String::from)?;
    let scope = app.fs_scope();
    let registry = registry.inner().clone();
    let root = req.root;
    tauri::async_runtime::spawn_blocking(move || {
        let limits = Limits::default();
        let id = checked.id.clone();
        let walk_limits = limits.clone();
        supervise(&registry, &id, &limits, move |search| {
            let root = resolve_root(&root, &|path| scope.is_allowed(path))?;
            Ok(walk(
                &root,
                &checked,
                &walk_limits,
                search,
                ChannelSink { channel: on_event },
            ))
        })
    })
    .await
    .map_err(|_| E_FAILED.to_string())?
    .map_err(String::from)
}

/// Stops the search `id`. Answers whether one with that id was running.
#[tauri::command]
pub fn folder_search_cancel(
    registry: State<'_, SearchRegistry>,
    id: String,
) -> Result<bool, String> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if !valid {
        return Err(E_ID.into());
    }
    Ok(registry.cancel(&id))
}

/// The names of the regular files in the folder of the open document `path` that fit
/// `pattern` (globs, `*` and `?`, case-insensitive). Names only: no content, no folder, no
/// link. `path` is the document's own path and must be allowed by the fs scope.
#[tauri::command]
pub async fn folder_siblings(
    app: AppHandle,
    path: String,
    pattern: String,
) -> Result<FolderSiblings, String> {
    let scope = app.fs_scope();
    tauri::async_runtime::spawn_blocking(move || {
        siblings_of(&path, &pattern, files::STAT_BUDGET, &|p| {
            scope.is_allowed(p)
        })
    })
    .await
    .map_err(|_| E_FAILED.to_string())?
    .map_err(String::from)
}

/// Grants the one file `path` to the fs scope so the webview can open it, when it lies in
/// `root` (a folder the scope already allows), and every step between is a plain folder and
/// the file a regular file (no link). Never grants a folder.
#[tauri::command]
pub async fn folder_grant(app: AppHandle, root: String, path: String) -> Result<(), String> {
    let scope = app.fs_scope();
    let state_file = paths::app_dirs(&app)
        .map_err(|_| E_FAILED.to_string())?
        .state_file();
    tauri::async_runtime::spawn_blocking(move || {
        let target = grant_target(&root, &path, &|p| scope.is_allowed(p), &state_file)?;
        state::grant_file(&app, &target);
        Ok(())
    })
    .await
    .map_err(|_| E_FAILED.to_string())?
    .map_err(|reason: &str| reason.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source_scan;
    use std::sync::mpsc::channel;
    use std::sync::Condvar;

    // --- the plan's numbers and the wire shapes (the prelude's) -------------------------------

    /// The plan's section 6.8 states these numbers; a change is a plan change.
    #[test]
    fn the_limits_are_the_plan_s() {
        assert_eq!(MAX_PATH_CHARS, 4096);
        assert_eq!(MAX_DEPTH, 16);
        assert_eq!(MAX_ENTRIES, 200_000);
        assert_eq!(MAX_DIR_ENTRIES, 50_000);
        assert_eq!(MAX_FILES_READ, 20_000);
        assert_eq!(MAX_FILE_BYTES, 16 * 1024 * 1024);
        assert_eq!(MAX_TOTAL_BYTES, 1024 * 1024 * 1024);
        assert_eq!(MAX_SENT_BYTES, 256 * 1024 * 1024);
        assert_eq!(MAX_SECONDS, 600);
        assert_eq!(BINARY_PROBE_BYTES, 8192);
        assert_eq!(MAX_PATTERNS, 16);
        assert_eq!(MAX_PATTERN_CHARS, 128);
        assert_eq!(MAX_CONTAINS_BYTES, 256);
        assert_eq!(MAX_LISTED_NAMES, 20);
        assert_eq!(MAX_ABANDONED_SEARCHES, 4);
        assert_eq!(MAX_SIBLING_NAMES, 5_000);
        assert_eq!(MIN_SIBLING_LITERALS, 2);
        assert_eq!(MAX_SIBLING_ENTRIES, 50_000);
    }

    /// The limits one search obeys are the constants, nothing else.
    #[test]
    fn the_default_limits_are_the_constants() {
        let limits = Limits::default();
        assert_eq!(limits.depth, MAX_DEPTH);
        assert_eq!(limits.entries, MAX_ENTRIES);
        assert_eq!(limits.dir_entries, MAX_DIR_ENTRIES);
        assert_eq!(limits.files, MAX_FILES_READ);
        assert_eq!(limits.file_bytes, MAX_FILE_BYTES);
        assert_eq!(limits.total_bytes, MAX_TOTAL_BYTES);
        assert_eq!(limits.sent_bytes, MAX_SENT_BYTES);
        assert_eq!(limits.time, Duration::from_secs(600));
    }

    /// A file larger than the search reads is still one the editor can open.
    // A file the search skips is smaller than what the editor opens (50 MiB).
    const _: () = assert!(MAX_FILE_BYTES < 50 * 1024 * 1024);

    #[test]
    fn a_request_is_camel_case_and_refuses_unknown_members() {
        let ok: FolderSearchRequest = serde_json::from_value(serde_json::json!({
            "id": "s-1",
            "root": "/nc",
            "recursive": true,
            "namePatterns": ["*.nc"],
            "modifiedAfter": 1,
            "modifiedBefore": null,
            "contains": { "text": "T17", "caseSensitive": false }
        }))
        .unwrap();
        assert_eq!(ok.name_patterns, vec!["*.nc".to_owned()]);
        assert_eq!(ok.contains.unwrap().text, "T17");
        // A member this build does not know is an error, not ignored: the webview and the
        // command must agree on every field that narrows or widens a search.
        let extra = serde_json::from_value::<FolderSearchRequest>(serde_json::json!({
            "id": "s-1", "root": "/nc", "recursive": false, "followLinks": true
        }));
        assert!(extra.is_err());
    }

    #[test]
    fn the_events_and_the_summary_are_camel_case_on_the_wire() {
        let file = serde_json::to_value(FolderEvent::File {
            index: 0,
            path: "/nc/a.nc".into(),
            rel: "a.nc".into(),
            bytes: 3,
            mtime_ms: Some(1.5),
        })
        .unwrap();
        assert_eq!(
            file,
            serde_json::json!({ "kind": "file", "index": 0, "path": "/nc/a.nc", "rel": "a.nc", "bytes": 3, "mtimeMs": 1.5 })
        );
        let progress = serde_json::to_value(FolderEvent::Progress {
            entries_seen: 2,
            files_read: 1,
        })
        .unwrap();
        assert_eq!(
            progress,
            serde_json::json!({ "kind": "progress", "entriesSeen": 2, "filesRead": 1 })
        );
        let summary = serde_json::to_value(FolderSummary {
            stopped_by: Some(FolderStop::Files),
            ..FolderSummary::default()
        })
        .unwrap();
        assert_eq!(summary["stoppedBy"], "files");
        assert_eq!(summary["skipped"]["tooLarge"], 0);
        assert_eq!(summary["tooLargeNames"], serde_json::json!([]));
    }

    // --- helpers -------------------------------------------------------------------------------

    /// A fresh folder under the temp folder, resolved (macOS keeps `/var` behind `/private`).
    fn scratch(name: &str) -> PathBuf {
        // Unique per call: the tests of one run share the temp folder, and so may two runs.
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_nanos());
        let root = std::env::temp_dir().join(format!("gedit-folders-{name}-{stamp}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        // The ordinary spelling: Windows resolves to `\\?\C:\...`, which the commands refuse.
        paths::plain(&fs::canonicalize(&root).unwrap()).into_owned()
    }

    fn put(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, bytes).unwrap();
    }

    fn all(_: &Path) -> bool {
        true
    }

    fn request(extra: serde_json::Value) -> Checked {
        let mut value = serde_json::json!({ "id": "s-1", "root": "/unused", "recursive": true });
        if let (Some(base), Some(add)) = (value.as_object_mut(), extra.as_object()) {
            for (key, member) in add {
                base.insert(key.clone(), member.clone());
            }
        }
        Checked::new(&serde_json::from_value(value).unwrap()).unwrap()
    }

    /// What a test sink collects.
    #[derive(Default)]
    struct Collect {
        files: Vec<(String, Vec<u8>)>,
        progress: u32,
        refuse: bool,
    }

    impl Sink for Collect {
        fn file(&mut self, event: FolderEvent, data: Vec<u8>) -> bool {
            if self.refuse {
                return false;
            }
            if let FolderEvent::File { rel, bytes, .. } = event {
                assert_eq!(
                    bytes as usize,
                    data.len(),
                    "the size announced is the size sent"
                );
                self.files.push((rel, data));
            }
            true
        }
        fn progress(&mut self, _: u32, _: u32) -> bool {
            self.progress += 1;
            true
        }
    }

    fn run_with(root: &Path, req: &Checked, limits: &Limits) -> (FolderSummary, Collect) {
        let search = Search::new();
        let mut sink = Collect::default();
        let summary = walk(root, req, limits, &search, &mut sink);
        (summary, sink)
    }

    fn run(root: &Path, req: &Checked) -> (FolderSummary, Collect) {
        run_with(root, req, &Limits::default())
    }

    fn rels(sink: &Collect) -> Vec<&str> {
        sink.files.iter().map(|(rel, _)| rel.as_str()).collect()
    }

    // --- S1: the shape of a path -----------------------------------------------------------------

    #[test]
    fn a_path_must_be_plain_absolute_and_short() {
        // Unix reading.
        for ok in ["/", "/nc", "/nc/a b.nc", "/nc/.hidden/x", "/a//b", "/a/./b"] {
            assert_eq!(check_path_text(ok, false), Ok(()), "{ok}");
        }
        for bad in [
            "",
            "nc",
            "./nc",
            "~",
            "~/nc",
            "$HOME/nc",
            "%APPDATA%",
            "../nc",
            "/nc/../etc",
            "/..",
            "/nc/..",
            "C:\\nc",
            "\\\\host\\share",
            "/nc\0x",
        ] {
            assert_eq!(check_path_text(bad, false), Err(E_PATH), "{bad:?}");
        }
        // Windows reading.
        for ok in [
            r"C:\",
            r"c:\nc\a.nc",
            "C:/nc/a.nc",
            r"\\dnc\machine1",
            r"\\dnc\machine1\x\a.nc",
            "//dnc/machine1/a",
        ] {
            assert_eq!(check_path_text(ok, true), Ok(()), "{ok}");
        }
        for bad in [
            r"\\?\C:\nc",
            r"\\.\pipe\x",
            "//?/C:/nc",
            r"\\?\UNC\dnc\m",
            r"\nc",
            "/nc",
            r"C:nc",
            r"C:",
            "nc",
            r"\\dnc",
            r"\\dnc\",
            r"C:\nc\..\x",
            r"C:\nc\...\x",
            r"C:\nc\.. \x",
            r"C:\nc\a.nc:stream",
            r"D:\a:b",
            r"\\dnc\m\a:b",
        ] {
            assert_eq!(check_path_text(bad, true), Err(E_PATH), "{bad:?}");
        }
        // Length: 4,096 characters, counted as characters.
        let long = format!("/{}", "a".repeat(MAX_PATH_CHARS - 1));
        assert_eq!(check_path_text(&long, false), Ok(()));
        assert_eq!(
            check_path_text(&format!("{long}a"), false),
            Err(E_PATH_LONG)
        );
        let wide = format!("/{}", "ä".repeat(MAX_PATH_CHARS - 1));
        assert_eq!(check_path_text(&wide, false), Ok(()));
    }

    #[test]
    fn a_drive_or_file_system_root_is_not_a_folder_to_search() {
        assert!(is_filesystem_root(Path::new("/")));
        assert!(!is_filesystem_root(Path::new("/nc")));
        #[cfg(windows)]
        {
            assert!(is_filesystem_root(Path::new(r"C:\")));
            assert!(!is_filesystem_root(Path::new(r"C:\nc")));
            assert!(!is_filesystem_root(Path::new(r"\\dnc\machine1")));
        }
    }

    #[test]
    fn a_root_that_is_not_allowed_and_one_that_is_missing_answer_alike() {
        let dir = scratch("root-alike");
        let here = dir.to_str().unwrap();
        assert_eq!(resolve_root(here, &|_| false), Err(E_NOT_ALLOWED));
        let missing = dir.join("nowhere");
        assert_eq!(
            resolve_root(missing.to_str().unwrap(), &all),
            Err(E_NOT_ALLOWED)
        );
        // The scope is asked before anything else is looked at.
        let asked = std::cell::Cell::new(0);
        let _ = resolve_root(here, &|_| {
            asked.set(asked.get() + 1);
            false
        });
        assert_eq!(asked.get(), 1);
        assert_eq!(resolve_root(here, &all), Ok(dir.clone()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_root_must_be_a_folder_and_not_the_root_of_the_file_system() {
        let dir = scratch("root-kinds");
        let file = dir.join("a.nc");
        put(&file, b"G0\n");
        assert_eq!(
            resolve_root(file.to_str().unwrap(), &all),
            Err(E_NOT_FOLDER)
        );
        #[cfg(unix)]
        assert_eq!(resolve_root("/", &all), Err(E_DRIVE_ROOT));
        // Relative, climbing and unexpanded paths never reach the scope.
        let asked = std::cell::Cell::new(false);
        for bad in ["nc", "./nc", "~", "~/nc", "$HOME", "../nc"] {
            let refused = resolve_root(bad, &|_| {
                asked.set(true);
                true
            });
            assert_eq!(refused, Err(E_PATH), "{bad}");
        }
        let climbing = format!(
            "{}/../{}",
            dir.display(),
            dir.file_name().unwrap().to_str().unwrap()
        );
        assert_eq!(resolve_root(&climbing, &all), Err(E_PATH));
        assert!(!asked.get());
        let _ = fs::remove_dir_all(&dir);
    }

    /// A root that is itself a link is resolved once and then is the folder it points at.
    #[cfg(unix)]
    #[test]
    fn a_root_that_is_a_link_is_resolved_once() {
        let dir = scratch("root-link");
        let real = dir.join("real");
        put(&real.join("a.nc"), b"G0\n");
        let link = dir.join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let resolved = resolve_root(link.to_str().unwrap(), &all).unwrap();
        assert_eq!(resolved, real);
        let (summary, sink) = run(&resolved, &request(serde_json::json!({})));
        assert_eq!(rels(&sink), ["a.nc"]);
        assert_eq!(summary.skipped.links, 0);
        let _ = fs::remove_dir_all(&dir);
    }

    // --- S2: the walk -----------------------------------------------------------------------------

    #[test]
    fn the_walk_sends_files_in_a_fixed_order_with_paths_below_the_root() {
        let dir = scratch("order");
        for name in [
            "b.nc",
            "B2.nc",
            "a.nc",
            "C.nc",
            "sub/z.nc",
            "sub/deep/d.nc",
            "Sub2/x.nc",
        ] {
            put(&dir.join(name), name.as_bytes());
        }
        let req = request(serde_json::json!({}));
        let (summary, sink) = run(&dir, &req);
        assert_eq!(
            rels(&sink),
            [
                "a.nc",
                "b.nc",
                "B2.nc",
                "C.nc",
                "sub/deep/d.nc",
                "sub/z.nc",
                "Sub2/x.nc"
            ]
        );
        assert_eq!(summary.files_sent, 7);
        assert_eq!(summary.files_read, 7);
        assert_eq!(summary.stopped_by, None);
        // The same search sends the same files in the same order.
        let (_, again) = run(&dir, &req);
        assert_eq!(rels(&again), rels(&sink));
        for (rel, data) in &sink.files {
            assert_eq!(data, rel.as_bytes(), "the bytes are the file's own");
        }
        // Not recursive: the folders below are not entered.
        let (flat, flat_sink) = run(&dir, &request(serde_json::json!({ "recursive": false })));
        assert_eq!(rels(&flat_sink), ["a.nc", "b.nc", "B2.nc", "C.nc"]);
        assert_eq!(flat.stopped_by, None);
        let _ = fs::remove_dir_all(&dir);
    }

    /// The path of a file is the resolved root and the names, as the walk found them.
    #[test]
    fn the_event_carries_the_path_and_the_relative_path() {
        struct Paths(Vec<(String, String)>);
        impl Sink for Paths {
            fn file(&mut self, event: FolderEvent, _: Vec<u8>) -> bool {
                if let FolderEvent::File { path, rel, .. } = event {
                    self.0.push((path, rel));
                }
                true
            }
            fn progress(&mut self, _: u32, _: u32) -> bool {
                true
            }
        }
        let dir = scratch("paths");
        put(&dir.join("sub").join("a.nc"), b"G0\n");
        let mut sink = Paths(Vec::new());
        walk(
            &dir,
            &request(serde_json::json!({})),
            &Limits::default(),
            &Search::new(),
            &mut sink,
        );
        let expected = (
            dir.join("sub").join("a.nc").to_str().unwrap().to_owned(),
            "sub/a.nc".to_owned(),
        );
        assert_eq!(sink.0, vec![expected]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn name_patterns_decide_before_the_file_is_opened() {
        let dir = scratch("patterns");
        put(&dir.join("PART1.NC"), b"AAAA");
        put(&dir.join("part2.tap"), b"BBBB");
        put(&dir.join("notes.txt"), b"CCCCCCCC");
        put(&dir.join("sub").join("deep.nc"), b"DD");
        let req = request(serde_json::json!({ "namePatterns": ["*.nc", "PART?.TAP"] }));
        let (summary, sink) = run(&dir, &req);
        assert_eq!(rels(&sink), ["PART1.NC", "part2.tap", "sub/deep.nc"]);
        // The read counter: the file that does not fit was never opened, so none of its bytes
        // were read.
        assert_eq!(summary.files_read, 3);
        assert_eq!(summary.bytes_read, 4 + 4 + 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dates_decide_before_the_file_is_opened() {
        let dir = scratch("dates");
        let base = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        for (name, offset) in [
            ("old.nc", 0u64),
            ("edge.nc", 100),
            ("mid.nc", 150),
            ("late.nc", 200),
            ("new.nc", 300),
        ] {
            let path = dir.join(name);
            put(&path, name.as_bytes());
            fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(base + Duration::from_secs(offset))
                .unwrap();
        }
        let after = 1_700_000_100_000_i64;
        let before = 1_700_000_200_000_i64;
        let req = request(serde_json::json!({ "modifiedAfter": after, "modifiedBefore": before }));
        let (summary, sink) = run(&dir, &req);
        // `after` is inclusive and `before` exclusive.
        assert_eq!(rels(&sink), ["edge.nc", "mid.nc"]);
        assert_eq!(summary.files_read, 2);
        assert_eq!(
            summary.bytes_read,
            ("edge.nc".len() + "mid.nc".len()) as u64
        );
        let (_, only_after) = run(
            &dir,
            &request(serde_json::json!({ "modifiedAfter": after })),
        );
        assert_eq!(
            rels(&only_after),
            ["edge.nc", "late.nc", "mid.nc", "new.nc"]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_text_prefilter_holds_back_a_file_that_cannot_match() {
        let dir = scratch("contains");
        put(&dir.join("has.nc"), b"N10 t17 M6\n");
        put(&dir.join("has-not.nc"), b"N10 G0 X1\n");
        put(&dir.join("upper.nc"), b"N10 T17 M6\n");
        // A UTF-16 file: its bytes are not ASCII, so the prefilter lets it through.
        let mut utf16 = vec![0xFF, 0xFE];
        for unit in "G0 X1\n".encode_utf16() {
            utf16.extend_from_slice(&unit.to_le_bytes());
        }
        put(&dir.join("wide.nc"), &utf16);
        let insensitive =
            request(serde_json::json!({ "contains": { "text": "T17", "caseSensitive": false } }));
        let (summary, sink) = run(&dir, &insensitive);
        assert_eq!(rels(&sink), ["has.nc", "upper.nc", "wide.nc"]);
        // The file that does not hold it was read (that is how it was known) and not sent.
        assert_eq!(summary.files_read, 4);
        assert_eq!(summary.files_sent, 3);
        let sensitive =
            request(serde_json::json!({ "contains": { "text": "T17", "caseSensitive": true } }));
        let (_, sink) = run(&dir, &sensitive);
        assert_eq!(rels(&sink), ["upper.nc", "wide.nc"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_binary_file_is_not_sent_and_a_utf16_file_with_a_mark_is() {
        let dir = scratch("binary");
        let mut blob = vec![b'a'; 100];
        blob[40] = 0;
        blob.extend(vec![b'b'; 1_000_000]);
        put(&dir.join("blob.nc"), &blob);
        // A NUL after the probe is not looked for.
        let mut late = vec![b'a'; BINARY_PROBE_BYTES];
        late.push(0);
        put(&dir.join("late-nul.nc"), &late);
        let mut utf16 = vec![0xFE, 0xFF];
        for unit in "G0 X1\n".encode_utf16() {
            utf16.extend_from_slice(&unit.to_be_bytes());
        }
        put(&dir.join("wide.nc"), &utf16);
        put(&dir.join("text.nc"), b"G0 X1\n");
        let (summary, sink) = run(&dir, &request(serde_json::json!({})));
        assert_eq!(rels(&sink), ["late-nul.nc", "text.nc", "wide.nc"]);
        assert_eq!(summary.skipped.binary, 1);
        // The binary file's remainder was never read.
        assert!(summary.bytes_read < 1_000_000, "{}", summary.bytes_read);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hidden_files_and_folders_are_skipped_and_counted() {
        let dir = scratch("hidden");
        put(&dir.join(".secret.nc"), b"G0\n");
        put(&dir.join(".git").join("inside.nc"), b"G0\n");
        put(&dir.join("shown.nc"), b"G0\n");
        let (summary, sink) = run(&dir, &request(serde_json::json!({})));
        assert_eq!(rels(&sink), ["shown.nc"]);
        assert_eq!(summary.skipped.hidden, 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_windows_attribute_bits_are_read_right() {
        assert!(is_reparse(0x400));
        assert!(is_reparse(0x420));
        assert!(!is_reparse(0x20));
        assert!(is_hidden_attributes(0x2));
        assert!(is_hidden_attributes(0x4));
        assert!(is_hidden_attributes(0x26));
        assert!(!is_hidden_attributes(0x20));
        assert!(!is_hidden_attributes(0x10));
        // The DOS device names a Windows walk refuses are the ones `paths` knows.
        for name in ["CON", "nul.nc", "COM1", "lpt9.tap"] {
            assert!(paths::is_device_name(name), "{name}");
        }
        assert!(!paths::is_device_name("console.nc"));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_a_file_or_to_a_folder_is_not_followed_and_is_counted() {
        let dir = scratch("links");
        let outside = scratch("links-outside");
        put(&outside.join("secret.nc"), b"SECRET\n");
        put(&outside.join("folder").join("deep.nc"), b"SECRET\n");
        let root = dir.join("root");
        put(&root.join("real.nc"), b"G0\n");
        std::os::unix::fs::symlink(outside.join("secret.nc"), root.join("file-link.nc")).unwrap();
        std::os::unix::fs::symlink(outside.join("folder"), root.join("folder-link")).unwrap();
        std::os::unix::fs::symlink(root.join("real.nc"), root.join("inner-link.nc")).unwrap();
        std::os::unix::fs::symlink(root.join("missing"), root.join("dangling.nc")).unwrap();
        let (summary, sink) = run(&root, &request(serde_json::json!({})));
        assert_eq!(rels(&sink), ["real.nc"]);
        assert_eq!(summary.skipped.links, 4);
        assert!(sink.files.iter().all(|(_, data)| data != b"SECRET\n"));
        // A file that became a link between the listing and the open is refused by the open.
        assert!(matches!(
            open_plain(&root.join("file-link.nc")),
            Err(OpenFailure::Link)
        ));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&outside);
    }

    /// The containment check after the open: a file whose own resolved path is outside the
    /// root (a folder swapped for a link after the listing is the real-life case) is not read.
    #[cfg(unix)]
    #[test]
    fn a_file_that_resolves_outside_the_root_is_not_read() {
        let dir = scratch("contain");
        let outside = scratch("contain-outside");
        put(&outside.join("a.nc"), b"SECRET\n");
        let root = dir.join("root");
        fs::create_dir_all(&root).unwrap();
        // `root/swapped` is a link to a folder: a path through it opens fine, resolves elsewhere.
        std::os::unix::fs::symlink(&outside, root.join("swapped")).unwrap();
        let req = request(serde_json::json!({}));
        let search = Search::new();
        let limits = Limits::default();
        let mut sink = Collect::default();
        let mut walker = Walker {
            root: root.clone(),
            req: &req,
            limits: &limits,
            search: &search,
            sink: &mut sink,
            deadline: Instant::now() + Duration::from_secs(60),
            last_progress: Instant::now(),
            stop: None,
            next_index: 0,
            bytes_sent: 0,
            chunk: vec![0; READ_CHUNK],
        };
        assert!(matches!(
            walker.read_file(&root.join("swapped").join("a.nc")),
            Outcome::Link
        ));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&outside);
    }

    #[cfg(unix)]
    #[test]
    fn a_pipe_is_never_opened() {
        use std::ffi::CString;
        let dir = scratch("fifo");
        put(&dir.join("a.nc"), b"G0\n");
        let fifo = CString::new(dir.join("pipe.nc").to_str().unwrap()).unwrap();
        // SAFETY: a valid NUL-terminated path; mkfifo creates a file and touches no memory.
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
        let started = Instant::now();
        let (summary, sink) = run(&dir, &request(serde_json::json!({})));
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "the walk waited on a pipe"
        );
        assert_eq!(rels(&sink), ["a.nc"]);
        assert_eq!(summary.skipped.unreadable, 1);
        assert_eq!(summary.files_read, 1, "the pipe was not opened");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_file_that_cannot_be_read_is_counted() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("unreadable");
        put(&dir.join("a.nc"), b"G0\n");
        put(&dir.join("locked.nc"), b"G0\n");
        fs::set_permissions(dir.join("locked.nc"), fs::Permissions::from_mode(0o000)).unwrap();
        // Root can read anything; the check is meaningless there.
        if fs::File::open(dir.join("locked.nc")).is_ok() {
            let _ = fs::remove_dir_all(&dir);
            return;
        }
        let (summary, sink) = run(&dir, &request(serde_json::json!({})));
        assert_eq!(rels(&sink), ["a.nc"]);
        assert_eq!(summary.skipped.unreadable, 1);
        let _ = fs::remove_dir_all(&dir);
    }

    // --- S3: sizes, counts and every stop reason -----------------------------------------------------

    #[test]
    fn a_file_larger_than_the_limit_is_not_searched_and_is_named() {
        let dir = scratch("too-large");
        // The real limit, on a sparse file: only its length matters, nothing is read.
        let big = fs::File::create(dir.join("big.nc")).unwrap();
        big.set_len(MAX_FILE_BYTES + 1).unwrap();
        drop(big);
        put(&dir.join("sub").join("small.nc"), b"G0\n");
        let (summary, sink) = run(&dir, &request(serde_json::json!({})));
        assert_eq!(rels(&sink), ["sub/small.nc"]);
        assert_eq!(summary.skipped.too_large, 1);
        assert_eq!(summary.too_large_names, vec!["big.nc".to_owned()]);
        assert_eq!(summary.bytes_read, 3, "nothing of the big file was read");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_size_limit_is_exact_and_the_names_are_capped() {
        let dir = scratch("size-edge");
        put(&dir.join("exact.nc"), &[b'a'; 100]);
        put(&dir.join("over.nc"), &[b'a'; 101]);
        let limits = Limits {
            file_bytes: 100,
            ..Limits::default()
        };
        let (summary, sink) = run_with(&dir, &request(serde_json::json!({})), &limits);
        assert_eq!(rels(&sink), ["exact.nc"]);
        assert_eq!(summary.skipped.too_large, 1);

        let many = scratch("size-names");
        for n in 0..25 {
            put(&many.join(format!("f{n:02}.nc")), b"aa");
        }
        let one = Limits {
            file_bytes: 1,
            ..Limits::default()
        };
        let (summary, _) = run_with(&many, &request(serde_json::json!({})), &one);
        assert_eq!(summary.skipped.too_large, 25);
        assert_eq!(summary.too_large_names.len(), MAX_LISTED_NAMES);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&many);
    }

    /// A file that grows while it is read: the bytes past the limit are not read, the file is too large.
    #[test]
    fn a_file_that_grows_while_it_is_read_is_too_large() {
        struct Endless;
        impl Read for Endless {
            fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
                buf.fill(b'a');
                Ok(buf.len())
            }
        }
        let req = request(serde_json::json!({}));
        let search = Search::new();
        let limits = Limits {
            file_bytes: 100_000,
            ..Limits::default()
        };
        let mut sink = Collect::default();
        let mut walker = Walker {
            root: PathBuf::from("/"),
            req: &req,
            limits: &limits,
            search: &search,
            sink: &mut sink,
            deadline: Instant::now() + Duration::from_secs(60),
            last_progress: Instant::now(),
            stop: None,
            next_index: 0,
            bytes_sent: 0,
            chunk: vec![0; READ_CHUNK],
        };
        // Declared small (what the handle said), delivers more.
        assert!(matches!(walker.read_body(Endless, 10), Outcome::TooLarge));
        assert!(search.summary().bytes_read <= 100_000 + READ_CHUNK as u64);
    }

    #[test]
    fn the_search_stops_at_the_entry_limit() {
        let dir = scratch("stop-entries");
        for n in 0..6 {
            put(&dir.join(format!("f{n}.nc")), b"G0\n");
        }
        let limits = Limits {
            entries: 3,
            ..Limits::default()
        };
        let (summary, sink) = run_with(&dir, &request(serde_json::json!({})), &limits);
        assert_eq!(summary.stopped_by, Some(FolderStop::Entries));
        assert_eq!(summary.entries_seen, 3);
        assert_eq!(sink.files.len(), 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_search_stops_at_the_file_limit() {
        let dir = scratch("stop-files");
        for n in 0..6 {
            put(&dir.join(format!("f{n}.nc")), b"G0\n");
        }
        let limits = Limits {
            files: 2,
            ..Limits::default()
        };
        let (summary, sink) = run_with(&dir, &request(serde_json::json!({})), &limits);
        assert_eq!(summary.stopped_by, Some(FolderStop::Files));
        assert_eq!(summary.files_read, 2);
        assert_eq!(sink.files.len(), 2);
        // A file that the name pattern left out does not use up a place.
        let narrow = request(serde_json::json!({ "namePatterns": ["f5.nc"] }));
        let (summary, sink) = run_with(&dir, &narrow, &limits);
        assert_eq!(summary.stopped_by, None);
        assert_eq!(rels(&sink), ["f5.nc"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_search_stops_at_the_bytes_read_and_at_the_bytes_sent() {
        let dir = scratch("stop-bytes");
        for name in ["a.nc", "b.nc", "c.nc"] {
            put(&dir.join(name), &[b'a'; 8]);
        }
        let read = Limits {
            total_bytes: 10,
            ..Limits::default()
        };
        let (summary, sink) = run_with(&dir, &request(serde_json::json!({})), &read);
        assert_eq!(summary.stopped_by, Some(FolderStop::Bytes));
        assert_eq!(rels(&sink), ["a.nc"]);
        assert!(summary.bytes_read <= 10, "{}", summary.bytes_read);

        let sent = Limits {
            sent_bytes: 10,
            ..Limits::default()
        };
        let (summary, sink) = run_with(&dir, &request(serde_json::json!({})), &sent);
        assert_eq!(summary.stopped_by, Some(FolderStop::Bytes));
        assert_eq!(rels(&sink), ["a.nc"]);
        assert_eq!(summary.files_sent, 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_search_stops_at_the_time_limit() {
        let dir = scratch("stop-time");
        put(&dir.join("a.nc"), b"G0\n");
        let limits = Limits {
            time: Duration::ZERO,
            ..Limits::default()
        };
        let (summary, sink) = run_with(&dir, &request(serde_json::json!({})), &limits);
        assert_eq!(summary.stopped_by, Some(FolderStop::Time));
        assert!(sink.files.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_search_stops_when_cancelled_or_when_the_window_is_gone() {
        let dir = scratch("stop-cancel");
        for n in 0..4 {
            put(&dir.join(format!("f{n}.nc")), b"G0\n");
        }
        let search = Search::new();
        search.cancel.store(true, Ordering::Relaxed);
        let mut sink = Collect::default();
        let summary = walk(
            &dir,
            &request(serde_json::json!({})),
            &Limits::default(),
            &search,
            &mut sink,
        );
        assert_eq!(summary.stopped_by, Some(FolderStop::Cancelled));
        assert!(sink.files.is_empty());

        // A send that fails (the window is gone) stops the search.
        let mut gone = Collect {
            refuse: true,
            ..Collect::default()
        };
        let summary = walk(
            &dir,
            &request(serde_json::json!({})),
            &Limits::default(),
            &Search::new(),
            &mut gone,
        );
        assert_eq!(summary.stopped_by, Some(FolderStop::Cancelled));
        assert_eq!(summary.files_sent, 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn folders_below_the_depth_limit_and_folders_with_too_many_entries_are_skipped_and_counted() {
        let dir = scratch("depth");
        put(&dir.join("top.nc"), b"G0\n");
        put(&dir.join("l1").join("one.nc"), b"G0\n");
        put(&dir.join("l1").join("l2").join("two.nc"), b"G0\n");
        put(
            &dir.join("l1").join("l2").join("l3").join("three.nc"),
            b"G0\n",
        );
        let limits = Limits {
            depth: 2,
            ..Limits::default()
        };
        let (summary, sink) = run_with(&dir, &request(serde_json::json!({})), &limits);
        assert_eq!(rels(&sink), ["l1/l2/two.nc", "l1/one.nc", "top.nc"]);
        assert_eq!(summary.skipped.too_deep, 1);
        assert_eq!(summary.stopped_by, None);

        let wide = scratch("big-folder");
        put(&wide.join("ok.nc"), b"G0\n");
        for n in 0..4 {
            put(&wide.join("big").join(format!("f{n}.nc")), b"G0\n");
        }
        let limits = Limits {
            dir_entries: 3,
            ..Limits::default()
        };
        let (summary, sink) = run_with(&wide, &request(serde_json::json!({})), &limits);
        assert_eq!(rels(&sink), ["ok.nc"]);
        assert_eq!(summary.skipped.big_folders, 1);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&wide);
    }

    // --- S4: one search at a time, cancel, abandoned threads -------------------------------------------

    /// A job that holds its thread until the test lets it go (a reader stuck on a hung share).
    fn held_job(
        gate: &Arc<(Mutex<bool>, Condvar)>,
    ) -> impl FnOnce(&Arc<Search>) -> Result<FolderSummary, &'static str> + Send + 'static {
        let gate = Arc::clone(gate);
        move |_| {
            let (lock, cv) = &*gate;
            let mut open = lock.lock().unwrap();
            while !*open {
                open = cv.wait(open).unwrap();
            }
            Ok(FolderSummary::default())
        }
    }

    fn open_gate(gate: &Arc<(Mutex<bool>, Condvar)>) {
        let (lock, cv) = &**gate;
        *lock.lock().unwrap() = true;
        cv.notify_all();
    }

    fn wait_until(what: &str, check: impl Fn() -> bool) {
        let started = Instant::now();
        while !check() {
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "timed out: {what}"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn a_second_search_is_refused_while_one_runs() {
        let registry = SearchRegistry::default();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let first = {
            let (registry, job) = (registry.clone(), held_job(&gate));
            std::thread::spawn(move || supervise(&registry, "s-1", &Limits::default(), job))
        };
        wait_until("the first search registers", || {
            registry.lock().running.is_some()
        });
        let second = supervise(&registry, "s-2", &Limits::default(), |_| {
            Ok(FolderSummary::default())
        });
        assert_eq!(second.unwrap_err(), E_BUSY);
        // Cancelling another id does nothing; the right id answers true.
        assert!(!registry.cancel("s-2"));
        open_gate(&gate);
        assert!(first.join().unwrap().is_ok());
        // The slot is free again.
        assert!(supervise(&registry, "s-3", &Limits::default(), |_| Ok(
            FolderSummary::default()
        ))
        .is_ok());
    }

    #[test]
    fn cancel_answers_at_once_while_a_reader_is_held_and_the_thread_counts_until_it_ends() {
        let registry = SearchRegistry::default();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let search = {
            let (registry, job) = (registry.clone(), held_job(&gate));
            std::thread::spawn(move || supervise(&registry, "s-1", &Limits::default(), job))
        };
        wait_until("the search registers", || registry.lock().running.is_some());
        let asked = Instant::now();
        assert!(registry.cancel("s-1"));
        let summary = search.join().unwrap().unwrap();
        assert!(
            asked.elapsed() < Duration::from_secs(2),
            "{:?}",
            asked.elapsed()
        );
        assert_eq!(summary.stopped_by, Some(FolderStop::Cancelled));
        // The slot is free and the stuck thread is counted.
        assert_eq!(registry.abandoned_count(), 1);
        assert!(registry.lock().running.is_none());
        assert!(supervise(&registry, "s-2", &Limits::default(), |_| Ok(
            FolderSummary::default()
        ))
        .is_ok());
        // When the reader comes back the count goes down.
        open_gate(&gate);
        wait_until("the abandoned thread ends", || {
            registry.abandoned_count() == 0
        });
    }

    #[test]
    fn four_abandoned_searches_refuse_a_new_one_until_one_ends() {
        let registry = SearchRegistry::default();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        for n in 0..MAX_ABANDONED_SEARCHES {
            let id = format!("s-{n}");
            let (reg, job) = (registry.clone(), held_job(&gate));
            let id_run = id.clone();
            let handle =
                std::thread::spawn(move || supervise(&reg, &id_run, &Limits::default(), job));
            wait_until("registers", || registry.lock().running.is_some());
            assert!(registry.cancel(&id));
            assert!(handle.join().unwrap().is_ok());
        }
        assert_eq!(registry.abandoned_count(), MAX_ABANDONED_SEARCHES);
        let refused = supervise(&registry, "s-new", &Limits::default(), |_| {
            Ok(FolderSummary::default())
        });
        assert_eq!(refused.unwrap_err(), E_STUCK);
        open_gate(&gate);
        wait_until("they end", || registry.abandoned_count() == 0);
        assert!(supervise(&registry, "s-new", &Limits::default(), |_| Ok(
            FolderSummary::default()
        ))
        .is_ok());
    }

    #[test]
    fn a_search_that_runs_past_its_time_is_left_behind_with_the_reason_time() {
        let registry = SearchRegistry::default();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let limits = Limits {
            time: Duration::ZERO,
            ..Limits::default()
        };
        let asked = Instant::now();
        let summary = supervise(&registry, "s-1", &limits, held_job(&gate)).unwrap();
        assert!(asked.elapsed() < Duration::from_secs(2));
        assert_eq!(summary.stopped_by, Some(FolderStop::Time));
        assert_eq!(registry.abandoned_count(), 1);
        open_gate(&gate);
        wait_until("the thread ends", || registry.abandoned_count() == 0);
    }

    #[test]
    fn a_job_that_panics_frees_the_slot_and_says_so() {
        let registry = SearchRegistry::default();
        let outcome = supervise(&registry, "s-1", &Limits::default(), |_| panic!("boom"));
        assert_eq!(outcome.unwrap_err(), E_FAILED);
        assert!(registry.lock().running.is_none());
        assert_eq!(registry.abandoned_count(), 0);
    }

    /// The whole path: a real walk under `supervise`, cancelled from outside, answers `cancelled`.
    #[test]
    fn a_real_walk_cancelled_from_outside_ends_with_cancelled() {
        let dir = scratch("supervised");
        for n in 0..3 {
            put(&dir.join(format!("f{n}.nc")), b"G0\n");
        }
        let registry = SearchRegistry::default();
        let (tx, rx) = channel();
        let req = request(serde_json::json!({}));
        let root = dir.clone();
        let summary = supervise(&registry, "s-1", &Limits::default(), move |search| {
            let mut sink = Collect::default();
            let summary = walk(&root, &req, &Limits::default(), search, &mut sink);
            tx.send(sink.files.len()).unwrap();
            Ok(summary)
        })
        .unwrap();
        assert_eq!(rx.recv().unwrap(), 3);
        assert_eq!(summary.files_sent, 3);
        assert_eq!(summary.stopped_by, None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_job_that_is_refused_by_its_root_frees_the_slot() {
        let registry = SearchRegistry::default();
        let refused = supervise(&registry, "s-1", &Limits::default(), |_| {
            resolve_root("/nowhere-at-all", &|_| false).map(|_| FolderSummary::default())
        });
        assert_eq!(refused.unwrap_err(), E_NOT_ALLOWED);
        assert!(registry.lock().running.is_none());
    }

    /// The channel carries a `File` message as JSON and then its bytes as one raw message.
    #[test]
    fn the_channel_gets_the_json_and_then_the_bytes() {
        let log: Arc<Mutex<Vec<InvokeResponseBody>>> = Arc::default();
        let sink_log = Arc::clone(&log);
        let channel = Channel::<InvokeResponseBody>::new(move |body| {
            sink_log.lock().unwrap().push(body);
            Ok(())
        });
        let mut sink = ChannelSink { channel };
        let event = FolderEvent::File {
            index: 0,
            path: "/nc/a.nc".into(),
            rel: "a.nc".into(),
            bytes: 3,
            mtime_ms: None,
        };
        assert!(sink.file(event, b"G0\n".to_vec()));
        assert!(sink.progress(4, 1));
        let log = log.lock().unwrap();
        assert_eq!(log.len(), 3);
        match (&log[0], &log[1], &log[2]) {
            (
                InvokeResponseBody::Json(file),
                InvokeResponseBody::Raw(raw),
                InvokeResponseBody::Json(progress),
            ) => {
                let file: serde_json::Value = serde_json::from_str(file).unwrap();
                assert_eq!(file["kind"], "file");
                assert_eq!(file["bytes"], 3);
                assert_eq!(raw, b"G0\n");
                assert!(progress.contains("\"progress\""));
            }
            _ => panic!("the messages are not json, raw, json"),
        }
    }

    // --- the request and the matchers --------------------------------------------------------------------

    fn parsed(value: serde_json::Value) -> FolderSearchRequest {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn the_request_is_checked_before_a_search_starts() {
        let base = |extra: serde_json::Value| {
            let mut value = serde_json::json!({ "id": "s-1", "root": "/nc", "recursive": true });
            for (key, member) in extra.as_object().unwrap() {
                value[key] = member.clone();
            }
            Checked::new(&parsed(value))
        };
        assert!(base(serde_json::json!({})).is_ok());
        for id in ["", "S-1", "a_b", "a b", "a/b", &"a".repeat(65)] {
            assert_eq!(
                base(serde_json::json!({ "id": id })).unwrap_err(),
                E_ID,
                "{id}"
            );
        }
        assert!(base(serde_json::json!({ "id": "a".repeat(64) })).is_ok());
        let sixteen: Vec<String> = (0..MAX_PATTERNS).map(|n| format!("*{n}.nc")).collect();
        assert!(base(serde_json::json!({ "namePatterns": sixteen })).is_ok());
        let seventeen: Vec<String> = (0..=MAX_PATTERNS).map(|n| format!("*{n}.nc")).collect();
        assert_eq!(
            base(serde_json::json!({ "namePatterns": seventeen })).unwrap_err(),
            E_PATTERN_COUNT
        );
        for bad in [
            "",
            &"a".repeat(129),
            "sub/*.nc",
            "a\\b",
            "a:b",
            "a|b",
            "a\"b",
            "<a>",
            "a\nb",
            "a\0b",
        ] {
            assert_eq!(
                base(serde_json::json!({ "namePatterns": [bad] })).unwrap_err(),
                E_PATTERN,
                "{bad:?}"
            );
        }
        assert!(base(serde_json::json!({ "namePatterns": ["a".repeat(128)] })).is_ok());
        for text in ["", &"a".repeat(257), "Ünder", "T17ö"] {
            let contains = serde_json::json!({ "text": text, "caseSensitive": false });
            assert_eq!(
                base(serde_json::json!({ "contains": contains })).unwrap_err(),
                E_CONTAINS,
                "{text:?}"
            );
        }
        let contains = serde_json::json!({ "text": "a".repeat(256), "caseSensitive": true });
        assert!(base(serde_json::json!({ "contains": contains })).is_ok());
    }

    #[test]
    fn globs_have_two_wildcards_and_ignore_case() {
        let fits = |pattern: &str, name: &str| glob_match(&fold(pattern), &fold(name));
        assert!(fits("*.nc", "PART.NC"));
        assert!(fits("part?.nc", "Part1.nc"));
        assert!(!fits("part?.nc", "part.nc"));
        assert!(!fits("part?.nc", "part12.nc"));
        assert!(fits("*", ""));
        assert!(fits("a*b*c", "aXXbYYc"));
        assert!(!fits("a*b*c", "aXXbYY"));
        assert!(fits("**a", "bba"));
        assert!(fits("*.nc", ".nc"));
        assert!(!fits("*.nc", "a.nc.bak"));
        assert!(fits("ÄÖ*", "äöx"));
        // A pattern of stars against a long name does not blow up.
        assert!(!fits(&"*a".repeat(60), &"a".repeat(59)));
    }

    #[test]
    fn the_prefilter_finds_a_text_in_linear_time() {
        let needle = |text: &str, cs: bool| Needle::new(text, cs).unwrap();
        assert!(needle("T17", false).is_in(b"N10 t17 M6"));
        assert!(!needle("T17", true).is_in(b"N10 t17 M6"));
        assert!(needle("aab", true).is_in(b"aaaaab"));
        assert!(needle("abab", true).is_in(b"abaabab"));
        assert!(!needle("abab", true).is_in(b"abaaba"));
        assert!(!needle("x", true).is_in(b""));
        let long = vec![b'a'; 4_000_000];
        let started = Instant::now();
        assert!(!needle(&format!("{}b", "a".repeat(250)), true).is_in(&long));
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "the search text is not linear"
        );
    }

    // --- siblings -----------------------------------------------------------------------------------------

    const BUDGET: Duration = Duration::from_secs(5);

    fn names(path: &Path, pattern: &str) -> Vec<String> {
        siblings_of(path.to_str().unwrap(), pattern, BUDGET, &all)
            .unwrap()
            .names
    }

    #[test]
    fn siblings_need_two_fixed_characters_and_list_names_only() {
        let dir = scratch("siblings");
        for name in [
            "PART_CH1.nc",
            "part_ch2.nc",
            "PART3",
            "other.nc",
            "Part.txt",
        ] {
            put(&dir.join(name), b"G0\n");
        }
        fs::create_dir_all(dir.join("PART_DIR")).unwrap();
        let document = dir.join("PART_CH1.nc");
        for refused in [
            "*",
            "?",
            "*.*",
            "P*",
            "?*?",
            "a?",
            "",
            &"P".repeat(129),
            "PA/*",
            "a\\b*",
        ] {
            let answer = siblings_of(document.to_str().unwrap(), refused, BUDGET, &all);
            assert_eq!(answer.unwrap_err(), E_SIBLING_PATTERN, "{refused:?}");
        }
        // Case-insensitive, sorted, a folder is not listed.
        assert_eq!(
            names(&document, "PART*"),
            ["Part.txt", "PART3", "PART_CH1.nc", "part_ch2.nc"]
        );
        assert_eq!(
            names(&document, "part_ch?.nc"),
            ["PART_CH1.nc", "part_ch2.nc"]
        );
        assert_eq!(names(&document, "no*such"), Vec::<String>::new());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn siblings_do_not_list_a_link() {
        let dir = scratch("siblings-links");
        put(&dir.join("PART_REAL.nc"), b"G0\n");
        std::os::unix::fs::symlink(dir.join("PART_REAL.nc"), dir.join("PART_LINK.nc")).unwrap();
        std::os::unix::fs::symlink(&dir, dir.join("PART_DIRLINK")).unwrap();
        assert_eq!(names(&dir.join("PART_REAL.nc"), "PART*"), ["PART_REAL.nc"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn siblings_obey_the_scope_the_shape_and_the_caps() {
        let dir = scratch("siblings-rules");
        put(&dir.join("PART1.nc"), b"G0\n");
        let document = dir.join("PART1.nc");
        let text = document.to_str().unwrap();
        assert_eq!(
            siblings_of(text, "PART*", BUDGET, &|_| false).unwrap_err(),
            E_NOT_ALLOWED
        );
        for bad in ["PART1.nc", "./PART1.nc", "/nc/../etc/passwd", ""] {
            assert_eq!(
                siblings_of(bad, "PART*", BUDGET, &all).unwrap_err(),
                E_PATH,
                "{bad}"
            );
        }
        // A folder that is not there answers like a path that is not allowed.
        let gone = dir.join("gone").join("PART1.nc");
        assert_eq!(
            siblings_of(gone.to_str().unwrap(), "PART*", BUDGET, &all).unwrap_err(),
            E_NOT_ALLOWED
        );
        // The caps: names, and entries looked at.
        for n in 0..10 {
            put(&dir.join(format!("PART_{n}.nc")), b"");
        }
        let pattern = fold("PART*");
        match list_folder(&dir, &pattern, 4, 1000) {
            Listing::Names { names, truncated } => {
                assert_eq!(names.len(), 4);
                assert!(truncated);
            }
            _ => panic!("expected names"),
        }
        match list_folder(&dir, &pattern, 1000, 3) {
            Listing::Names { truncated, .. } => assert!(truncated),
            _ => panic!("expected names"),
        }
        match list_folder(&dir, &pattern, 1000, 1000) {
            Listing::Names { names, truncated } => {
                assert_eq!(names.len(), 11);
                assert!(!truncated);
            }
            _ => panic!("expected names"),
        }
        assert!(matches!(
            list_folder(&dir.join("gone"), &pattern, 10, 10),
            Listing::Absent
        ));
        let _ = fs::remove_dir_all(&dir);
    }

    // --- S6: the grant -----------------------------------------------------------------------------------------

    fn grant(root: &Path, path: &Path, state_file: &Path) -> Result<PathBuf, &'static str> {
        grant_target(
            root.to_str().unwrap(),
            path.to_str().unwrap(),
            &all,
            state_file,
        )
    }

    #[test]
    fn a_file_below_the_root_is_granted_and_nothing_else_is() {
        let dir = scratch("grant");
        let root = dir.join("root");
        let nested = root.join("sub").join("deep").join("a.nc");
        put(&nested, b"G0\n");
        put(&root.join("sub").join("deep").join("other.nc"), b"G0\n");
        let state_file = dir.join("data").join("state.json");
        assert_eq!(grant(&root, &nested, &state_file), Ok(nested.clone()));
        assert_eq!(
            grant(
                &root,
                &root.join("sub").join("deep").join("a.nc"),
                &state_file
            ),
            Ok(nested.clone())
        );

        // The scope gets exactly that file: not its folder, not the file next to it.
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let scope = app.fs_scope();
        scope.allow_directory(&root, false).unwrap();
        assert!(!scope.is_allowed(&nested));
        state::grant_in(&scope, &grant(&root, &nested, &state_file).unwrap());
        assert!(scope.is_allowed(&nested));
        assert!(!scope.is_allowed(root.join("sub").join("deep").join("other.nc")));
        assert!(!scope.is_allowed(root.join("sub").join("deep")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_grant_outside_the_root_or_for_a_folder_is_refused() {
        let dir = scratch("grant-refused");
        let root = dir.join("root");
        put(&root.join("sub").join("a.nc"), b"G0\n");
        // A folder next to the root whose name starts with the root's: not below it.
        let lookalike = dir.join("root-evil").join("a.nc");
        put(&lookalike, b"G0\n");
        let elsewhere = dir.join("elsewhere").join("a.nc");
        put(&elsewhere, b"G0\n");
        let state_file = dir.join("data").join("state.json");
        for outside in [
            &lookalike,
            &elsewhere,
            &root.clone(),
            &root.join("sub"),
            &root.join("sub").join("missing.nc"),
        ] {
            assert_eq!(
                grant(&root, outside, &state_file),
                Err(E_NOT_IN_FOLDER),
                "{}",
                outside.display()
            );
        }
        // A path that climbs or is not absolute never gets that far.
        let climbing = format!("{}/sub/../sub/a.nc", root.display());
        assert_eq!(
            grant_target(root.to_str().unwrap(), &climbing, &all, &state_file),
            Err(E_PATH)
        );
        assert_eq!(
            grant_target(root.to_str().unwrap(), "sub/a.nc", &all, &state_file),
            Err(E_PATH)
        );
        // The root has to be allowed, and has to be a folder.
        let inside = root.join("sub").join("a.nc");
        assert_eq!(
            grant_target(
                root.to_str().unwrap(),
                inside.to_str().unwrap(),
                &|_| false,
                &state_file
            ),
            Err(E_NOT_ALLOWED)
        );
        assert_eq!(grant(&inside, &inside, &state_file), Err(E_NOT_FOLDER));
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_grant_through_a_link_is_refused() {
        let dir = scratch("grant-links");
        let outside = scratch("grant-links-outside");
        put(&outside.join("a.nc"), b"G0\n");
        let root = dir.join("root");
        put(&root.join("real").join("b.nc"), b"G0\n");
        std::os::unix::fs::symlink(&outside, root.join("folder-link")).unwrap();
        std::os::unix::fs::symlink(outside.join("a.nc"), root.join("file-link.nc")).unwrap();
        std::os::unix::fs::symlink(root.join("real"), root.join("inner-link")).unwrap();
        let state_file = dir.join("data").join("state.json");
        for through in [
            root.join("folder-link").join("a.nc"),
            root.join("file-link.nc"),
            root.join("inner-link").join("b.nc"),
        ] {
            assert_eq!(
                grant(&root, &through, &state_file),
                Err(E_NOT_IN_FOLDER),
                "{}",
                through.display()
            );
        }
        assert!(grant(&root, &root.join("real").join("b.nc"), &state_file).is_ok());
        // The root may be spelled through a link: the file granted is the resolved one.
        let spelled = dir.join("spelled");
        std::os::unix::fs::symlink(&root, &spelled).unwrap();
        let granted = grant(&spelled, &spelled.join("real").join("b.nc"), &state_file).unwrap();
        assert_eq!(granted, root.join("real").join("b.nc"));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn gedits_own_state_file_is_never_granted() {
        let dir = scratch("grant-state");
        let root = dir.join("root");
        let state_file = root.join("data").join("state.json");
        put(&state_file, b"{}");
        put(&root.join("data").join("other.json"), b"{}");
        assert_eq!(grant(&root, &state_file, &state_file), Err(E_NOT_IN_FOLDER));
        assert!(grant(&root, &root.join("data").join("other.json"), &state_file).is_ok());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&state_file, root.join("alias.json")).unwrap();
            assert_eq!(
                grant(&root, &root.join("alias.json"), &state_file),
                Err(E_NOT_IN_FOLDER)
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    // --- the module's own rules (S2: read only, no new crate; the closed list of answers) ------------------------

    /// The code of this file without its tests and without comment lines.
    fn code() -> String {
        let source = source_scan::lf(include_str!("folders.rs"));
        let end = source
            .find("\n#[cfg(test)]\nmod tests")
            .expect("the test module");
        source[..end]
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn the_module_only_reads() {
        let code = code();
        for forbidden in [
            "fs::write",
            "File::create",
            "create_dir",
            "remove_file",
            "remove_dir",
            "fs::rename",
            "fs::copy",
            "set_permissions",
            "set_len",
            "hard_link",
            "::symlink(",
            concat!("std::", "process"),
            concat!("std::", "net"),
            ".write(true)",
            ".append(true)",
            ".create(true)",
            ".create_new(",
            ".truncate(true)",
            "Command::new",
            "write_all",
            ".set_modified",
        ] {
            assert!(
                !code.contains(forbidden),
                "folders.rs must not use {forbidden}"
            );
        }
        // No new crate: the roots of the `use` lines are the ones the module has always had.
        for line in code.lines().filter(|l| l.trim_start().starts_with("use ")) {
            let root = line
                .trim_start()
                .trim_start_matches("use ")
                .split([':', ' ', ';'])
                .next()
                .unwrap_or("");
            assert!(
                ["std", "serde", "tauri", "tauri_plugin_fs", "crate"].contains(&root),
                "unexpected use: {line}"
            );
        }
        // Every OS-specific call goes through libc, which the crate already depends on.
        assert!(!code.contains("windows_sys"));
    }

    #[test]
    fn every_answer_is_in_the_closed_list() {
        let code = code();
        // No answer is spelled out in place or built from an error's text.
        assert!(!code.contains("Err(\""), "an Err with an inline sentence");
        assert!(!code.contains("Err(format!"));
        assert!(!code.contains("to_string_lossy().into()"));
        assert!(!code.contains("err.to_string()"));
        assert!(!code.contains("e.to_string()"));
        // The list is exactly the constants.
        let constants: Vec<&str> = code
            .lines()
            .filter_map(|line| line.strip_prefix("pub const E_"))
            .filter_map(|rest| rest.split(':').next())
            .collect();
        assert_eq!(constants.len(), REFUSALS.len(), "{constants:?}");
        let mut unique: Vec<&str> = REFUSALS.to_vec();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(
            unique.len(),
            REFUSALS.len(),
            "two answers are the same sentence"
        );
        // A sentence holds no path separator and no placeholder.
        for sentence in REFUSALS {
            assert!(!sentence.contains(['/', '\\', '{']), "{sentence}");
            assert!(sentence.is_ascii());
        }
    }

    #[test]
    fn the_commands_are_registered_with_their_state() {
        let lib = source_scan::lf(include_str!("lib.rs"));
        for command in [
            "folder_search",
            "folder_search_cancel",
            "folder_siblings",
            "folder_grant",
        ] {
            assert!(
                lib.contains(&format!("folders::{command},")),
                "{command} is not registered"
            );
        }
        assert!(lib.contains(".manage(folders::SearchRegistry::default())"));
        // Each command asks the registry or the scope before it does anything.
        let code = code();
        assert!(code.contains("scope.is_allowed(path)"));
    }
}
