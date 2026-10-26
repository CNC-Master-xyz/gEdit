// What the harness scripts need from the app's own types, without pulling the app's source
// into their type check (that is `npm run check`'s job). `lib/api.js` runs in the page and is
// reached from here through `lib/retry.js`. The `.d.mts` name keeps `npm run check` (which reads
// every `tests/**/*.ts`) from taking these stand-ins for the real declarations.

declare module '$lib/app/testHook' {
  export type GeditTestHook = any
}

interface Window {
  __gedit?: any
}
