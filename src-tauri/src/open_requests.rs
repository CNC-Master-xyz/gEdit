//! Files the operating system asks gEdit to open (plan Phase 4, AD-54, section 6.8; P4f).
//!
//! Two doors lead here, and they are the only two:
//!
//! - **macOS:** the system sends the running app `RunEvent::Opened` (a double-click in the
//!   Finder, "Open With", a file dropped on the Dock icon). Also at start, before the window
//!   has a page: that is why requests are queued ([`OpenRequests`]).
//! - **Windows and Linux:** the file browser starts a second `gedit` process with the path
//!   as an argument. The single-instance plugin hands that process's arguments to the first
//!   one and ends the second ([`single_instance_plugin`]). The plugin is **not** registered on
//!   macOS: the system already keeps one instance of a bundled app, and the plugin's macOS
//!   door is a socket in `/tmp` that any local user could write to (section 6.8, security).
//!   On Linux it is registered only when a D-Bus session bus can be found
//!   ([`single_instance_possible`]): the plugin version in use unwraps the bus address and would
//!   stop gEdit from starting without one.
//!
//! The prelude wrote the queue ([`OpenRequests`]), the command [`open_requests_ready`], the event
//! name, the limits and the bus check. P4.29 wrote the checks of what the second process or the
//! system sent ([`check_arguments`], [`url_arguments`]), the grant, the emit and the window raise
//! ([`second_instance`], [`opened`], [`deliver_granted`]). The rules are in section 6.8.2, S7:
//! *what a second instance may pass*.
//!
//! The arguments are untrusted text. Everything the webview ever learns from them is the event
//! payload `{ paths, refused }`: no option, no environment, no working folder.

use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::{paths, state};

/// The event the webview listens to. The payload is `{ "paths": [string, ...], "refused": n }`:
/// absolute paths of existing regular files that were granted to the fs scope, and how many
/// arguments were refused. Nothing else.
pub const EVENT: &str = "gedit-open-requests";

/// Paths one hand-over may carry; the rest are refused and counted.
pub const MAX_PATHS: usize = 32;
/// Characters of one argument; a longer one is refused.
pub const MAX_ARG_CHARS: usize = 4096;
/// Paths held while the webview is not ready. Past it the oldest are dropped and counted.
pub const MAX_PENDING: usize = 64;

#[derive(Default)]
struct Inner {
    /// The webview has registered its listener and asked once (`open_requests_ready`).
    ready: bool,
    pending: Vec<String>,
    /// Paths dropped for [`MAX_PENDING`] since the webview last asked.
    dropped: u32,
    /// Arguments refused by the checks (not a path, not a file, too long, too many) since then.
    refused: u32,
}

/// Managed state: the paths that arrived before the webview could take them.
#[derive(Default)]
pub struct OpenRequests {
    inner: Mutex<Inner>,
}

/// What happens to a batch of validated paths.
#[derive(Debug, PartialEq, Eq)]
pub enum Delivery {
    /// The webview is ready: emit [`EVENT`] with these now.
    Emit { paths: Vec<String>, refused: u32 },
    /// The webview is not ready: they wait for `open_requests_ready`.
    Queued,
}

impl OpenRequests {
    /// A batch of paths (already validated and granted by the caller) and the number of
    /// arguments the caller refused. Under one lock, so a batch is either queued before the
    /// webview asks or emitted after it has a listener: never lost between the two.
    pub fn deliver(&self, paths: Vec<String>, refused: u32) -> Delivery {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.ready {
            return Delivery::Emit { paths, refused };
        }
        inner.refused = inner.refused.saturating_add(refused);
        inner.pending.extend(paths);
        let over = inner.pending.len().saturating_sub(MAX_PENDING);
        if over > 0 {
            inner.pending.drain(..over);
            inner.dropped = inner
                .dropped
                .saturating_add(u32::try_from(over).unwrap_or(u32::MAX));
        }
        Delivery::Queued
    }

    /// The webview is listening: from now on [`Self::deliver`] emits. Answers what waited and
    /// how many paths were dropped and arguments refused on the way.
    pub fn take_ready(&self) -> OpenRequestsReady {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.ready = true;
        OpenRequestsReady {
            paths: std::mem::take(&mut inner.pending),
            dropped: std::mem::take(&mut inner.dropped),
            refused: std::mem::take(&mut inner.refused),
        }
    }
}

/// What `open_requests_ready` answers. camelCase on the wire.
#[derive(Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequestsReady {
    pub paths: Vec<String>,
    pub dropped: u32,
    pub refused: u32,
}

/// The webview calls this **once**, after it has registered its listener for [`EVENT`]. Paths
/// that arrived before are returned here; paths that arrive after are emitted.
#[tauri::command]
pub fn open_requests_ready(state: State<'_, OpenRequests>) -> OpenRequestsReady {
    state.take_ready()
}

/// Whether a D-Bus session bus can be found: `DBUS_SESSION_BUS_ADDRESS` is set and not empty, or
/// the default socket `<XDG_RUNTIME_DIR>/bus` exists (what the bus library falls back to). The
/// single-instance plugin of 2.4.x calls `unwrap()` on the lookup and would panic at start
/// without it. `var` reads an environment variable, `exists` asks the file system.
#[cfg_attr(not(any(test, target_os = "linux")), allow(dead_code))]
pub fn dbus_session_available(
    var: impl Fn(&str) -> Option<String>,
    exists: impl Fn(&Path) -> bool,
) -> bool {
    if var("DBUS_SESSION_BUS_ADDRESS").is_some_and(|v| !v.trim().is_empty()) {
        return true;
    }
    match var("XDG_RUNTIME_DIR") {
        Some(dir) if !dir.trim().is_empty() => exists(&Path::new(&dir).join("bus")),
        _ => false,
    }
}

/// Whether the single-instance plugin can start here. Always on Windows; on Linux only with a
/// session bus. Without it gEdit starts as it did before (several windows are possible).
#[cfg(any(windows, target_os = "linux"))]
pub fn single_instance_possible() -> bool {
    #[cfg(windows)]
    {
        true
    }
    #[cfg(not(windows))]
    {
        dbus_session_available(|name| std::env::var(name).ok(), |path| path.exists())
    }
}

/// How one argument reads before the file system is asked anything (S7, items 1 and 2).
#[derive(Debug, PartialEq, Eq)]
pub enum ArgForm {
    /// Starts with `-`: an option. gEdit defines none, so it is ignored (and counted).
    Option,
    Empty,
    /// More than [`MAX_ARG_CHARS`] characters.
    TooLong,
    /// Holds a NUL character.
    HasNul,
    /// Could be a path; the file system decides.
    Path,
}

/// The text rules of S7 on one argument: no file system.
pub fn classify_argument(arg: &str) -> ArgForm {
    if arg.starts_with('-') {
        ArgForm::Option
    } else if arg.is_empty() {
        ArgForm::Empty
    } else if arg.contains('\0') {
        ArgForm::HasNul
    } else if arg.chars().count() > MAX_ARG_CHARS {
        ArgForm::TooLong
    } else {
        ArgForm::Path
    }
}

/// A path that names its place by itself: no root and no drive of its own. Only such a path is
/// joined to the hand-over's folder; `\foo` and `C:foo` on Windows are neither absolute nor
/// relative to anything we can name, so they are refused (S7, item 3).
fn is_plain_relative(path: &Path) -> bool {
    !path.has_root()
        && !matches!(path.components().next(), Some(Component::Prefix(_)))
        && path.components().next().is_some()
}

/// The text rules for the hand-over's working folder: absolute, no NUL, within the length limit.
/// (Whether it is a directory is the file system's question.)
pub fn cwd_form_ok(cwd: &str) -> bool {
    !cwd.is_empty()
        && !cwd.contains('\0')
        && cwd.chars().count() <= MAX_ARG_CHARS
        && Path::new(cwd).is_absolute()
}

/// The path an argument names, before the file system is asked: absolute as written, or joined
/// to `cwd` when it is plain relative. `None` when it is relative and there is no usable folder.
fn candidate(arg: &str, cwd: Option<&Path>) -> Option<PathBuf> {
    let path = Path::new(arg);
    if path.is_absolute() {
        Some(path.to_path_buf())
    } else if is_plain_relative(path) {
        cwd.map(|dir| dir.join(path))
    } else {
        None
    }
}

/// What the checks kept (canonical paths of existing regular files, in order, no duplicates) and
/// how many arguments they refused or ignored.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Checked {
    pub paths: Vec<PathBuf>,
    pub refused: u32,
}

/// One argument that passed the text rules: resolved, an existing regular file, not `state.json`
/// (S7, item 4). `None` when any step fails.
fn check_one(arg: &str, cwd: Option<&Path>, state_file: &Path) -> Option<PathBuf> {
    let wanted = candidate(arg, cwd)?;
    // A DOS device name is not a file on Windows, and opening it could block.
    if cfg!(windows)
        && wanted
            .file_name()
            .and_then(|name| name.to_str())
            .is_none_or(paths::is_device_name)
    {
        return None;
    }
    let canonical = std::fs::canonicalize(&wanted).ok()?;
    let canonical = paths::plain(&canonical).into_owned();
    // The path travels as JSON text: one that is not UTF-8 would arrive changed.
    canonical.to_str()?;
    if !std::fs::metadata(&canonical).ok()?.is_file() {
        return None;
    }
    if state::is_state_file(&canonical, state_file) {
        return None;
    }
    Some(canonical)
}

/// Applies S7 to the arguments of one hand-over (the executable is already taken off). `cwd` is
/// the second process's working folder; it is used only for a plain relative path, and only when
/// it is absolute, within the length limit and a directory. At most [`MAX_PATHS`] arguments are
/// looked at; the rest are refused without touching the file system. Reads the file system; grants
/// nothing.
pub fn check_arguments(args: &[String], cwd: Option<&str>, state_file: &Path) -> Checked {
    // Asked only if a relative path needs it, and once.
    let mut folder: Option<Option<PathBuf>> = None;
    let mut checked = Checked::default();
    for (at, arg) in args.iter().enumerate() {
        if at >= MAX_PATHS || classify_argument(arg) != ArgForm::Path {
            checked.refused = checked.refused.saturating_add(1);
            continue;
        }
        let dir = if Path::new(arg).is_absolute() {
            None
        } else {
            folder
                .get_or_insert_with(|| {
                    cwd.filter(|text| cwd_form_ok(text))
                        .map(PathBuf::from)
                        .filter(|dir| dir.is_dir())
                })
                .as_deref()
        };
        match check_one(arg, dir, state_file) {
            Some(path) if checked.paths.contains(&path) => {}
            Some(path) => checked.paths.push(path),
            None => checked.refused = checked.refused.saturating_add(1),
        }
    }
    checked
}

/// macOS: the paths of `file:` URLs (`Url::to_file_path`), as text; the first [`MAX_PATHS`] only.
/// Any other scheme, a URL that names no local path and a path that is not UTF-8 are refused,
/// as is every URL past the limit. Answers the texts and the number refused.
#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
pub fn url_arguments(urls: &[tauri::Url]) -> (Vec<String>, u32) {
    let mut texts = Vec::new();
    let mut refused = u32::try_from(urls.len().saturating_sub(MAX_PATHS)).unwrap_or(u32::MAX);
    for url in urls.iter().take(MAX_PATHS) {
        let text = (url.scheme() == "file")
            .then(|| url.to_file_path().ok())
            .flatten()
            .and_then(|path| path.to_str().map(str::to_owned));
        match text {
            Some(text) => texts.push(text),
            None => refused = refused.saturating_add(1),
        }
    }
    (texts, refused)
}

/// The window the paths belong in comes to the front: shown, un-minimised, focused. Answers
/// whether there was a window. Errors of the window system are not ours to report.
fn raise_main_window<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    true
}

/// The payload of [`EVENT`]. Nothing else ever goes to the webview from a hand-over.
#[derive(Clone, serde::Serialize)]
struct Payload {
    paths: Vec<String>,
    refused: u32,
}

/// Paths that passed the checks and were granted: emitted at once, or kept until the webview asks
/// ([`OpenRequests::deliver`]). The window is raised only when at least one path came; answers
/// whether it was.
pub fn deliver_granted<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>, refused: u32) -> bool {
    if paths.is_empty() && refused == 0 {
        return false;
    }
    let raise = !paths.is_empty();
    let queue = app.state::<OpenRequests>();
    if let Delivery::Emit { paths, refused } = queue.deliver(paths, refused) {
        let _ = app.emit(EVENT, Payload { paths, refused });
    }
    raise && raise_main_window(app)
}

/// The whole of S7 for one hand-over: check, grant each file, deliver. Blocking (the file system
/// may be a share that has gone away): callers run it off the plugin's and the main thread.
fn handle(app: &AppHandle, args: &[String], cwd: Option<&str>, already_refused: u32) {
    let Ok(dirs) = paths::app_dirs(app) else {
        let all = u32::try_from(args.len()).unwrap_or(u32::MAX);
        deliver_granted(app, Vec::new(), already_refused.saturating_add(all));
        return;
    };
    let checked = check_arguments(args, cwd, &dirs.state_file());
    let mut texts = Vec::with_capacity(checked.paths.len());
    for path in &checked.paths {
        state::grant_file(app, path);
        if let Some(text) = path.to_str() {
            texts.push(text.to_owned());
        }
    }
    deliver_granted(app, texts, checked.refused.saturating_add(already_refused));
}

/// A second gEdit process was started with `args` (the executable first) in the working folder
/// `cwd`. Runs in the first process, on the plugin's thread; the work goes to the blocking pool.
#[cfg(any(windows, target_os = "linux"))]
pub fn second_instance(app: &AppHandle, args: Vec<String>, cwd: String) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        handle(&app, args.get(1..).unwrap_or_default(), Some(&cwd), 0);
    });
}

/// The arguments of this very process as text. One that is not UTF-8 becomes the empty text,
/// which the checks refuse and count (a path that cannot travel as JSON cannot be opened).
#[cfg_attr(not(any(test, windows, target_os = "linux")), allow(dead_code))]
pub fn text_arguments(args: impl IntoIterator<Item = std::ffi::OsString>) -> Vec<String> {
    args.into_iter()
        .map(|arg| arg.into_string().unwrap_or_default())
        .collect()
}

/// Windows and Linux: a double-click on a program file while gEdit is **not** running starts the
/// first process with the path as its own argument (the plugin only hears of later ones). Its
/// arguments go through the same checks as a second process's, once, when the app is ready; they
/// wait in the queue until the window can take them. A second process started where the plugin is
/// not registered (Linux without a session bus) opens its own file the same way.
#[cfg(any(windows, target_os = "linux"))]
pub fn started_with(app: &AppHandle) {
    let args = text_arguments(std::env::args_os());
    let cwd = std::env::current_dir()
        .ok()
        .and_then(|dir| dir.into_os_string().into_string().ok())
        .unwrap_or_default();
    second_instance(app, args, cwd);
}

/// macOS: the system asks the running app to open these URLs (on the main thread, so the work
/// goes to the blocking pool).
#[cfg(target_os = "macos")]
pub fn opened(app: &AppHandle, urls: &[tauri::Url]) {
    let (texts, refused) = url_arguments(urls);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || handle(&app, &texts, None, refused));
}

/// The single-instance plugin with the P4f callback. Windows and Linux only; it is the first
/// plugin of the builder (the plugin must run before anything else starts a window).
#[cfg(any(windows, target_os = "linux"))]
pub fn single_instance_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_single_instance::init(second_instance)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| (*n).to_owned()).collect()
    }

    #[test]
    fn the_limits_are_the_plan_s() {
        assert_eq!(MAX_PATHS, 32);
        assert_eq!(MAX_ARG_CHARS, 4096);
        assert_eq!(MAX_PENDING, 64);
        assert_eq!(EVENT, "gedit-open-requests");
    }

    #[test]
    fn a_path_before_the_webview_is_ready_waits_and_one_after_it_is_emitted() {
        let queue = OpenRequests::default();
        assert_eq!(queue.deliver(paths(&["/a.nc"]), 0), Delivery::Queued);
        assert_eq!(queue.deliver(paths(&["/b.nc"]), 1), Delivery::Queued);
        let ready = queue.take_ready();
        assert_eq!(ready.paths, paths(&["/a.nc", "/b.nc"]));
        assert_eq!((ready.dropped, ready.refused), (0, 1));
        assert_eq!(
            queue.deliver(paths(&["/c.nc"]), 2),
            Delivery::Emit {
                paths: paths(&["/c.nc"]),
                refused: 2
            }
        );
        // Asking again returns nothing: each path reaches the webview once.
        assert_eq!(queue.take_ready(), OpenRequestsReady::default());
    }

    #[test]
    fn a_waiting_queue_is_bounded_and_says_how_many_it_dropped() {
        let queue = OpenRequests::default();
        let many: Vec<String> = (0..MAX_PENDING + 5).map(|i| format!("/{i}.nc")).collect();
        assert_eq!(queue.deliver(many, 0), Delivery::Queued);
        let ready = queue.take_ready();
        assert_eq!(ready.paths.len(), MAX_PENDING);
        assert_eq!(ready.dropped, 5);
        // The newest are kept: the user's last double-click is the one they are waiting for.
        assert_eq!(
            ready.paths.last().unwrap(),
            &format!("/{}.nc", MAX_PENDING + 4)
        );
    }

    #[test]
    fn the_answer_is_camel_case_on_the_wire() {
        let json = serde_json::to_value(OpenRequestsReady {
            paths: paths(&["/a.nc"]),
            dropped: 2,
            refused: 1,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "paths": ["/a.nc"], "dropped": 2, "refused": 1 })
        );
    }

    /// The plugin of the 2.4 line panics at start without a session bus; the check keeps it out.
    #[test]
    fn the_session_bus_is_found_by_its_address_or_by_the_default_socket() {
        let none = |_: &str| None;
        assert!(!dbus_session_available(none, |_| true));
        let with_address = |name: &str| {
            (name == "DBUS_SESSION_BUS_ADDRESS").then(|| "unix:path=/run/user/1000/bus".to_owned())
        };
        assert!(dbus_session_available(with_address, |_| false));
        let blank_address =
            |name: &str| (name == "DBUS_SESSION_BUS_ADDRESS").then(|| "  ".to_owned());
        assert!(!dbus_session_available(blank_address, |_| false));
        let runtime = |name: &str| (name == "XDG_RUNTIME_DIR").then(|| "/run/user/1000".to_owned());
        assert!(dbus_session_available(runtime, |p| p == Path::new("/run/user/1000/bus")));
        assert!(!dbus_session_available(runtime, |_| false));
    }

    // ---- S7: the argument checks -------------------------------------------------------------

    use std::fs;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A fresh folder under the temp folder, canonical (the temp folder may be a link).
    fn scratch(name: &str) -> PathBuf {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "gedit-open-{}-{}-{name}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::canonicalize(&dir).unwrap()
    }

    fn text(path: &Path) -> String {
        path.to_str().unwrap().to_owned()
    }

    fn check(args: &[String], cwd: Option<&str>, root: &Path) -> Checked {
        check_arguments(args, cwd, &root.join("state.json"))
    }

    #[test]
    fn an_option_an_empty_text_a_nul_and_a_long_text_are_not_paths() {
        assert_eq!(classify_argument("-psn_0_12345"), ArgForm::Option);
        assert_eq!(classify_argument("--help"), ArgForm::Option);
        assert_eq!(classify_argument(""), ArgForm::Empty);
        assert_eq!(classify_argument("/a\0b.nc"), ArgForm::HasNul);
        assert_eq!(
            classify_argument(&format!("/{}", "a".repeat(MAX_ARG_CHARS))),
            ArgForm::TooLong
        );
        assert_eq!(
            classify_argument(&format!("/{}", "a".repeat(MAX_ARG_CHARS - 1))),
            ArgForm::Path
        );
        assert_eq!(classify_argument("part 1.nc"), ArgForm::Path);
        // Characters, not bytes: 4,096 umlauts are 8,192 bytes and still allowed.
        assert_eq!(
            classify_argument(&"\u{e4}".repeat(MAX_ARG_CHARS)),
            ArgForm::Path
        );
    }

    #[test]
    fn the_working_folder_is_used_only_when_it_is_absolute_and_sound() {
        assert!(cwd_form_ok(&text(&std::env::temp_dir())));
        assert!(!cwd_form_ok(""));
        assert!(!cwd_form_ok("relative/folder"));
        assert!(!cwd_form_ok("."));
        assert!(!cwd_form_ok(&format!("{}\0", text(&std::env::temp_dir()))));
        assert!(!cwd_form_ok(&format!("/{}", "a".repeat(MAX_ARG_CHARS))));
    }

    #[test]
    fn only_a_path_with_no_root_and_no_drive_is_relative() {
        assert!(is_plain_relative(Path::new("part.nc")));
        assert!(is_plain_relative(Path::new("sub/part.nc")));
        assert!(is_plain_relative(Path::new("../part.nc")));
        assert!(!is_plain_relative(Path::new("/part.nc")));
        assert!(!is_plain_relative(Path::new("")));
        // Windows spellings; on other systems these are ordinary relative names.
        #[cfg(windows)]
        for odd in [r"\part.nc", "C:part.nc", r"\\?\C:\part.nc"] {
            assert!(!is_plain_relative(Path::new(odd)), "{odd}");
        }
    }

    #[test]
    fn an_absolute_file_is_kept_as_its_canonical_path() {
        let root = scratch("absolute");
        let file = root.join("part.nc");
        fs::write(&file, "G0 X0\n").unwrap();
        let checked = check(&[text(&file)], None, &root);
        assert_eq!(checked.paths, vec![file]);
        assert_eq!(checked.refused, 0);
    }

    #[test]
    fn a_relative_path_is_joined_only_to_a_good_working_folder() {
        let root = scratch("relative");
        fs::write(root.join("part.nc"), "x").unwrap();
        let file = root.join("part.nc");
        let args = ["part.nc".to_owned()];
        // A good folder.
        let good = check(&args, Some(&text(&root)), &root);
        assert_eq!(good.paths, vec![file.clone()]);
        // No folder, a relative folder, an empty one.
        for cwd in [None, Some("."), Some(""), Some("relative/folder")] {
            let refused = check(&args, cwd, &root);
            assert_eq!((refused.paths.len(), refused.refused), (0, 1), "{cwd:?}");
        }
        // A folder that is a file, one that is missing.
        let not_a_dir = text(&file);
        let missing = text(&root.join("gone"));
        for cwd in [not_a_dir.as_str(), missing.as_str()] {
            let refused = check(&args, Some(cwd), &root);
            assert_eq!((refused.paths.len(), refused.refused), (0, 1), "{cwd}");
        }
        // A folder with a NUL.
        let nul = format!("{}\0", text(&root));
        assert_eq!(check(&args, Some(&nul), &root).refused, 1);
        // An absolute path needs no folder at all, even a bad one.
        let absolute = check(&[text(&file)], Some("relative/folder"), &root);
        assert_eq!(absolute.paths, vec![file]);
    }

    #[test]
    fn a_folder_a_missing_file_and_state_json_are_refused() {
        let root = scratch("refused");
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("state.json"), "{}").unwrap();
        let args = [
            text(&root.join("sub")),
            text(&root.join("missing.nc")),
            text(&root.join("state.json")),
            // The same file spelled through a folder and back.
            text(&root.join("sub").join("..").join("state.json")),
        ];
        let checked = check(&args, None, &root);
        assert!(checked.paths.is_empty());
        assert_eq!(checked.refused, 4);
    }

    #[test]
    fn options_long_and_nul_texts_are_refused_and_counted_beside_good_files() {
        let root = scratch("mixed");
        let file = root.join("a.nc");
        fs::write(&file, "x").unwrap();
        let args = [
            "-psn_0_1".to_owned(),
            text(&file),
            format!("/{}", "a".repeat(MAX_ARG_CHARS)),
            format!("{}\0", text(&file)),
            text(&file),
        ];
        let checked = check(&args, None, &root);
        // The repeated file is kept once and not counted as refused.
        assert_eq!(checked.paths, vec![file]);
        assert_eq!(checked.refused, 3);
    }

    #[test]
    fn at_most_thirty_two_arguments_are_looked_at() {
        let root = scratch("many");
        let args: Vec<String> = (0..MAX_PATHS + 1)
            .map(|i| {
                let file = root.join(format!("p{i:02}.nc"));
                fs::write(&file, "x").unwrap();
                text(&file)
            })
            .collect();
        let checked = check(&args, None, &root);
        assert_eq!(checked.paths.len(), MAX_PATHS);
        assert_eq!(checked.refused, 1);
        // The thirty-third is the one left out.
        assert!(!checked.paths.iter().any(|p| p.ends_with("p32.nc")));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_delivered_as_the_file_it_points_to_and_a_fifo_is_refused() {
        let root = scratch("links");
        let target = root.join("real.nc");
        fs::write(&target, "x").unwrap();
        let link = root.join("link.nc");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let fifo = root.join("pipe.nc");
        let made = std::process::Command::new("mkfifo").arg(&fifo).status();
        let checked = check(&[text(&link), text(&fifo)], None, &root);
        assert_eq!(checked.paths, vec![target]);
        // Only counted when the fifo could be made here.
        assert_eq!(checked.refused, u32::from(made.is_ok_and(|s| s.success())));
        // A link to the state file is the state file.
        let state = root.join("state.json");
        fs::write(&state, "{}").unwrap();
        let state_link = root.join("s.nc");
        std::os::unix::fs::symlink(&state, &state_link).unwrap();
        assert_eq!(
            check(&[text(&state_link)], None, &root).paths,
            Vec::<PathBuf>::new()
        );
    }

    #[test]
    fn a_dos_device_name_is_a_device_only_on_windows() {
        let root = scratch("device");
        fs::write(root.join("CON.nc"), "x").unwrap();
        let checked = check(&[text(&root.join("CON.nc"))], None, &root);
        assert_eq!(checked.paths.len(), usize::from(!cfg!(windows)));
        assert_eq!(checked.refused, u32::from(cfg!(windows)));
    }

    #[test]
    fn the_own_arguments_are_text_and_one_that_is_not_utf8_is_left_empty() {
        let args = ["gedit", "/a.nc"].map(std::ffi::OsString::from);
        assert_eq!(
            text_arguments(args),
            vec!["gedit".to_owned(), "/a.nc".to_owned()]
        );
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStringExt;
            let bad = std::ffi::OsString::from_vec(vec![b'/', 0xff, b'.', b'n', b'c']);
            assert_eq!(text_arguments([bad]), vec![String::new()]);
            // The checks refuse and count it.
            let root = scratch("not-utf8");
            let checked = check(&[String::new()], None, &root);
            assert_eq!((checked.paths.len(), checked.refused), (0, 1));
        }
    }

    #[test]
    fn a_file_url_is_a_path_and_every_other_url_is_refused() {
        let file = tauri::Url::parse("file:///tmp/part%201.nc").unwrap();
        let web = tauri::Url::parse("https://example.com/part.nc").unwrap();
        let custom = tauri::Url::parse("gedit://open?path=/etc/passwd").unwrap();
        let (texts, refused) = url_arguments(&[file, web, custom]);
        #[cfg(unix)]
        assert_eq!(texts, vec!["/tmp/part 1.nc".to_owned()]);
        assert_eq!(refused, 2 + u32::from(cfg!(not(unix))));
        #[cfg(unix)]
        {
            // A file URL with a host names another machine's file.
            let remote = tauri::Url::parse("file://server/share/part.nc").unwrap();
            assert_eq!(url_arguments(&[remote]), (Vec::new(), 1));
        }
        // Over the limit: counted, never read.
        let many: Vec<tauri::Url> = (0..MAX_PATHS + 3)
            .map(|i| tauri::Url::parse(&format!("https://example.com/{i}")).unwrap())
            .collect();
        assert_eq!(
            url_arguments(&many),
            (Vec::new(), u32::try_from(MAX_PATHS + 3).unwrap())
        );
    }

    // ---- The grant, the emit and the window raise ---------------------------------------------

    mod delivery {
        use super::*;
        use std::sync::{Arc, Mutex};
        use tauri::test::{mock_builder, mock_context, noop_assets};
        use tauri::{Listener, WebviewUrl, WebviewWindowBuilder};

        fn app(with_window: bool) -> tauri::App<tauri::test::MockRuntime> {
            let app = mock_builder()
                .manage(OpenRequests::default())
                .build(mock_context(noop_assets()))
                .unwrap();
            if with_window {
                WebviewWindowBuilder::new(app.handle(), "main", WebviewUrl::default())
                    .build()
                    .unwrap();
            }
            app
        }

        fn heard(app: &tauri::App<tauri::test::MockRuntime>) -> Arc<Mutex<Vec<String>>> {
            let log = Arc::new(Mutex::new(Vec::new()));
            let sink = log.clone();
            app.listen(EVENT, move |event| {
                sink.lock().unwrap().push(event.payload().to_owned());
            });
            log
        }

        #[test]
        fn paths_wait_until_the_webview_asks_then_arrive_as_an_event_with_nothing_else() {
            let app = app(true);
            let log = heard(&app);
            let handle = app.handle();

            // Before the webview is ready: nothing is emitted, the window still comes up.
            assert!(deliver_granted(handle, paths(&["/a.nc"]), 1));
            assert!(log.lock().unwrap().is_empty());
            let ready = handle.state::<OpenRequests>().take_ready();
            assert_eq!(ready.paths, paths(&["/a.nc"]));
            assert_eq!(ready.refused, 1);

            // After: an event whose payload is exactly { paths, refused }.
            assert!(deliver_granted(handle, paths(&["/b.nc"]), 2));
            let sent = log.lock().unwrap().clone();
            assert_eq!(sent.len(), 1);
            let value: serde_json::Value = serde_json::from_str(&sent[0]).unwrap();
            assert_eq!(
                value,
                serde_json::json!({ "paths": ["/b.nc"], "refused": 2 })
            );
        }

        #[test]
        fn the_window_is_raised_only_when_a_path_was_delivered() {
            let app = app(true);
            let handle = app.handle();
            handle.state::<OpenRequests>().take_ready();
            let log = heard(&app);
            assert!(!deliver_granted(handle, Vec::new(), 3));
            // The webview still hears of the refusals.
            assert_eq!(log.lock().unwrap().len(), 1);
            assert!(!deliver_granted(handle, Vec::new(), 0));
            assert_eq!(log.lock().unwrap().len(), 1);
            // No window: nothing to raise, the paths still arrive.
            let bare = self::app(false);
            bare.handle().state::<OpenRequests>().take_ready();
            assert!(!deliver_granted(bare.handle(), paths(&["/c.nc"]), 0));
        }
    }
}
