// The helper API that scenarios get as `h` (plan §7.9). Runs inside the app page.

import { keyEvent, typeEvents } from './keys.js'

/** @typedef {import('./recorder.js').Recorder} Recorder */
/** @typedef {import('./recorder.js').Send} Send */
/** @typedef {import('./keys.js').KeySpec} KeySpec */
/** @typedef {import('$lib/app/testHook').GeditTestHook} GeditTestHook */

/**
 * What the runner passes to the page.
 * @typedef {object} RunConfig
 * @property {string} scenario
 * @property {string} run run folder (canonical path)
 * @property {string} home HOME of the app
 * @property {string} python interpreter the harness uses for GEDIT_PYTHON by default
 * @property {string} appVersion version in the synced package.json
 * @property {boolean} [ci] the harness ran with `CI` set (a hosted runner): wall-clock budgets
 *   that are measured on the owner's Mac get `CI_TIME_FACTOR` (see `h.checkTime`)
 * @property {boolean} [robust] false with `GEDIT_RH_ROBUST=0`: the activation gate and
 *   the frame-synced waits are off, so a run can be measured against the old harness
 */

/**
 * @typedef {object} ExitExpectation
 * @property {number} [code] expected exit code (default 0)
 * @property {string} [signal] expected signal instead of an exit code, e.g. `SIGKILL`
 *   after `h.crash()`. When it is set the code is not checked: a killed process has none
 * @property {number} [within] ms to wait for the exit after the scenario returns (default 10000)
 * @property {{ path: string, includes?: string, excludes?: string, hex?: string, missing?: boolean }[]} [files]
 *   checked by the runner after the exit
 * @property {string[]} [events] run events the app must have printed, e.g. `MenuEvent quit`
 */

/**
 * What AppKit and the window server say about who owns the keyboard.
 * @typedef {object} FocusState
 * @property {boolean} active `[NSApp isActive]`
 * @property {boolean} key some window of the app is the key window
 * @property {boolean} mainKey the main window itself is key (false while an alert is up)
 * @property {boolean} visible
 * @property {string} keyWindow class of `[NSApp keyWindow]`, empty when there is none
 * @property {number} frontPid pid of the frontmost application
 * @property {string} frontApp its name
 * @property {number} ourPid
 * @property {number} alerts visible alert panels
 * @property {boolean} [deliverable] whether native input would reach the app
 * @property {string} [reason] why it would not
 */

/** @typedef {{ len: number, mtimeMs: number, mode: number, isFile: boolean, isDir: boolean }} Stat */
/** @typedef {{ name: string, isFile: boolean, isDir: boolean, isSymlink: boolean, len: number }} DirEntry */
/**
 * The main window as the window server has it. Sizes are in physical pixels, like the
 * `.window-state.json` the window-state plugin writes; `scale` turns them into logical ones.
 * @typedef {object} WindowGeometry
 * @property {number} width inner (content) width
 * @property {number} height inner (content) height
 * @property {number} x outer position, left
 * @property {number} y outer position, top
 * @property {number} scale physical pixels per logical pixel
 * @property {boolean} maximized
 * @property {boolean} fullscreen
 */
/** @typedef {{ texts: string[], buttons: string[], count: number }} AlertInfo */
/** @typedef {Record<string, string | number | boolean>} Attrs */

// Attributes matched literally by h.q; any other key is a data attribute (`docId` -> `data-doc-id`).
const PLAIN_ATTRS = new Set(['disabled', 'role', 'title', 'hidden', 'checked', 'value', 'id'])

/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Resolves after the browser has rendered a frame, so what is read next is what is on
 * the screen. Two `requestAnimationFrame`s: the first runs before the paint of the frame
 * the pending work belongs to, the second after it. Guarded by a timeout, because a page
 * that WebKit decides not to draw (an occluded window, a background tab) would otherwise
 * never call back.
 * @param {number} [timeout] ms
 * @returns {Promise<boolean>} whether a frame was actually rendered
 */
export function nextFrame(timeout = 250) {
  return new Promise((resolve) => {
    let settled = false
    const done = (/** @type {boolean} */ drawn) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(drawn)
    }
    const timer = setTimeout(() => done(false), timeout)
    requestAnimationFrame(() => requestAnimationFrame(() => done(true)))
  })
}

/**
 * Calls a backend command through Tauri's IPC.
 * @param {string} cmd
 * @param {Record<string, unknown> | Uint8Array} [args] a raw byte body goes to commands
 *   that take one (`plugin:fs|write_file`), together with `options.headers`
 * @param {{ headers?: Record<string, string> }} [options]
 * @returns {Promise<any>}
 */
export function invoke(cmd, args, options) {
  return /** @type {any} */ (window).__TAURI_INTERNALS__.invoke(cmd, args, options)
}

/**
 * `[data-testid=…]` plus attribute filters: a string or number must match exactly,
 * `true` requires the attribute, `false` requires it to be absent.
 * @param {string} testid
 * @param {Attrs} [attrs]
 */
export function selector(testid, attrs = {}) {
  let sel = `[data-testid="${CSS.escape(testid)}"]`
  for (const [key, value] of Object.entries(attrs)) {
    const attr =
      key.includes('-') || PLAIN_ATTRS.has(key)
        ? key
        : 'data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
    if (value === true) sel += `[${attr}]`
    else if (value === false) sel += `:not([${attr}])`
    else sel += `[${attr}="${CSS.escape(String(value))}"]`
  }
  return sel
}

/**
 * How much a wall-clock budget is stretched on a hosted CI runner (`cfg.ci`), see `checkTime`.
 * The budgets are the development Mac's (G7); a shared macOS runner is not that machine, and
 * UI timings there vary 5-10x between runs (a tab switch onto a 10 MB document measured 349 ms
 * against 100, switching away 607 ms against 100). 10 keeps CI to gross regressions only.
 */
export const CI_TIME_FACTOR = 10

/**
 * @param {RunConfig} cfg
 * @param {Recorder} rec
 * @param {Send} send queues a record for the runner; it is **not** on stdout yet
 * @param {() => Promise<void>} [drain] resolves once everything queued has reached Rust.
 *   Only `h.crash()` needs it: every other end of a run drains in `runner.js`.
 */
export function createHarness(cfg, rec, send, drain = async () => {}) {
  /** @type {{ name: string, pass: boolean }[]} */
  const checks = []
  /** @type {ExitExpectation | null} */
  let exitExpected = null
  const robust = cfg.robust !== false

  /**
   * Hands everything queued so far to Rust, but only while an exit is expected. The queue
   * dies with the process: a call that can end the app (a quit, a close, Cmd+Q, Cmd+Shift+W)
   * would otherwise race its own `expect-exit` record, and the run is then judged "the
   * scenario never finished" although every check passed. With no exit expected the call
   * costs nothing extra.
   */
  const flushIfExiting = () => (exitExpected ? drain() : Promise.resolve())

  /** One private Monaco service per id, found once (see `h.monaco`). @type {Map<string, any>} */
  const monacoServices = new Map()

  /**
   * Waits for a condition. The first sample is taken straight away, so a condition that
   * already holds costs nothing; every later one is taken **after a rendered frame**, so
   * a DOM read never lands in the frame the app is still building. That closes the
   * commonest timing flake: `waitFor` returning on a state Svelte had written but the
   * editor had not laid out yet.
   * @template T
   * @param {() => T | Promise<T>} fn
   * @param {{ timeout?: number, interval?: number }} [opts]
   * @returns {Promise<T | undefined>} the first truthy value, or the last value on timeout
   */
  async function waitFor(fn, { timeout = 5000, interval = 50 } = {}) {
    const end = performance.now() + timeout
    /** @type {T | undefined} */
    let v
    for (;;) {
      try {
        v = await fn()
      } catch {
        v = undefined
      }
      if (v || performance.now() >= end) return v
      await sleep(interval)
      if (robust) await nextFrame()
    }
  }

  /**
   * Waits until the page stops changing: no DOM mutation and no backend call in flight
   * for `quiet` ms in a row, sampled once per rendered frame. Use it after an action
   * whose effect has no single element to wait for (a theme change, a panel toggle, a
   * document switch), instead of a fixed sleep.
   * @param {{ quiet?: number, timeout?: number }} [opts]
   * @returns {Promise<boolean>} false when it was still busy at the timeout
   */
  async function idle({ quiet = 150, timeout = 5000 } = {}) {
    const end = performance.now() + timeout
    let last = performance.now()
    const observer = new MutationObserver(() => (last = performance.now()))
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
    try {
      for (;;) {
        await nextFrame()
        if (rec.ipc.inflight > 0) last = performance.now()
        if (performance.now() - last >= quiet) return true
        if (performance.now() >= end) return false
        await sleep(20)
      }
    } finally {
      observer.disconnect()
    }
  }

  /**
   * @param {string} testid
   * @param {Attrs} [attrs]
   * @returns {HTMLElement | null}
   */
  const q = (testid, attrs) => document.querySelector(selector(testid, attrs))

  /**
   * @param {string} testid
   * @param {Attrs} [attrs]
   * @returns {HTMLElement[]}
   */
  const qa = (testid, attrs) => [...document.querySelectorAll(selector(testid, attrs))].map((e) => /** @type {HTMLElement} */ (e))

  /** Focuses the editor's input (Monaco's hidden textarea inside editor-host). */
  const focusEditor = () => {
    const input = q('editor-host')?.querySelector('textarea')
    input?.focus()
    return !!input && document.activeElement === input
  }

  const h = {
    cfg,
    /** Recorded violations, console output, IPC and dialog calls of this page. */
    rec,
    sleep,
    invoke,

    /** @param {...unknown} args */
    log(...args) {
      send({ kind: 'log', msg: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') })
    },

    /**
     * Records a check; a false `cond` fails the scenario (the scenario keeps running).
     * @param {string} name
     * @param {unknown} cond
     * @param {unknown} [detail] evidence stored with the result
     * @returns {boolean} whether it passed
     */
    check(name, cond, detail) {
      const pass = !!cond
      checks.push({ name, pass })
      send({ kind: 'check', name, pass, detail })
      return pass
    },

    /**
     * Records a wall-clock budget check: `measured` must stay within `budgetMs`. Locally the
     * budget is the one the gate (G7, plan §5.2 rule 13) names; with `cfg.ci` it is that budget
     * times `CI_TIME_FACTOR`, so a shared runner only catches gross regressions. The check's
     * name always carries the measured value, the budget and, on CI, the factor; the detail
     * adds `measuredMs`, `budgetMs` (the local one), `effectiveBudgetMs` and `ciFactor`.
     * Every duration budget of the perf scenarios goes through here, never an inline `<=`.
     * @param {string} name what is measured, without the numbers
     * @param {number} measured milliseconds
     * @param {number} budgetMs the local budget in milliseconds
     * @param {unknown} [detail] evidence stored with the result (an object is extended)
     * @param {{ also?: unknown, strict?: boolean }} [opts] `also`: a further condition that must
     *   hold (not a timing); `strict`: the measurement must be below the budget, not equal to it
     * @returns {boolean} whether it passed
     */
    checkTime(name, measured, budgetMs, detail, opts = {}) {
      const factor = cfg.ci ? CI_TIME_FACTOR : 1
      const limit = budgetMs * factor
      const within = opts.strict ? measured < limit : measured <= limit
      const shown = Math.round(measured * 10) / 10
      const budgetText = cfg.ci ? `${limit} ms = ${budgetMs} ms x${factor} on CI` : `${limit} ms`
      const evidence = { measuredMs: measured, budgetMs, effectiveBudgetMs: limit, ciFactor: factor }
      const extra = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : detail === undefined ? {} : { detail }
      return h.check(`${name} [${shown} ms, budget ${budgetText}]`, within && (opts.also ?? true), { ...extra, ...evidence })
    },

    /** Checks recorded so far. */
    checks: () => checks.slice(),

    /**
     * Reports that this run could not be carried out for a reason outside the app - the
     * screen is locked, another app holds the keyboard, a tool is missing. The runner
     * reports BLOCKED instead of a failure, and the suite does not retry it.
     * @param {string} reason
     * @param {unknown} [detail]
     */
    blocked(reason, detail) {
      send({ kind: 'log', msg: `blocked: ${reason}` })
      return invoke('h_blocked', { reason, state: detail ?? null })
    },

    waitFor,
    idle,
    /** Resolves once the browser has rendered a frame. @returns {Promise<boolean>} */
    frame: nextFrame,

    /**
     * A wait measured in turns of the app instead of milliseconds: `n` round trips to the
     * main thread, each followed by a rendered frame. For the check that something did
     * **not** happen (a second alert did not stack, a window did not close): a fixed sleep is
     * too short on a loaded runner and too long everywhere else, while a number of turns
     * stretches with the load. Use `idle()` when no backend call is in flight and `waitFor`
     * when there is something to wait for; `turns` is for the state that stays as it is.
     * @param {number} [n]
     * @returns {Promise<void>}
     */
    async turns(n = 8) {
      for (let i = 0; i < n; i++) {
        // The window-state hop is the one that is known to be answered while an alert is up. A hop that
        // times out (a main thread busy for 3 s) is a turn that took long, not a failure of the wait.
        await invoke('h_window_state').catch(() => null)
        await nextFrame()
      }
    },
    q,
    qa,

    /**
     * Clicks an element the way the DOM does (`el.click()`); for a real mouse event use nativeClick.
     * @param {HTMLElement | null | undefined} el
     */
    click(el) {
      if (!el) throw new Error('h.click: no element')
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      el.click()
    },

    /**
     * Picks an option of a `<select>` and fires `input` and `change` like a user choice.
     * @param {HTMLElement | null | undefined} el
     * @param {string} value
     */
    select(el, value) {
      if (!(el instanceof HTMLSelectElement)) throw new Error('h.select: not a <select>')
      if (![...el.options].some((o) => o.value === value)) throw new Error(`h.select: no option ${value}`)
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    },

    /**
     * Real key presses (NSEvents), e.g. `[{ key: 's', mods: ['cmd'] }]`.
     * @param {KeySpec[]} keys
     * @returns {Promise<string[]>}
     */
    async nativeKeys(keys) {
      // Cmd+Q and Cmd+Shift+W end the app: see `flushIfExiting`.
      await flushIfExiting()
      return invoke('h_native_input', { events: keys.map(keyEvent) })
    },

    /**
     * Types US-layout text with real key presses (`\n` = Enter). The editor must have focus.
     * @param {string} text
     * @returns {Promise<string[]>}
     */
    nativeType: (text) => invoke('h_native_input', { events: typeEvents(text) }),

    /**
     * A real mouse click at the element's center. The harness brings the app to the
     * front first (a click on a window that is not key only activates it), and the
     * element is measured after a rendered frame, so the coordinates are the ones on
     * the screen rather than the ones from a layout that was still settling.
     * @param {HTMLElement | null | undefined} el
     * @param {{ dx?: number, dy?: number, clickCount?: number }} [opts] offset from the center
     * @returns {Promise<string[]>}
     */
    async nativeClick(el, { dx = 0, dy = 0, clickCount = 1 } = {}) {
      if (!el) throw new Error('h.nativeClick: no element')
      if (robust) await nextFrame()
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2 + dx
      const y = window.innerHeight - (r.top + r.height / 2 + dy)
      return invoke('h_native_input', { events: [{ kind: 'click', x, y, clickCount }] })
    },

    /** Focuses the editor input (like clicking into the text); returns whether it has focus. */
    focusEditor,

    /**
     * Inserts text into the editor at the cursor, the way an input method does
     * (synthetic). Use it for characters a US key press cannot produce.
     * @param {string} text
     */
    insertText(text) {
      if (!focusEditor()) throw new Error('h.insertText: the editor input cannot take focus')
      return document.execCommand('insertText', false, text)
    },

    /** The native window title, read from Rust. @returns {Promise<string>} */
    title: () => invoke('h_title'),

    dialogs: {
      /**
       * Queues the answer of the next fake file dialog of that kind: a path, a list of
       * paths, or null for Cancel. The stub grants picked paths like the dialog plugin.
       * @param {'open' | 'save' | 'folder'} kind
       * @param {string | string[] | null} result
       */
      queue: (kind, result) => invoke('h_queue_dialog', { kind, value: result }),
      /** Every dialog the app asked for so far (file dialogs and message boxes). */
      calls: () => rec.dialogCalls.slice(),
      /** Drops queued answers; resolves to the ones nobody used. @returns {Promise<string[]>} */
      clear: () => invoke('h_clear_dialogs'),
    },

    alert: {
      /** The front-most visible NSAlert, or null. @returns {Promise<AlertInfo | null>} */
      visible: () => invoke('h_alert_info'),
      /**
       * Waits for an NSAlert to appear. The default is generous because a loaded Mac can
       * take seconds to put the panel up, and every caller is waiting for one it expects:
       * a longer wait only lengthens the path where none arrives.
       * @param {{ timeout?: number }} [opts]
       * @returns {Promise<AlertInfo | null>}
       */
      wait: ({ timeout = 10000 } = {}) => waitFor(() => invoke('h_alert_info'), { timeout, interval: 100 }),
      /**
       * Clicks a button of the real NSAlert (alternatives: `'OK|Ok'`), waiting up to
       * `timeout` ms for it; rejects when no such button shows up.
       * @param {string} label
       * @param {{ timeout?: number }} [opts]
       * @returns {Promise<{ texts: string[], buttons: string[], clicked: string }>}
       */
      async click(label, { timeout = 10000 } = {}) {
        // An answer can end the app (Discard All on a quit): see `flushIfExiting`.
        await flushIfExiting()
        return invoke('h_alert_click', { label, timeoutMs: timeout })
      },
    },

    disk: {
      /** UTF-8 text of a file. @param {string} p @returns {Promise<string>} */
      read: (p) => invoke('h_read_disk', { path: p }),
      /**
       * Bytes as space-separated hex (`"ef bb bf 25"`).
       * @param {string} p
       * @param {number} [max] only the first `max` bytes
       * @returns {Promise<string>}
       */
      hex: (p, max) => invoke('h_hex', { path: p, max }),
      /**
       * @param {string} p
       * @param {string | { base64: string }} content
       * @returns {Promise<number>} bytes written
       */
      write: (p, content) =>
        typeof content === 'string'
          ? invoke('h_write_disk', { path: p, text: content })
          : invoke('h_write_disk', { path: p, base64: content.base64 }),
      /**
       * Sets the modification time, in seconds since the Unix epoch (default: now).
       * @param {string} p
       * @param {number} [secs]
       */
      touch: (p, secs = Date.now() / 1000) => invoke('h_touch_mtime', { path: p, secs }),
      /** @param {string} p @returns {Promise<Stat | null>} null when missing */
      async stat(p) {
        try {
          return await invoke('h_stat', { path: p })
        } catch {
          return null
        }
      },
      /**
       * Copies a file, or a folder with everything in it, creating the folders above `to`.
       * @param {string} from
       * @param {string} to
       * @returns {Promise<number>} bytes copied
       */
      copy: (from, to) => invoke('h_copy', { src: from, dst: to }),
      /**
       * Deletes a file, a link or a folder under the run folder or the app's HOME (never
       * either of them itself, never a path outside). A missing path is not an error.
       * @param {string} p
       * @param {{ recursive?: boolean }} [opts] `recursive`: a folder with its content (default: only an empty one)
       * @returns {Promise<boolean>} whether something was removed
       */
      remove: (p, { recursive = false } = {}) => invoke('h_remove', { path: p, recursive }),
      /**
       * What a folder holds, sorted by name. Links are reported as links, not followed.
       * @param {string} p
       * @returns {Promise<DirEntry[]>}
       */
      list: (p) => invoke('h_list', { path: p }),
      /**
       * A symbolic link at `link` that points to `target` (made outside the app, the way a
       * user or a CAM post would). The folders above `link` are created.
       * @param {string} target
       * @param {string} link
       */
      symlink: (target, link) => invoke('h_symlink', { target, link }),
    },

    /**
     * The system clipboard's text. A run starts with an empty clipboard and puts the owner's
     * text back when it ends (the harness does both, so a scenario never reads what was
     * copied before it and never leaves its own text behind); only text is kept, anything
     * else on the clipboard is lost for the run.
     */
    clipboard: {
      /** @returns {Promise<string>} */
      read: () => invoke('h_clipboard_read'),
      /** @param {string} text */
      write: (text) => invoke('h_clipboard_write', { text }),
      /** Empties it. */
      clear: () => invoke('h_clipboard_write', { text: null }),
    },

    /**
     * Monaco's own services, for what the test hook does not say (the number of models the
     * editor holds). They live in the editor's instantiation tree, an internal of the pinned
     * Monaco (0.55): **this is the only place a scenario touches it**, and a scenario checks
     * `service(...)` is not null so a move of the internals fails there and not silently.
     * A service is found once and kept, because a comparison removes the editor it is found
     * through. A hook that offers `modelCount()` (`window.__gedit`) is preferred.
     */
    monaco: {
      /**
       * @param {string} id the id the service was registered under, e.g. `modelService`
       * @param {string} method a method the service must have, e.g. `getModels`
       * @returns {any} the service, or null
       */
      service(id, method) {
        const known = monacoServices.get(id)
        if (known && typeof known[method] === 'function') return known
        let inst = /** @type {any} */ (/** @type {any} */ (window.__gedit?.ctx)?.editor?.editorInstance?.())?._instantiationService
        while (inst) {
          for (const [key, service] of inst._services?._entries ?? []) {
            if (String(key) === id && typeof service?.[method] === 'function') {
              monacoServices.set(id, service)
              return service
            }
          }
          inst = inst._parent
        }
        return null
      },
      /** How many text models Monaco holds right now; -1 when that cannot be read. @returns {number} */
      modelCount() {
        const hooked = /** @type {any} */ (window.__gedit)?.modelCount
        if (typeof hooked === 'function') return hooked()
        return h.monaco.service('modelService', 'getModels')?.getModels().length ?? -1
      },
    },

    /**
     * The app's own JSON files, by name, parsed — `settings.json`, `machines.json` or
     * `state.json` (M6). The harness resolves the folder the way the app does, so a
     * scenario asserts on what the app wrote without knowing where `--home` put it.
     *
     * `null` means the file is not there yet, which is a state worth asserting on after a
     * fresh start.
     *
     *     const file = await h.config.read('machines.json')
     *     assert.deepEqual(file.machines.map((m) => m.id), ['lathe-is-b'])
     *
     */
    config: {
      /**
       * @param {'settings.json' | 'machines.json' | 'state.json'} name
       * @returns {Promise<unknown | null>}
       */
      read: (name) => invoke('h_config_read', { name }),
    },

    /**
     * `<data>/recovery`, where the crash-recovery snapshots live (M7, AD-21): one
     * folder per session, each holding the `alive` heartbeat and the `<key>.txt` /
     * `<key>.json` pairs. Read what is under it with `h.disk.read` / `h.disk.hex`.
     *
     * The harness resolves it the way the app does, so a scenario can assert on what
     * survived a crash without knowing where `--home` put it.
     * @returns {Promise<string>}
     */
    recoveryDir: () => invoke('h_recovery_dir'),

    /**
     * Drops files or folders on the window: grants them like tauri-plugin-fs does and
     * emits `tauri://drag-drop`.
     * @param {string[]} paths
     * @param {{ x?: number, y?: number }} [position]
     */
    drop: (paths, { x = 0, y = 0 } = {}) => invoke('h_drop', { paths, x, y }),

    /** Pids whose command line matches (pgrep -f). @param {string} pattern @returns {Promise<number[]>} */
    pgrep: (pattern) => invoke('h_pgrep', { pattern }),

    /** Child processes of the app, as "pid ppid command" lines. @returns {Promise<string[]>} */
    children: () => invoke('h_children'),

    /**
     * A fresh copy of `tests/fixtures/<rel>` (file or folder) in the run folder; with
     * `{ from: 'runtime' }` of `tests/runtime/fixtures/<rel>`.
     * @param {string} rel
     * @param {{ from?: 'fixtures' | 'runtime' }} [opts]
     * @returns {Promise<string>} absolute path of the copy
     */
    fixture: (rel, { from } = {}) => invoke('h_fixture', { rel, from }),

    /** The app's test hook (`window.__gedit`). */
    get app() {
      const app = window.__gedit
      if (!app) throw new Error('window.__gedit is missing (not a VITE_GEDIT_TEST=1 build?)')
      return app
    },

    window: {
      /** `window.close()` from Rust, like the app's own Cmd+Q item. @param {number} [delayMs] */
      async close(delayMs = 0) {
        await flushIfExiting()
        return invoke('h_close_from_rust', { delayMs })
      },
      /** The red close button (`performClose:`). */
      async performClose() {
        await flushIfExiting()
        return invoke('h_quit', { mode: 'performclose' })
      },
      /** Cmd+Q through the main menu's key equivalent. */
      async quitKey() {
        await flushIfExiting()
        return invoke('h_quit', { mode: 'keyequiv' })
      },
      /** `[NSApp terminate:]`, the path of Dock > Quit and logout. */
      async terminate() {
        await flushIfExiting()
        return invoke('h_quit', { mode: 'terminate' })
      },
      /**
       * @returns {Promise<{ exists: boolean, active?: boolean, key?: boolean, visible?: boolean, sheet?: boolean, alerts?: number }>}
       */
      state: () => invoke('h_window_state'),

      /**
       * The size and place of the window in physical pixels, the unit of `.window-state.json`.
       * @returns {Promise<WindowGeometry>}
       */
      geometry: () => invoke('h_window_geometry'),

      /**
       * Resizes (and, with `x` and `y`, moves) the window, like a user dragging its edge;
       * the size is in logical pixels. Resolves once the window reports it, or with what it
       * reports after `timeout` ms.
       * @param {number} width
       * @param {number} height
       * @param {{ x?: number, y?: number, timeout?: number }} [opts]
       * @returns {Promise<WindowGeometry>}
       */
      async setSize(width, height, { x, y, timeout = 3000 } = {}) {
        const first = await invoke('h_window_set_size', { width, height, x, y })
        const wanted = (/** @type {WindowGeometry} */ g) => Math.abs(g.width - Math.round(width * g.scale)) <= 1 && Math.abs(g.height - Math.round(height * g.scale)) <= 1
        const landed = await waitFor(async () => {
          const g = await invoke('h_window_geometry')
          return wanted(g) ? g : null
        }, { timeout, interval: 50 })
        return landed ?? first
      },

      /**
       * Who owns the keyboard, and whether native input would reach the app
       * (`deliverable`, with a `reason` when it would not).
       * @returns {Promise<FocusState>}
       */
      focus: () => invoke('h_focus_state'),

      /**
       * Brings the app to the front and waits until it owns the keyboard. Native input
       * does this on its own; call it directly before reading something that only holds
       * from the front, or to fail early with a clear reason.
       * @param {{ timeout?: number }} [opts]
       * @returns {Promise<FocusState>} rejects with the reason, and marks the run BLOCKED
       */
      ensureFront: ({ timeout } = {}) => invoke('h_ensure_front', { timeoutMs: timeout }),
    },

    /**
     * Declares that the app is about to exit. Call it before triggering the exit; the
     * runner then counts the exit as a pass (with the expected code, or the expected
     * `signal`) and checks `files`.
     *
     * The record is handed to Rust before this resolves, and every call that can end the
     * app (`h.window.close/performClose/quitKey/terminate`, `h.nativeKeys`) hands over
     * what is queued first while an exit is expected, so a scenario neither has to wait
     * for it nor to sleep a while "to let the queue empty". Awaiting it is allowed and
     * costs one round trip.
     * @param {ExitExpectation} [expectation]
     * @returns {Promise<void>}
     */
    expectExit(expectation = {}) {
      exitExpected = { within: 10000, files: [], ...(expectation.signal ? {} : { code: 0 }), ...expectation }
      send({ kind: 'expect-exit', ...exitExpected })
      return drain()
    },

    /**
     * Kills the app with SIGKILL, the way a power cut or a force-quit does (M7).
     *
     * Nothing runs on the way out — no `RunEvent::Exit`, no destructor, no flush — so
     * whatever the next run finds on disk was already there. That is the only honest
     * test of the recovery promise; `h.window.terminate()` and friends all give the app
     * a chance to tidy up first and would pass even if nothing had been written.
     *
     * Declares the exit expectation itself, so the runner counts the kill as the
     * expected end of the run. Snapshot what you want to survive **before** calling it
     * (`h.app.ctx.recovery.flushNow()`); this promise never resolves.
     *
     * @param {Omit<ExitExpectation, 'code' | 'signal'>} [expectation] files to check after the kill
     * @returns {Promise<void>} never resolves: the process is gone before it could
     */
    async crash(expectation = {}) {
      // Set directly rather than through `h.expectExit`, so a destructured `crash`
      // still declares the expectation instead of failing on `this`.
      exitExpected = { within: 10000, files: [], ...expectation, signal: 'SIGKILL' }
      send({ kind: 'expect-exit', ...exitExpected })
      // `send` only queues, and the queue dies with the process: without this the
      // expectation never reaches the runner and the kill is reported as a scenario
      // that stopped halfway. The drain also flushes the checks made just before it.
      await drain()
      return invoke('h_crash')
    },

    /** @returns {ExitExpectation | null} */
    exitExpectation: () => exitExpected,

    /**
     * Console errors matching `pattern` are expected in this run (the app logs them on
     * purpose, e.g. for a file that cannot be opened).
     * @param {RegExp} pattern
     */
    allowErrors(pattern) {
      send({ kind: 'allow-errors', source: pattern.source, flags: pattern.flags })
    },

    /**
     * Runs `fn`, marking CSP violations it causes as expected (for probes that prove
     * the policy is enforced).
     * @param {() => unknown} fn
     * @returns {Promise<import('./recorder.js').Violation[]>} the violations it caused
     */
    async expectViolations(fn) {
      const before = rec.violations.length
      rec.expectingViolations++
      try {
        await fn()
        await sleep(300)
      } finally {
        rec.expectingViolations--
      }
      return rec.violations.slice(before)
    },

    /**
     * Calls a backend command and never throws.
     * @param {string} cmd
     * @param {Record<string, unknown> | Uint8Array} [args]
     * @param {{ headers?: Record<string, string> }} [options]
     * @returns {Promise<{ ok: true, value: any } | { ok: false, error: string }>}
     */
    async attempt(cmd, args, options) {
      try {
        return { ok: true, value: await invoke(cmd, args, options) }
      } catch (e) {
        return { ok: false, error: typeof e === 'string' ? e : String(/** @type {any} */ (e)?.message ?? e) }
      }
    },

    /**
     * Sets or (with null) removes an environment variable of the running app.
     * @param {string} name
     * @param {string | null} value
     */
    setenv: (name, value) => invoke('h_setenv', { name, value }),

    /** The native menu as text. @returns {Promise<string>} */
    menu: () => invoke('h_menu_dump'),
  }
  return h
}

/** @typedef {ReturnType<typeof createHarness>} Harness */
