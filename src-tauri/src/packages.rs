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

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::paths;
use crate::scripts::settings::ScriptSettings;

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

/// One folder of `<config>/packages` that counts as a package folder: the name is the folder's,
/// `error` says why it cannot be used (a bad name, a link).
struct Folder {
    name: String,
    path: std::path::PathBuf,
    error: Option<String>,
}

/// The package folders of `dir` by name in byte order, at most [`MAX_PACKAGES`], and the problems
/// that belong to no folder (§6.9 rule 8). A name starting with `.` and a plain file are skipped;
/// a link is listed with an error and never followed; a name that fails the rule is listed with
/// the reason. A missing `dir` lists none.
fn scan(dir: &std::path::Path) -> (Vec<Folder>, Vec<String>) {
    let mut problems = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return (Vec::new(), problems),
        Err(err) => {
            problems.push(format!(
                "the packages folder could not be read: {}",
                crate::userfiles::why(&err)
            ));
            return (Vec::new(), problems);
        }
    };
    let mut found: Vec<Folder> = Vec::new();
    for entry in entries.filter_map(|entry| entry.ok()) {
        let raw = entry.file_name();
        let name = raw.to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        let error = if crate::userfiles::is_link(&meta) {
            Some("a link, not followed; copy the package folder here instead".to_string())
        } else if !meta.is_dir() {
            continue;
        } else if raw.to_str().is_none() {
            Some("not a package name: the name is not text".to_string())
        } else {
            validate_package_name(&name).map(|reason| format!("not a package name: {reason}"))
        };
        found.push(Folder { name, path, error });
    }
    found.sort_by(|a, b| a.name.as_bytes().cmp(b.name.as_bytes()));
    if found.len() > MAX_PACKAGES {
        problems.push(format!(
            "more than {MAX_PACKAGES} package folders; {:?} and the ones after it are not read",
            found[MAX_PACKAGES].name
        ));
        found.truncate(MAX_PACKAGES);
    }
    (found, problems)
}

fn is_enabled(name: &str, disabled: &[String]) -> bool {
    !disabled.iter().any(|off| off == name)
}

/// What a plain file of a package costs against the budget, or `None` when it is not there as a
/// plain file (the reader says why).
fn file_cost(path: &std::path::Path) -> Option<u64> {
    std::fs::symlink_metadata(path)
        .ok()
        .filter(|meta| crate::userfiles::not_regular(meta).is_none())
        .map(|meta| meta.len())
}

/// The manifest of a package folder, read as a user file (no link, at most 1 MiB, UTF-8) and
/// counted against `budget`. The problems are for the page; a missing manifest is a note.
fn read_manifest(folder: &std::path::Path, budget: &mut u64) -> Manifest {
    let path = folder.join(MANIFEST_FILE);
    if std::fs::symlink_metadata(&path).is_err() {
        return Manifest {
            problems: vec!["no package.json (the folder name is shown)".into()],
            ..Manifest::default()
        };
    }
    if file_cost(&path).is_some_and(|cost| cost > *budget) {
        return Manifest {
            problems: vec![PACKAGES_CAP_ERROR.into()],
            ..Manifest::default()
        };
    }
    match crate::userfiles::read_text(&path) {
        Ok(text) => {
            *budget = budget.saturating_sub(text.len() as u64);
            parse_manifest(&text)
        }
        Err(error) => Manifest {
            problems: vec![format!("package.json: {error}")],
            ..Manifest::default()
        },
    }
}

/// `folder/sub` when it is a real folder; `Err` with the reason when it is a link (never
/// followed) and `Ok(None)` when it is not there.
fn sub_folder(
    folder: &std::path::Path,
    sub: &str,
) -> Result<Option<std::path::PathBuf>, &'static str> {
    let path = folder.join(sub);
    match std::fs::symlink_metadata(&path) {
        Err(_) => Ok(None),
        Ok(meta) if crate::userfiles::is_link(&meta) => Err("a link, not followed"),
        Ok(meta) if meta.is_dir() => Ok(Some(path)),
        Ok(_) => Err("not a folder"),
    }
}

/// How many `.json` files a package's `profiles` or `codes` folder holds (plain files only; the
/// names are not judged here, the reader does that).
fn count_json(folder: &std::path::Path) -> usize {
    std::fs::read_dir(folder)
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok())
                .filter(|entry| {
                    let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                    !name.starts_with('.')
                        && name.ends_with(".json")
                        && std::fs::symlink_metadata(entry.path())
                            .is_ok_and(|meta| crate::userfiles::not_regular(&meta).is_none())
                })
                .count()
        })
        .unwrap_or(0)
}

/// The packages in `dir`, enabled or not (§6.9 rule 8). The manifest of every usable folder is
/// read (it counts against the 32 MiB of [`MAX_TOTAL_BYTES`]); the folders of a disabled package
/// are not walked, so its counts are 0.
pub fn list_in(dir: &std::path::Path, disabled: &[String]) -> PackageList {
    list_with_budget(dir, disabled, MAX_TOTAL_BYTES)
}

/// [`list_in`] with the budget passed in, so the cap can be tested with small files.
fn list_with_budget(dir: &std::path::Path, disabled: &[String], total: u64) -> PackageList {
    let (folders, problems) = scan(dir);
    let mut budget = total;
    let mut packages = Vec::with_capacity(folders.len());
    for folder in folders {
        let enabled = is_enabled(&folder.name, disabled);
        let mut info = PackageInfo {
            title: folder.name.clone(),
            name: folder.name.clone(),
            enabled,
            error: folder.error.clone(),
            ..PackageInfo::default()
        };
        if folder.error.is_none() {
            let manifest = read_manifest(&folder.path, &mut budget);
            if !manifest.title.is_empty() {
                info.title = manifest.title;
            }
            info.version = manifest.version;
            info.description = manifest.description;
            info.problems = manifest.problems;
            if enabled {
                match sub_folder(&folder.path, "scripts") {
                    Ok(Some(scripts)) => {
                        info.scripts = crate::scripts::discovery::count_package_scripts(&scripts);
                    }
                    Ok(None) => {}
                    Err(why) => info.problems.push(format!("scripts: {why}")),
                }
                for (sub, count) in [("profiles", &mut info.profiles), ("codes", &mut info.codes)] {
                    match sub_folder(&folder.path, sub) {
                        Ok(Some(path)) => *count = count_json(&path),
                        Ok(None) => {}
                        Err(why) => info.problems.push(format!("{sub}: {why}")),
                    }
                }
            }
        }
        packages.push(info);
    }
    PackageList {
        folder: dir.to_string_lossy().into_owned(),
        packages,
        problems,
    }
}

/// The JSON files of kind `kind` (`"profiles"` or `"codes"`) of every enabled package, packages
/// by name and files by name (§6.9 rules 9 and 11). Each file is read as the user's own are
/// ([`crate::userfiles::list_in_budget`]: name rule, 64 files a folder, 1 MiB a file, UTF-8, no
/// link) and all of them together stay under [`MAX_TOTAL_BYTES`]; a file that fails, or does
/// not fit, is listed with `text: None` and its error. A folder of a kind that is a link, or
/// cannot be read, is one such row named after the kind.
pub fn files_in(
    dir: &std::path::Path,
    kind: crate::userfiles::Kind,
    disabled: &[String],
) -> Vec<PackageFile> {
    files_with_budget(dir, kind, disabled, MAX_TOTAL_BYTES)
}

/// [`files_in`] with the budget passed in, so the cap can be tested with small files.
fn files_with_budget(
    dir: &std::path::Path,
    kind: crate::userfiles::Kind,
    disabled: &[String],
    total: u64,
) -> Vec<PackageFile> {
    let sub = match kind {
        crate::userfiles::Kind::Profiles => "profiles",
        crate::userfiles::Kind::Codes => "codes",
    };
    let (folders, _) = scan(dir);
    let mut budget = total;
    let mut files = Vec::new();
    for folder in folders {
        if folder.error.is_some() || !is_enabled(&folder.name, disabled) {
            continue;
        }
        let listed = match sub_folder(&folder.path, sub) {
            Ok(None) => continue,
            Ok(Some(path)) => {
                crate::userfiles::list_in_budget(&path, &mut budget, PACKAGES_CAP_ERROR)
            }
            Err(why) => Err(why.to_string()),
        };
        match listed {
            Ok(listed) => files.extend(listed.into_iter().map(|file| PackageFile {
                package: folder.name.clone(),
                name: file.name,
                text: file.text,
                error: file.error,
            })),
            Err(error) => files.push(PackageFile {
                package: folder.name.clone(),
                name: sub.to_string(),
                text: None,
                error: Some(error),
            }),
        }
    }
    files
}

/// The script folders of the enabled packages that can be used, as (package name, its `scripts`
/// folder), by name: the roots `pkg-<name>` of `scripts/discovery.rs` (§6.9 rules 10 and 12). A
/// disabled package, a bad name, a package that is a link and a `scripts` folder that is a link
/// or missing have none.
pub fn script_roots(
    dir: &std::path::Path,
    disabled: &[String],
) -> Vec<(String, std::path::PathBuf)> {
    scan(dir)
        .0
        .into_iter()
        .filter(|folder| folder.error.is_none() && is_enabled(&folder.name, disabled))
        .filter_map(|folder| match sub_folder(&folder.path, "scripts") {
            Ok(Some(scripts)) => Some((folder.name, scripts)),
            _ => None,
        })
        .collect()
}

/// Every package under `<config>/packages`, enabled or not, with its manifest and counts.
#[tauri::command(async)]
pub fn packages_list(app: AppHandle) -> Result<PackageList, String> {
    let dirs = paths::app_dirs(&app)?;
    let disabled = ScriptSettings::load(&app).packages_disabled;
    Ok(list_in(&dirs.packages_dir(), &disabled))
}

/// The profile or code files of the enabled packages, for `userConfig.load` to lay under the
/// user's own files.
#[tauri::command(async)]
pub fn package_files_list(app: AppHandle, kind: String) -> Result<Vec<PackageFile>, String> {
    let dirs = paths::app_dirs(&app)?;
    let kind = crate::userfiles::Kind::parse(&kind)?;
    let disabled = ScriptSettings::load(&app).packages_disabled;
    Ok(files_in(&dirs.packages_dir(), kind, &disabled))
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

    // ---- the walks (P4.35) -------------------------------------------------------------------

    use std::fs;
    use std::path::{Path, PathBuf};

    /// A scratch folder tree: a name ending in `/` is a folder, anything else a file.
    fn scratch(name: &str, files: &[(&str, &str)]) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("gedit-packages-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        for (path, contents) in files {
            let full = root.join(path);
            if path.ends_with('/') {
                fs::create_dir_all(&full).unwrap();
            } else {
                fs::create_dir_all(full.parent().unwrap()).unwrap();
                fs::write(&full, contents).unwrap();
            }
        }
        root
    }

    fn names(list: &PackageList) -> Vec<&str> {
        list.packages.iter().map(|p| p.name.as_str()).collect()
    }

    const PROFILE: &str = r#"{ "id": "x" }"#;

    #[test]
    fn a_missing_packages_folder_lists_as_empty() {
        let list = list_in(Path::new("/gedit-no-such-folder/packages"), &[]);
        assert_eq!(list.folder, "/gedit-no-such-folder/packages");
        assert!(list.packages.is_empty() && list.problems.is_empty());
        assert!(files_in(
            Path::new("/gedit-no-such-folder/packages"),
            crate::userfiles::Kind::Codes,
            &[]
        )
        .is_empty());
        assert!(script_roots(Path::new("/gedit-no-such-folder/packages"), &[]).is_empty());
    }

    #[test]
    fn packages_list_by_name_with_manifest_and_counts() {
        let dir = scratch(
            "list",
            &[
                (
                    "zeta/package.json",
                    r#"{ "name": "Zeta", "version": "2", "description": "d" }"#,
                ),
                ("zeta/scripts/a.py", "# a"),
                ("zeta/scripts/grp/b.py", "# b"),
                ("zeta/scripts/grp/_helper.py", "# helper"),
                ("zeta/scripts/gedit_nc.py", "# library"),
                ("zeta/profiles/p1.json", PROFILE),
                ("zeta/profiles/p2.json", PROFILE),
                ("zeta/codes/c1.json", PROFILE),
                ("alpha/profiles/p.json", PROFILE),
                (".hidden/package.json", "{}"),
                ("notes.txt", "a file is not a package"),
            ],
        );
        let list = list_in(&dir, &[]);
        assert_eq!(names(&list), ["alpha", "zeta"]);
        let alpha = &list.packages[0];
        assert_eq!((alpha.title.as_str(), alpha.enabled), ("alpha", true));
        assert_eq!(
            alpha.problems,
            ["no package.json (the folder name is shown)"]
        );
        assert_eq!((alpha.scripts, alpha.profiles, alpha.codes), (0, 1, 0));
        let zeta = &list.packages[1];
        assert_eq!(
            (
                zeta.title.as_str(),
                zeta.version.as_str(),
                zeta.description.as_str()
            ),
            ("Zeta", "2", "d")
        );
        assert!(zeta.problems.is_empty() && zeta.error.is_none());
        assert_eq!((zeta.scripts, zeta.profiles, zeta.codes), (2, 2, 1));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_folder_that_is_not_a_package_name_is_listed_with_the_reason_and_not_read() {
        let dir = scratch(
            "badname",
            &[
                ("My Shop/profiles/p.json", PROFILE),
                ("con/scripts/a.py", "#"),
                ("ok/", ""),
            ],
        );
        let list = list_in(&dir, &[]);
        assert_eq!(names(&list), ["My Shop", "con", "ok"]);
        assert_eq!(
            list.packages[0].error.as_deref(),
            Some("not a package name: has to start with a lower-case letter or a digit")
        );
        assert_eq!(
            list.packages[1].error.as_deref(),
            Some("not a package name: device name")
        );
        assert_eq!(list.packages[0].profiles, 0);
        assert!(list.packages[2].error.is_none());
        // Nothing of the two reaches a load.
        assert!(files_in(&dir, crate::userfiles::Kind::Profiles, &[]).is_empty());
        assert!(script_roots(&dir, &[]).iter().all(|(name, _)| name == "ok"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_33rd_folder_is_a_problem_and_not_read() {
        let mut files: Vec<(String, &str)> = Vec::new();
        for i in 0..=MAX_PACKAGES {
            files.push((format!("p{i:02}/profiles/a.json"), PROFILE));
        }
        let refs: Vec<(&str, &str)> = files.iter().map(|(p, c)| (p.as_str(), *c)).collect();
        let dir = scratch("many", &refs);
        let list = list_in(&dir, &[]);
        assert_eq!(list.packages.len(), MAX_PACKAGES);
        assert_eq!(list.packages.last().unwrap().name, "p31");
        assert_eq!(list.problems.len(), 1);
        assert!(list.problems[0].contains("p32"), "{:?}", list.problems);
        let loaded = files_in(&dir, crate::userfiles::Kind::Profiles, &[]);
        assert_eq!(loaded.len(), MAX_PACKAGES);
        assert!(loaded.iter().all(|f| f.package != "p32"));
        let _ = fs::remove_dir_all(&dir);
    }

    /// Q4g-4: a package is copied in and never linked. A package folder that is a link is listed
    /// with an error and nothing of it loads, whatever it points at.
    #[cfg(unix)]
    #[test]
    fn a_package_folder_that_is_a_link_is_listed_with_an_error_and_not_followed() {
        let dir = scratch("link", &[("real/profiles/p.json", PROFILE)]);
        let outside = scratch(
            "link-outside",
            &[
                ("profiles/secret.json", PROFILE),
                ("scripts/evil.py", "# x"),
                ("package.json", r#"{"name":"Evil"}"#),
            ],
        );
        std::os::unix::fs::symlink(&outside, dir.join("linked")).unwrap();
        let list = list_in(&dir, &[]);
        assert_eq!(names(&list), ["linked", "real"]);
        let linked = &list.packages[0];
        assert_eq!(
            linked.error.as_deref(),
            Some("a link, not followed; copy the package folder here instead")
        );
        assert_eq!(
            (linked.title.as_str(), linked.profiles, linked.scripts),
            ("linked", 0, 0)
        );
        assert!(files_in(&dir, crate::userfiles::Kind::Profiles, &[])
            .iter()
            .all(|f| f.package == "real"));
        assert!(script_roots(&dir, &[]).is_empty());
        for d in [&dir, &outside] {
            let _ = fs::remove_dir_all(d);
        }
    }

    /// An entry inside a package is never followed either: a linked kind folder, a linked file.
    #[cfg(unix)]
    #[test]
    fn a_link_inside_a_package_is_not_followed() {
        let dir = scratch(
            "inner",
            &[
                ("shop/profiles-real/p.json", PROFILE),
                ("shop/codes/ok.json", PROFILE),
            ],
        );
        let outside = scratch(
            "inner-outside",
            &[("secret.json", PROFILE), ("s/a.py", "# a")],
        );
        std::os::unix::fs::symlink(outside.join("s"), dir.join("shop/scripts")).unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("shop/profiles")).unwrap();
        std::os::unix::fs::symlink(
            outside.join("secret.json"),
            dir.join("shop/codes/leak.json"),
        )
        .unwrap();
        let list = list_in(&dir, &[]);
        let shop = &list.packages[0];
        assert!(shop.error.is_none());
        assert_eq!((shop.scripts, shop.profiles, shop.codes), (0, 0, 1));
        assert!(shop
            .problems
            .contains(&"scripts: a link, not followed".to_string()));
        assert!(shop
            .problems
            .contains(&"profiles: a link, not followed".to_string()));
        assert!(script_roots(&dir, &[]).is_empty());

        let profiles = files_in(&dir, crate::userfiles::Kind::Profiles, &[]);
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].name, "profiles");
        assert_eq!(profiles[0].text, None);
        assert_eq!(profiles[0].error.as_deref(), Some("a link, not followed"));

        let codes = files_in(&dir, crate::userfiles::Kind::Codes, &[]);
        let leak = codes.iter().find(|f| f.name == "leak.json").unwrap();
        assert_eq!(leak.text, None, "the linked file was read");
        assert_eq!(leak.error.as_deref(), Some("a link, not followed"));
        assert!(codes
            .iter()
            .any(|f| f.name == "ok.json" && f.text.is_some()));
        for d in [&dir, &outside] {
            let _ = fs::remove_dir_all(d);
        }
    }

    #[test]
    fn files_are_listed_packages_by_name_then_files_by_name_and_failures_are_kept() {
        let dir = scratch(
            "files",
            &[
                ("b/profiles/two.json", r#"{ "id": "b2" }"#),
                ("b/profiles/one.json", r#"{ "id": "b1" }"#),
                ("a/profiles/Bad Name.json", PROFILE),
                ("a/profiles/good.json", r#"{ "id": "g" }"#),
                ("a/profiles/readme.txt", "not listed"),
                ("c/codes/c.json", PROFILE),
            ],
        );
        fs::write(dir.join("a/profiles/binary.json"), [0xff, 0xfe, 0x00]).unwrap();
        let files = files_in(&dir, crate::userfiles::Kind::Profiles, &[]);
        let got: Vec<(&str, &str, bool)> = files
            .iter()
            .map(|f| (f.package.as_str(), f.name.as_str(), f.text.is_some()))
            .collect();
        assert_eq!(
            got,
            [
                ("a", "Bad Name.json", false),
                ("a", "binary.json", false),
                ("a", "good.json", true),
                ("b", "one.json", true),
                ("b", "two.json", true),
            ]
        );
        assert!(files[0]
            .error
            .as_deref()
            .unwrap()
            .starts_with("not a valid file name"));
        assert_eq!(files[1].error.as_deref(), Some("not UTF-8 text"));
        let codes = files_in(&dir, crate::userfiles::Kind::Codes, &[]);
        assert_eq!(codes.len(), 1);
        assert_eq!(
            (codes[0].package.as_str(), codes[0].name.as_str()),
            ("c", "c.json")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_over_one_mebibyte_and_the_65th_file_are_refused_as_for_the_users_own() {
        let dir = scratch("caps", &[("p/profiles/", "")]);
        fs::write(dir.join("p/profiles/big.json"), vec![b' '; 1024 * 1024 + 1]).unwrap();
        for i in 0..crate::userfiles::MAX_FILES {
            fs::write(dir.join(format!("p/profiles/f{i:03}.json")), PROFILE).unwrap();
        }
        let files = files_in(&dir, crate::userfiles::Kind::Profiles, &[]);
        let big = files.iter().find(|f| f.name == "big.json").unwrap();
        assert_eq!(big.error.as_deref(), Some("larger than 1 MiB"));
        // 65 files in the folder: the 65th (by name, `f063.json`) is listed unread, nothing after it.
        assert_eq!(files.len(), crate::userfiles::MAX_FILES + 1);
        assert!(files
            .last()
            .unwrap()
            .error
            .as_deref()
            .unwrap()
            .contains("more than 64 files"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_cap_over_all_packages_is_32_mebibytes_and_a_file_past_it_is_listed_unread() {
        assert_eq!(MAX_TOTAL_BYTES, 32 * 1024 * 1024);
        assert_eq!(
            PACKAGES_CAP_ERROR,
            "not read: the packages hold more than 32 MiB"
        );
        let ten = "x".repeat(10);
        let dir = scratch(
            "budget",
            &[
                ("a/profiles/a1.json", &ten),
                ("a/profiles/a2.json", &ten),
                ("b/profiles/b1.json", &ten),
                ("b/profiles/b2.json", "y"),
                ("b/package.json", r#"{ "name": "B" }"#),
            ],
        );
        let files = files_with_budget(&dir, crate::userfiles::Kind::Profiles, &[], 25);
        let got: Vec<(&str, bool)> = files
            .iter()
            .map(|f| (f.name.as_str(), f.text.is_some()))
            .collect();
        // Two files of ten fit; the third does not; the one-byte file after it still does.
        assert_eq!(
            got,
            [
                ("a1.json", true),
                ("a2.json", true),
                ("b1.json", false),
                ("b2.json", true)
            ]
        );
        assert_eq!(files[2].error.as_deref(), Some(PACKAGES_CAP_ERROR));
        // The manifests count as well: with nothing left the label is not read.
        let list = list_with_budget(&dir, &[], 0);
        let b = list.packages.iter().find(|p| p.name == "b").unwrap();
        assert_eq!(b.title, "b");
        assert_eq!(b.problems, [PACKAGES_CAP_ERROR]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_switched_off_package_is_listed_and_contributes_nothing() {
        let dir = scratch(
            "off",
            &[
                ("on/profiles/p.json", PROFILE),
                ("on/scripts/a.py", "# a"),
                ("off/package.json", r#"{ "name": "Off shop" }"#),
                ("off/profiles/p.json", PROFILE),
                ("off/scripts/b.py", "# b"),
            ],
        );
        let disabled = vec!["off".to_string(), "never-existed".to_string()];
        let list = list_in(&dir, &disabled);
        let off = list.packages.iter().find(|p| p.name == "off").unwrap();
        assert!(!off.enabled);
        assert_eq!(off.title, "Off shop");
        assert_eq!((off.scripts, off.profiles, off.codes), (0, 0, 0));
        let on = list.packages.iter().find(|p| p.name == "on").unwrap();
        assert!(on.enabled && (on.scripts, on.profiles) == (1, 1));
        let files = files_in(&dir, crate::userfiles::Kind::Profiles, &disabled);
        assert!(files.iter().all(|f| f.package == "on") && files.len() == 1);
        let roots = script_roots(&dir, &disabled);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].0, "on");
        // Switched on again, it is all back.
        assert_eq!(
            files_in(&dir, crate::userfiles::Kind::Profiles, &[]).len(),
            2
        );
        assert_eq!(script_roots(&dir, &[]).len(), 2);
        let _ = fs::remove_dir_all(&dir);
    }
}
