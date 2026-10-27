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
//! Written by the P4f prelude. What is final: the queue ([`OpenRequests`]) and the command
//! [`open_requests_ready`], the event name, the limits and the bus check. What P4.29 writes: the
//! checks of what the second process or the system sent ([`second_instance`], [`opened`]); until
//! then both drop what they receive. The rules they implement are in section 6.8: *what a second
//! instance may pass*.

// A stub until its package lands (P4.27 / P4.29): the limits, types and queue are final and tested,
// the code that uses them is not written yet. The package deletes this line.
#![allow(dead_code)]

use std::path::Path;
use std::sync::Mutex;

#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
use tauri::AppHandle;
use tauri::State;

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

/// A second gEdit process was started with `args` in the working folder `cwd`. Runs in the
/// first process, on the plugin's thread. **Stub:** P4.29 validates every argument (section
/// 6.8, "what a second instance may pass"), grants the files, raises the window and delivers.
#[cfg(any(windows, target_os = "linux"))]
pub fn second_instance(_app: &AppHandle, _args: Vec<String>, _cwd: String) {}

/// macOS: the system asks the running app to open these URLs. **Stub:** P4.29 reads the
/// `file:` URLs, applies the same checks and delivers.
#[cfg(target_os = "macos")]
pub fn opened(_app: &AppHandle, _urls: &[tauri::Url]) {}

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
}
