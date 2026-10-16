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
