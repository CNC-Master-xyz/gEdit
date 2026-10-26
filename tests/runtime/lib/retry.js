// Whether `suite.sh` may run a failed scenario a second time: the suite's own switch (`--no-retry`, off with
// `GEDIT_RH_ROBUST=0`) and the scenario's own declaration. A scenario that declares `retry: false` is never run
// again, whatever the suite says: `p4-perf` is three to five runs of minutes each on 300,000 lines, and a second
// run of the same cost after a failure that is a regression would only double the time of the job.
//
// This module has no imports: the suite (Node) reads it and a unit test drives it.

/**
 * @param {boolean} suiteRetries the suite's switch
 * @param {import('./index.js').ScenarioOptions | undefined} options the scenario's options (`scenario(name, options, fn)`)
 * @returns {boolean}
 */
export function mayRetry(suiteRetries, options) {
  return suiteRetries && options?.retry !== false
}

/**
 * Whether a run that came back BLOCKED may be run once more (T197). The harness cannot do
 * anything about a locked screen, so that block is final; a block with the screen unlocked is a
 * hiccup of the machine (the main thread did not answer an input in time, which a shared CI runner
 * does now and then: `m0-trusted` twice in a few runs) and is retried once like a failure. A block
 * a scenario inherits from a predecessor that writes its HOME (`where: 'suite'`) is not its own to
 * clear.
 * @param {{ status: string, screenLocked?: boolean, blocked?: { where?: string }[] }} result one scenario's result
 * @returns {boolean}
 */
export function isTransientBlock(result) {
  return result.status === 'blocked' && result.screenLocked !== true && !(result.blocked ?? []).some((b) => b.where === 'suite')
}

/**
 * Turns the result of a numbered scenario (`…-2`) that failed into a blocked one when the scenario
 * that writes its HOME (`…-1`) was blocked: what `…-2` reports is that block, not the app. It
 * is decided **before** the result is printed (T194): the first line said FAIL and a second one
 * said it was not, which reads like two verdicts.
 * @template {{ status: string, blocked: { reason: string, where?: string }[] }} R
 * @param {R} result changed in place
 * @param {string | undefined} blocker the predecessor that was blocked, if any
 * @returns {R}
 */
export function inheritBlock(result, blocker) {
  if (result.status === 'fail' && blocker) {
    result.status = 'blocked'
    result.blocked.push({ reason: `${blocker}, which writes its HOME, was blocked`, where: 'suite' })
  }
  return result
}
