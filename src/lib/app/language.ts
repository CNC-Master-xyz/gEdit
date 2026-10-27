// The interface language at startup (Phase 4 plan §6.9 rules 37–42, Q4-18). Written by the P4g
// prelude; P4.37 fills it in.
//
// `activateLanguage()` runs once, right after `settings.load()` and before anything is rendered
// or any user file is read (so the first messages are already in the right language): it reads
// `ui.language`, resolves it against the message sets that ship (`resolveLocale`), loads the set
// (`loadLocale`) and makes the translator of `i18n/index.ts` use it, with English as the fallback
// for every missing key. It never throws: a set that cannot be loaded leaves English in use and
// shows one notice. The language does not change while the app runs.
//
// The stub does nothing, so English is in use until P4.37.

export async function activateLanguage(): Promise<void> {
  // P4.37.
}
