// census: ctx_di, negative (SPEC R18-R21 negative controls)
// Two unrelated classes each declare `save()`. A call on a receiver whose type (or, untyped, whose c.set value) is
// one of them reaches ONLY that class's method: an edge to the other same-named method is a false edge. The
// positive control: a call through an interface both implement reaches both.
export interface Saver {
  save(v: string): string
}

export class UserStore implements Saver {
  save(v: string) {
    return `user ${v}`
  }
}

export class AuditLog implements Saver {
  save(v: string) {
    return `audit ${v}`
  }
}

export function saveAll(savers: Saver[], v: string) {
  return savers.map((s) => s.save(v))
}
