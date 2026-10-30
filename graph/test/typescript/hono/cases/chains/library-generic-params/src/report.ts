import { Role, Wrapper, Ledger } from './model'

export function describeRoles(ledger: Ledger) {
  return ledger.roles().map((r) => r.toJSON())
}

export function topRank(ledger: Ledger) {
  return ledger.roles().reduce((acc, r) => Math.max(acc, r.rank()), 0)
}

export async function latestName(ledger: Ledger) {
  return ledger.latest().then((role) => role.toJSON())
}

export function staticProviders(pairs: Array<[string, Wrapper]>) {
  const [, first] = pairs.shift()!
  const out = [first.isStatic()]
  for (const [, w] of Object.entries(Object.fromEntries(pairs))) out.push(w.isStatic())
  return out
}

export function byName(index: Map<string, Role>) {
  const names: number[] = []
  index.forEach((role) => {
    names.push(role.rank())
  })
  return names
}

export function makePairs(): Array<[string, Wrapper]> {
  return [['a', new Wrapper('static-a')], ['b', new Wrapper('dyn-b')]]
}

export function makeIndex() {
  return new Map<string, Role>([['admin', new Role('admin')]])
}
