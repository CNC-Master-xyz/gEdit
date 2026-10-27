//! `<config>/keybindings.json`: the user's key overrides (Phase 4 plan §6.9 rules 1–3, AD-55).
//! Written by the P4g prelude; P4.34 owns it from here.
//!
//! Rust owns every read and write of the file, under a fixed name, exactly as it owns
//! `machines.json`: a JSON object of at most 1 MiB, written whole and atomically with the
//! current `$version` stamped, an unusable previous file rescued as `keybindings.json.bak`, and a
//! file that carries a newer `$version` read but never overwritten (the shared rules of
//! [`crate::config`]). The webview sends the object and never a path.
//!
//! What is *in* the object is the webview's business: `core/keys/userKeys.ts` validates it
//! entry by entry with JSON paths (a bad entry costs the entry, never the file), and the Keyboard
//! page edits it. Rust checks only what keeps the file a file: an object, the size, the
//! version. The file does not exist until the first save; a missing file is "no overrides".

use serde_json::Value;
use tauri::AppHandle;

use crate::config::{as_object, read_json_object_versioned, save_json_object_versioned, JsonFile};
use crate::paths::{self, AppDirs};

/// The highest `$version` this build writes. Must match `KEYBINDINGS_VERSION` in
/// `src/lib/core/keys/userKeys.ts`.
pub const KEYBINDINGS_VERSION: u32 = 1;

/// The most entries `bindings` may hold. A command id is short; a thousand overrides is
/// already more than any keyboard has keys. Must match `MAX_USER_BINDINGS` in `userKeys.ts`.
pub const MAX_BINDINGS: usize = 1000;

/// What `keybindings_load` answers; camelCase on the wire (`platform/commands.ts`
/// `KeybindingsLoad`).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingsLoad {
    /// The file's object, including `$version`; `{}` when the file is missing or unusable.
    pub keybindings: Value,
    /// English detail for a file that could not be used (AD-14). A write is refused while a
    /// newer-version or unreadable error stands; an unparsable file is rescued as `.bak` by the
    /// next save, as for `settings.json`.
    pub error: Option<String>,
    /// The file was written by a newer gEdit: it is read and never overwritten.
    pub read_only: bool,
}

fn read(dirs: &AppDirs) -> JsonFile {
    read_json_object_versioned(
        &dirs.keybindings_file(),
        paths::KEYBINDINGS_FILE_NAME,
        KEYBINDINGS_VERSION,
    )
}

/// The body of [`keybindings_load`], against a given pair of folders.
pub fn load(dirs: &AppDirs) -> KeybindingsLoad {
    let file = read(dirs);
    KeybindingsLoad {
        keybindings: Value::Object(file.value),
        error: file.error,
        read_only: file.read_only,
    }
}

/// The body of [`keybindings_save`]: replaces the file with `keybindings`, which has to be a
/// JSON object whose `bindings` member (when there is one) is an object of at most
/// [`MAX_BINDINGS`] entries.
pub fn save(dirs: &AppDirs, keybindings: Value) -> Result<(), String> {
    let name = paths::KEYBINDINGS_FILE_NAME;
    let object = as_object(keybindings, name)?;
    match object.get("bindings") {
        None => {}
        Some(Value::Object(bindings)) if bindings.len() <= MAX_BINDINGS => {}
        Some(Value::Object(_)) => {
            return Err(format!(
                "{name}: more than {MAX_BINDINGS} entries in \"bindings\""
            ));
        }
        Some(_) => return Err(format!("{name}: \"bindings\" has to be an object")),
    }
    let current = read(dirs);
    save_json_object_versioned(
        &dirs.keybindings_file(),
        name,
        object,
        &current,
        KEYBINDINGS_VERSION,
    )
}

/// Reads `<config>/keybindings.json`. Never fails: a missing or broken file answers `{}`
/// and says why.
#[tauri::command]
pub fn keybindings_load(app: AppHandle) -> Result<KeybindingsLoad, String> {
    Ok(load(&paths::app_dirs(&app)?))
}

/// Replaces `<config>/keybindings.json` (the whole object, at most 1 MiB, atomically).
#[tauri::command]
pub fn keybindings_save(app: AppHandle, keybindings: Value) -> Result<(), String> {
    save(&paths::app_dirs(&app)?, keybindings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::bak_path;
    use crate::source_scan;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> (PathBuf, AppDirs) {
        let root =
            std::env::temp_dir().join(format!("gedit-keybindings-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dirs = AppDirs {
            config: root.join("config"),
            data: root.join("data"),
        };
        dirs.ensure();
        (root, dirs)
    }

    fn sample() -> Value {
        json!({
            "bindings": {
                "file.save": "Mod+S",
                "view.splitEditor": { "mac": "Mod+Alt+\\", "other": null },
                "script.run:user:facing.py": "Mod+Shift+F9",
                "edit.noKey": null
            }
        })
    }

    /// The Rust constant and the TypeScript one are one number.
    #[test]
    fn the_version_and_the_cap_match_the_typescript_constants() {
        let ts = source_scan::lf(include_str!("../../src/lib/core/keys/userKeys.ts"));
        assert!(
            ts.contains(&format!(
                "export const KEYBINDINGS_VERSION = {KEYBINDINGS_VERSION}"
            )),
            "core/keys/userKeys.ts must declare KEYBINDINGS_VERSION = {KEYBINDINGS_VERSION}"
        );
        assert!(
            ts.contains(&format!("export const MAX_USER_BINDINGS = {MAX_BINDINGS}")),
            "core/keys/userKeys.ts must declare MAX_USER_BINDINGS = {MAX_BINDINGS}"
        );
    }

    #[test]
    fn a_missing_file_is_no_overrides_and_reading_does_not_create_it() {
        let (root, dirs) = scratch("missing");
        let loaded = load(&dirs);
        assert_eq!(loaded.keybindings, json!({}));
        assert_eq!(loaded.error, None);
        assert!(!loaded.read_only);
        assert!(!dirs.keybindings_file().exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_saved_file_comes_back_stamped_with_the_version() {
        let (root, dirs) = scratch("round-trip");
        save(&dirs, sample()).unwrap();
        let loaded = load(&dirs);
        assert_eq!(loaded.error, None);
        assert_eq!(loaded.keybindings["$version"], json!(KEYBINDINGS_VERSION));
        assert_eq!(loaded.keybindings["bindings"], sample()["bindings"]);
        let text = fs::read_to_string(dirs.keybindings_file()).unwrap();
        assert!(text.ends_with('\n'), "the file ends with a newline");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn something_that_is_not_an_object_is_refused_and_nothing_is_written() {
        let (root, dirs) = scratch("shape");
        assert!(save(&dirs, json!(["Mod+S"])).is_err());
        assert!(save(&dirs, json!({ "bindings": ["Mod+S"] })).is_err());
        assert!(!dirs.keybindings_file().exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn more_than_the_cap_of_entries_is_refused() {
        let (root, dirs) = scratch("cap");
        let mut bindings = serde_json::Map::new();
        for i in 0..=MAX_BINDINGS {
            bindings.insert(format!("cmd.n{i}"), json!("Mod+K"));
        }
        let err = save(&dirs, json!({ "bindings": bindings })).unwrap_err();
        assert!(err.contains("more than"), "{err}");
        assert!(!dirs.keybindings_file().exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_broken_file_is_kept_as_bak_by_the_next_save() {
        let (root, dirs) = scratch("bak");
        fs::write(dirs.keybindings_file(), "{ not json").unwrap();
        let loaded = load(&dirs);
        assert_eq!(loaded.keybindings, json!({}));
        assert!(loaded.error.is_some());
        save(&dirs, sample()).unwrap();
        assert_eq!(
            fs::read_to_string(bak_path(&dirs.keybindings_file())).unwrap(),
            "{ not json"
        );
        assert_eq!(load(&dirs).error, None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_file_from_a_newer_gedit_is_read_and_never_overwritten() {
        let (root, dirs) = scratch("newer");
        let newer = format!(
            "{{ \"$version\": {}, \"bindings\": {{ \"file.save\": \"Mod+S\" }} }}",
            KEYBINDINGS_VERSION + 1
        );
        fs::write(dirs.keybindings_file(), &newer).unwrap();
        let loaded = load(&dirs);
        assert!(loaded.read_only);
        assert_eq!(loaded.keybindings["bindings"]["file.save"], json!("Mod+S"));
        assert!(save(&dirs, sample()).is_err());
        assert_eq!(fs::read_to_string(dirs.keybindings_file()).unwrap(), newer);
        let _ = fs::remove_dir_all(&root);
    }

    /// The commands take the object and nothing that names a place.
    #[test]
    fn no_command_here_takes_a_path_from_the_webview() {
        let source = source_scan::lf(include_str!("keybindings.rs"));
        for command in [
            "pub fn keybindings_load(app: AppHandle)",
            "pub fn keybindings_save(app: AppHandle, keybindings: Value)",
        ] {
            assert!(source.contains(command), "missing or changed: {command}");
        }
    }
}
