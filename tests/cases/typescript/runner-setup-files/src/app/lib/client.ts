let notify: (fn: () => void) => void = (fn) => fn()

// a set-up file calls this at module level, before any test of the project runs
export function setNotifyFunction(fn: (cb: () => void) => void): void {
  notify = fn
}

export function schedule(cb: () => void): void {
  notify(cb)
}

// control: called only by a helper no configuration names and no test imports
export function unusedHelper(): number {
  return 1
}
