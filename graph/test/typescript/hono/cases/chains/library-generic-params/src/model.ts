// census: callback_generic (SPEC R19; call-chain break class 3, "type through a library generic")
// A callback parameter or a destructured element whose type comes ONLY through a library or builtin generic:
// Array.map / forEach / filter / reduce callbacks, Promise.then, Map.forEach, a tuple taken from Array.shift()
// and Object.entries, and a Hono validator hook. Calls on them resolve to the project methods.
export class Role {
  name: string
  constructor(name: string) {
    this.name = name
  }
  toJSON() {
    return { role: this.name }
  }
  rank() {
    return this.name.length
  }
}

export class Wrapper {
  label: string
  constructor(label: string) {
    this.label = label
  }
  isStatic() {
    return this.label.startsWith('static')
  }
}

export class Ledger {
  entries: Role[]
  constructor() {
    this.entries = [new Role('admin'), new Role('viewer')]
  }
  roles() {
    return this.entries
  }
  async latest(): Promise<Role> {
    return this.entries[0]
  }
}
