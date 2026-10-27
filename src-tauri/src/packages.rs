//! Script packages: `<config>/packages/<name>/` (Phase 4 plan §6.9 rules 7–15, AD-56).
//! Written by the P4g prelude; P4.35 owns it from here.
//!
//! A package is a folder the user copied in (or imported from a configuration zip) that adds
//! user files: `scripts/`, `profiles/`, `codes/` (templates ride in the code files) and a small
//! `package.json`. Its files are read with the rules of the user's own files, as a layer between
//! the built-ins and the user's own: [`crate::userfiles`] reads the JSON folders (names by
//! [`crate::userfiles::validate_name`], at most 64 files a folder, 1 MiB a file, UTF-8, no link
//! followed), [`crate::scripts::discovery`] walks the scripts (one level of group folders, the
//! header read bounded). What this module adds is the identity of a package, its manifest, the
//! caps over *all* packages, and the commands that list them.
//!
//! What the prelude fixes (final, tested): the name rule, the root name `pkg-<name>` a package's
//! scripts get, the manifest reading, the caps and the wire types. What P4.35 fills in:
//! [`list_in`] and [`files_in`] (the walks) and the two commands' bodies, the script root in
//! `scripts/discovery.rs`, and the `packages.disabled` reading in `scripts/settings.rs`.

// The prelude's vocabulary is final and ahead of its callers: what is not called yet is called by
// P4.35. Remove this line when the module is complete.
#![allow(dead_code)]

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::paths;

/// The setting that lists the switched-off packages (folder names). Read by Rust straight from
/// `settings.json`, like the four `scripts.*` keys (AD-8).
pub const KEY_PACKAGES_DISABLED: &str = "packages.disabled";

/// The manifest every package may hold.
pub const MANIFEST_FILE: &str = "package.json";

/// The prefix of a package's script root: the scripts of package `shop-a` have ids like
/// `pkg-shop-a:facing.py` and `pkg-shop-a:finish/chamfer.py`. No other root name has this
/// prefix (`bundled`, `user`, `extra<N>`), and a package name cannot hold a `:`.
pub const ROOT_PREFIX: &str = "pkg-";

/// The most package folders listed; the 33rd is reported as a problem and not read.
pub const MAX_PACKAGES: usize = 32;

/// The most bytes read from the JSON and script-header files of all packages together (32 MiB).
/// A file past the cap is listed unread, with the error `PACKAGES_CAP_ERROR`, so one package
/// cannot make listing the others slow or large. Per folder and per file the user-file caps
/// hold on top of this (64 files, 1 MiB).
pub const MAX_TOTAL_BYTES: u64 = 32 * 1024 * 1024;

/// The error a file past [`MAX_TOTAL_BYTES`] is listed with.
pub const PACKAGES_CAP_ERROR: &str = "not read: the packages hold more than 32 MiB";

/// The longest `name`, `version` and `description` a manifest may carry, in characters.
pub const MAX_TITLE_CHARS: usize = 80;
pub const MAX_VERSION_CHARS: usize = 32;
pub const MAX_DESCRIPTION_CHARS: usize = 500;

/// Why `name` is not a package name, or `None` when it is one. The rule of a user file's stem
/// (`^[a-z0-9][a-z0-9._-]{0,63}$`), no trailing dot, and not a DOS device name — a package is
/// copied between machines, so the strictest platform decides.
pub fn validate_package_name(name: &str) -> Option<&'static str> {
    let mut chars = name.chars();
    match chars.next() {
        None => return Some("empty"),
        Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit() => {}
        Some(_) => return Some("has to start with a lower-case letter or a digit"),
    }
    if name.chars().count() > 64 {
        return Some("too long");
    }
    if !chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
    {
        return Some("only a-z, 0-9, '.', '_' and '-'");
    }
    if name.ends_with('.') {
        return Some("ends with a dot");
    }
    if paths::is_device_name(name) {
        return Some("device name");
    }
    None
}

/// The script root of package `name`: `pkg-<name>`.
pub fn root_name(package: &str) -> String {
    format!("{ROOT_PREFIX}{package}")
}

/// The package a script root belongs to, or `None` for any other root.
pub fn package_of_root(root: &str) -> Option<&str> {
    root.strip_prefix(ROOT_PREFIX)
        .filter(|name| validate_package_name(name).is_none())
}

/// What a package's `package.json` says, for display. Nothing in it decides what loads.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Manifest {
    /// `name`, the display name; empty when the manifest gives none (the folder name is shown).
    pub title: String,
    pub version: String,
    pub description: String,
    /// Each member that was ignored, and why (English detail, AD-14).
    pub problems: Vec<String>,
}

fn text_member(
    object: &serde_json::Map<String, Value>,
    key: &str,
    max: usize,
    problems: &mut Vec<String>,
) -> String {
    match object.get(key) {
        None => String::new(),
        Some(Value::String(text))
            if text.chars().count() <= max && !text.chars().any(char::is_control) =>
        {
            text.trim().to_string()
        }
        Some(Value::String(_)) => {
            problems.push(format!(
                "\"{key}\" is longer than {max} characters or holds a control character"
            ));
            String::new()
        }
        Some(_) => {
            problems.push(format!("\"{key}\" has to be text"));
            String::new()
        }
    }
}

/// Reads a `package.json`. A manifest that is not a JSON object gives no members and one
/// problem; a member of the wrong type, or too long, is ignored with a problem. It never
/// refuses the package: the manifest is a label.
pub fn parse_manifest(text: &str) -> Manifest {
    let mut manifest = Manifest::default();
    let object = match serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')) {
        Ok(Value::Object(object)) => object,
        Ok(_) => {
            manifest
                .problems
                .push("package.json is not a JSON object".into());
            return manifest;
        }
        Err(_) => {
            manifest
                .problems
                .push("package.json is not valid JSON".into());
            return manifest;
        }
    };
    manifest.title = text_member(&object, "name", MAX_TITLE_CHARS, &mut manifest.problems);
    manifest.version = text_member(
        &object,
        "version",
        MAX_VERSION_CHARS,
        &mut manifest.problems,
    );
    manifest.description = text_member(
        &object,
        "description",
        MAX_DESCRIPTION_CHARS,
        &mut manifest.problems,
    );
    manifest
}

/// One package, as the Packages page shows it; camelCase on the wire
/// (`platform/commands.ts` `PackageInfo`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageInfo {
    /// The folder name: the identity of the package, what `packages.disabled` lists and what
    /// the script root `pkg-<name>` is built from.
    pub name: String,
    /// The display name from `package.json`, or the folder name.
    pub title: String,
    pub version: String,
    pub description: String,
    /// False when `packages.disabled` lists it: it is listed, and contributes nothing.
    pub enabled: bool,
    /// File counts, for the page (`.py` files under `scripts/`, `.json` files under `profiles/`
    /// and `codes/`); 0 for a disabled package whose folder was not walked.
    pub scripts: usize,
    pub profiles: usize,
    pub codes: usize,
    /// Why the folder is not a usable package (a link, a bad name, over the cap); then nothing
    /// of it loads.
    pub error: Option<String>,
    /// Problems with the manifest (the package still loads).
    pub problems: Vec<String>,
}

/// What `packages_list` answers.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageList {
    /// `<config>/packages`, for the page to show ("copy a package folder here"). Knowing it
    /// grants nothing.
    pub folder: String,
    /// By folder name, byte order, at most [`MAX_PACKAGES`].
    pub packages: Vec<PackageInfo>,
    /// Problems that belong to no package (the 33rd folder, an unreadable `packages` folder).
    pub problems: Vec<String>,
}

/// One JSON file of an enabled package, as `package_files_list` answers; `text` is `None` when
/// it could not be read (then `error` says why).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageFile {
    pub package: String,
    pub name: String,
    pub text: Option<String>,
    pub error: Option<String>,
}

/// The packages in `dir` (P4.35). The stub lists none.
pub fn list_in(dir: &std::path::Path, _disabled: &[String]) -> PackageList {
    PackageList {
        folder: dir.to_string_lossy().into_owned(),
        ..PackageList::default()
    }
}

/// The JSON files of kind `kind` (`"profiles"` or `"codes"`) of every enabled package, packages
/// by name and files by name (P4.35). The stub lists none.
pub fn files_in(
    _dir: &std::path::Path,
    _kind: crate::userfiles::Kind,
    _disabled: &[String],
) -> Vec<PackageFile> {
    Vec::new()
}

/// Every package under `<config>/packages`, enabled or not, with its manifest and counts.
#[tauri::command(async)]
pub fn packages_list(app: AppHandle) -> Result<PackageList, String> {
    let dirs = paths::app_dirs(&app)?;
    Ok(list_in(&dirs.packages_dir(), &[]))
}

/// The profile or code files of the enabled packages, for `userConfig.load` to lay under the
/// user's own files.
#[tauri::command(async)]
pub fn package_files_list(app: AppHandle, kind: String) -> Result<Vec<PackageFile>, String> {
    let dirs = paths::app_dirs(&app)?;
    let kind = crate::userfiles::Kind::parse(&kind)?;
    Ok(files_in(&dirs.packages_dir(), kind, &[]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_name_rule_is_the_one_of_a_user_file_stem() {
        for good in ["shop", "shop-a", "a.b_c-1", "0abc", &"a".repeat(64)] {
            assert_eq!(validate_package_name(good), None, "{good}");
        }
        for (bad, why) in [
            ("", "empty"),
            ("Shop", "has to start with a lower-case letter or a digit"),
            ("-shop", "has to start with a lower-case letter or a digit"),
            (
                ".hidden",
                "has to start with a lower-case letter or a digit",
            ),
            ("my shop", "only a-z, 0-9, '.', '_' and '-'"),
            ("shop:a", "only a-z, 0-9, '.', '_' and '-'"),
            ("shop/a", "only a-z, 0-9, '.', '_' and '-'"),
            ("shöp", "only a-z, 0-9, '.', '_' and '-'"),
            ("shop.", "ends with a dot"),
            ("con", "device name"),
            ("nul", "device name"),
            ("com1", "device name"),
        ] {
            assert_eq!(validate_package_name(bad), Some(why), "{bad:?}");
        }
        assert_eq!(validate_package_name(&"a".repeat(65)), Some("too long"));
    }

    #[test]
    fn a_script_root_is_pkg_dash_name_and_nothing_else_is() {
        assert_eq!(root_name("shop-a"), "pkg-shop-a");
        assert_eq!(package_of_root("pkg-shop-a"), Some("shop-a"));
        for other in [
            "bundled",
            "user",
            "extra0",
            "pkg-",
            "pkg-Shop",
            "pkg-a:b",
            "package-a",
        ] {
            assert_eq!(package_of_root(other), None, "{other}");
        }
    }

    #[test]
    fn a_manifest_is_a_label_and_never_refuses_the_package() {
        let ok = parse_manifest(
            r#"{ "name": "Shop A", "version": "1.2.0", "description": "Facing and chamfer" }"#,
        );
        assert_eq!(ok.title, "Shop A");
        assert_eq!(ok.version, "1.2.0");
        assert_eq!(ok.description, "Facing and chamfer");
        assert!(ok.problems.is_empty());

        let bad = parse_manifest(r#"{ "name": 5, "version": "x", "extra": true }"#);
        assert_eq!(bad.title, "");
        assert_eq!(bad.version, "x");
        assert_eq!(bad.problems, vec!["\"name\" has to be text".to_string()]);

        assert_eq!(
            parse_manifest("[1]").problems,
            vec!["package.json is not a JSON object".to_string()]
        );
        assert_eq!(
            parse_manifest("{ nope").problems,
            vec!["package.json is not valid JSON".to_string()]
        );
        // A byte order mark is tolerated here: the manifest is a label, not a user file.
        assert_eq!(parse_manifest("\u{feff}{\"name\":\"A\"}").title, "A");
    }

    #[test]
    fn a_manifest_member_that_is_too_long_or_holds_a_control_character_is_ignored() {
        let long = format!(r#"{{"name":"{}"}}"#, "x".repeat(MAX_TITLE_CHARS + 1));
        let parsed = parse_manifest(&long);
        assert_eq!(parsed.title, "");
        assert_eq!(parsed.problems.len(), 1);
        let control = parse_manifest("{\"description\":\"a\\u0007b\"}");
        assert_eq!(control.description, "");
        assert_eq!(control.problems.len(), 1);
    }

    #[test]
    fn the_prelude_stubs_list_nothing() {
        let list = list_in(std::path::Path::new("/cfg/packages"), &[]);
        assert_eq!(list.folder, "/cfg/packages");
        assert!(list.packages.is_empty() && list.problems.is_empty());
        assert!(files_in(
            std::path::Path::new("/cfg/packages"),
            crate::userfiles::Kind::Codes,
            &[]
        )
        .is_empty());
    }
}
