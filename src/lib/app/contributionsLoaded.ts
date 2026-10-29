// The signal "every contribution has activated" (WY-CODE-1), apart from the loader so that a
// contribution can wait on it without importing `app/contributions.ts`, which globs every
// contribution (itself included). `app/contributions.ts` marks it and re-exports it.

let markLoaded: () => void = () => {};

/**
 * Settles when `registerContributions` has activated every module (also when some failed).
 * For code that must not run before the claims of the others are made, whatever the file-name
 * order: files handed over by the system wait on it (`contrib/openRequests.ts`).
 */
export const contributionsLoaded: Promise<void> = new Promise<void>((resolve) => {
  markLoaded = resolve;
});

/** Settles `contributionsLoaded`. Called from a `finally` in `registerContributions`. */
export function markContributionsLoaded(): void {
  markLoaded();
}
