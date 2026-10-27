//! The folder commands (plan Phase 4, AD-53, section 6.8; P4f). Written by the P4f prelude
//! as **stubs**: the limits, the wire types and the command signatures are final, the bodies
//! are `Err("not built yet (P4.27)")` until P4.27 fills them. A signature or a limit changes
//! only with a numbered section 7 row, and a change of a limit goes to the code reviewer
//! first (the security part of section 6.8 is the contract this file is held to).
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

// A stub until its package lands (P4.27 / P4.29): the limits, types and queue are final and tested,
// the code that uses them is not written yet. The package deletes this line.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::AppHandle;

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

const NOT_BUILT: &str = "not built yet (P4.27)";

/// Walks the folder `req.root` and streams what passes the checks of the request. See the
/// plan's section 6.8 for every rule; the summary is the command's result.
///
/// `async`: Tauri runs it off the main thread, and the walk itself runs on the blocking pool.
#[tauri::command]
pub async fn folder_search(
    _app: AppHandle,
    _req: FolderSearchRequest,
    _on_event: Channel<InvokeResponseBody>,
) -> Result<FolderSummary, String> {
    Err(NOT_BUILT.into())
}

/// Stops the search `id`. Answers whether one with that id was running.
#[tauri::command]
pub fn folder_search_cancel(_id: String) -> Result<bool, String> {
    Err(NOT_BUILT.into())
}

/// The names of the regular files in the folder of the open document `path` that fit
/// `pattern` (globs, `*` and `?`, case-insensitive). Names only: no content, no folder, no
/// link. `path` is the document's own path and must be allowed by the fs scope.
#[tauri::command]
pub async fn folder_siblings(
    _app: AppHandle,
    _path: String,
    _pattern: String,
) -> Result<FolderSiblings, String> {
    Err(NOT_BUILT.into())
}

/// Grants the one file `path` to the fs scope so the webview can open it, when it lies in
/// `root` (a folder the scope already allows), and every step between is a plain folder and
/// the file a regular file (no link). Never grants a folder.
#[tauri::command]
pub async fn folder_grant(_app: AppHandle, _root: String, _path: String) -> Result<(), String> {
    Err(NOT_BUILT.into())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// The stubs are registered and say so until P4.27: an honest error, never an empty answer.
    #[test]
    fn the_stub_commands_are_refusals() {
        assert!(folder_search_cancel("s-1".into()).is_err());
    }
}
