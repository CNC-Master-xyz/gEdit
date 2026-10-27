//! The gEdit backend: it wires the plugins, the commands and the macOS menu
//! together and hands the event loop over to Tauri.
//!
//! Everything else lives in a module of its own, so that this file stays a single
//! readable description of the app's native surface:
//!
//! - [`files`] — `files_stat`, the only command the editor core calls
//! - [`paths`] — where the config, data and user-script folders are
//! - [`atomic`] — crash-safe writes for the app's own small JSON files
//! - [`config`] — `settings.json`
//! - [`machines`] — `machines.json`: the user's machine configurations (M6)
//! - [`quit`] — the macOS quit guard (M6)
//! - [`backup`] — the copy made before a save overwrites a file (M7)
//! - [`recovery`] — crash-recovery snapshots of unsaved documents (M7)
//! - [`session`] — the files that were open when gEdit was last closed (M7)
//! - [`state`] — `state.json`: the recent-files list and the webview's UI state
//! - [`menu`] — the macOS menu and the two window-closing requests (macOS only)
//! - [`python`] — finding the user's Python interpreter
//! - [`scripts`] — the v2 scripting backend: discovery, the TOML header and the runner
//! - [`userfiles`] — the user's own profiles and code files (M13)
//! - [`folders`] — the folder commands: search, sibling names, one file's grant (P4f, AD-53)
//! - [`open_requests`] — files the operating system asks gEdit to open, and the single
//!   running instance (P4f, AD-54)
//!
//! Window geometry is not ours: `tauri-plugin-window-state` saves and restores it
//! into `.window-state.json` next to `settings.json` in the config folder. Its
//! `VISIBLE` flag is left out on purpose, so that a window the user closed while
//! hidden cannot come back hidden.
//!
//! Keep the shape of [`run`]: the runtime harness (`tests/runtime/sync.sh`) builds
//! its test variant by string-replacing the builder expression and the opening of
//! the command-handler macro, and refuses to patch a `lib.rs` that spells either
//! of them more than once — a mention in a comment counts.

mod atomic;
mod backup;
mod channels;
mod config;
mod files;
mod folders;
mod machines;
#[cfg(target_os = "macos")]
mod menu;
mod open_requests;
mod paths;
mod python;
mod quit;
mod recovery;
pub mod scripts;
mod session;
/// Test-only: how the tests that read their own file with `include_str!` read it,
/// so that the checkout's line endings cannot decide whether they pass.
#[cfg(test)]
mod source_scan;
mod state;
mod userfiles;

use tauri::{App, AppHandle, RunEvent};
use tauri_plugin_window_state::StateFlags;

/// Runs once, before the window is shown: the folders the app writes to have to
/// exist, and the recent files have to be back in the fs scope before the webview
/// can ask to reopen one.
fn setup_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();
    paths::ensure_dirs(handle);
    state::grant_recent_on_startup(handle);
    // M7, AD-22: the session's files have to be in the fs scope before the webview can
    // ask to reopen them, exactly like the recent list above.
    session::grant_on_startup(handle);
    // M7, AD-21: this run's recovery folder and its `alive` heartbeat exist before the
    // window does, because the first snapshot can follow the first keystroke.
    recovery::start_session(handle);
    // macOS only in effect: Dock -> Quit and a logout never reach the window, so the
    // answer to "may I terminate?" has to be ready before one is asked (AD-20).
    quit::install(handle);
    // The menu exists by now; Shift+Cmd+W on its Close Window items (see `menu`).
    quit::install_menu_shortcuts(handle);
    Ok(())
}

/// Called for every event of the running app (`ExitRequested`, `Exit`, window and
/// menu events).
///
/// On `Exit` every script process is stopped (plan AD-13), so a `while True:` script
/// cannot outlive the window. `RunEvent` is `#[non_exhaustive]`, hence the `matches!`.
///
/// What deliberately does **not** happen here is clearing the recovery snapshots: a
/// Windows logoff also ends in `Exit` (F29), and a logoff is exactly the case the
/// snapshots are for. They are cleared from `files.onWillQuit`, after the user's own
/// quit decision (AD-21).
fn on_run_event(app: &AppHandle, event: RunEvent) {
    // macOS: a double-click in the Finder arrives here, also before the window has a page
    // (`open_requests` queues it). `RunEvent::Opened` exists on macOS and iOS only.
    #[cfg(target_os = "macos")]
    if let RunEvent::Opened { urls } = &event {
        open_requests::opened(app, urls);
    }
    // Windows and Linux: the file the first process was started with (the plugin hears of the
    // later ones). Queued until the window is ready.
    #[cfg(any(windows, target_os = "linux"))]
    if matches!(event, RunEvent::Ready) {
        open_requests::started_with(app);
    }
    if matches!(event, RunEvent::Exit) {
        scripts::kill_all(app);
    }
}

/// Everything the window-state plugin tracks except `VISIBLE` (plan AD-9): size,
/// position, maximized, decorations and fullscreen.
fn window_state_flags() -> StateFlags {
    StateFlags::all().difference(StateFlags::VISIBLE)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // One running gEdit (AD-54): a second start hands its file paths to the first and ends.
    // Windows and Linux only, and registered first, before any plugin or window exists.
    #[cfg(any(windows, target_os = "linux"))]
    let builder = if open_requests::single_instance_possible() {
        builder.plugin(open_requests::single_instance_plugin())
    } else {
        builder
    };
    let builder = builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window_state_flags())
                .build(),
        )
        // The in-flight script runs, so that `script_cancel` and `kill_all` reach the
        // same registry the runner polls (plan AD-13).
        .manage(scripts::RunRegistry::default())
        // Whether any document has unsaved changes, for the macOS termination hook
        // (AD-20): the delegate answers from this flag, never by asking the webview.
        .manage(quit::QuitGuard::default())
        // Files the system asked us to open before the webview could take them (AD-54).
        .manage(open_requests::OpenRequests::default())
        // The one running folder search and the stuck ones (AD-53, section 6.8 S4).
        .manage(folders::SearchRegistry::default())
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            files::files_stat,
            config::config_load,
            config::settings_save,
            config::settings_open_file,
            machines::machines_save,
            machines::machines_replace,
            machines::machines_open_file,
            quit::quit_guard_set_dirty,
            backup::files_backup,
            channels::channel_siblings,
            folders::folder_search,
            folders::folder_search_cancel,
            folders::folder_siblings,
            folders::folder_grant,
            open_requests::open_requests_ready,
            userfiles::user_files_list,
            userfiles::user_file_create,
            userfiles::user_file_path,
            userfiles::user_file_import,
            userfiles::user_file_delete,
            session::session_save,
            session::session_load,
            recovery::recovery_put,
            recovery::recovery_drop,
            recovery::recovery_clear_current,
            recovery::recovery_list,
            recovery::recovery_read,
            recovery::recovery_discard,
            recovery::recovery_discard_entry,
            state::ui_state_save,
            state::recent_list,
            state::recent_touch,
            state::recent_remove,
            state::recent_clear,
            scripts::discovery::scripts_list,
            scripts::discovery::script_new,
            scripts::discovery::script_copy_to_user,
            scripts::discovery::script_source_path,
            scripts::runner::script_run,
            scripts::runner::script_cancel,
            scripts::runner::python_check
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build).on_menu_event(menu::on_menu_event);

    builder
        .build(tauri::generate_context!())
        .expect("error while building the tauri application")
        .run(on_run_event);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// AD-9: everything but `VISIBLE`, so a restart always shows the window.
    #[test]
    fn window_state_tracks_everything_but_visibility() {
        let flags = window_state_flags();
        assert!(!flags.contains(StateFlags::VISIBLE));
        for flag in [
            StateFlags::SIZE,
            StateFlags::POSITION,
            StateFlags::MAXIMIZED,
            StateFlags::DECORATIONS,
            StateFlags::FULLSCREEN,
        ] {
            assert!(flags.contains(flag), "missing {flag:?}");
        }
    }
}
