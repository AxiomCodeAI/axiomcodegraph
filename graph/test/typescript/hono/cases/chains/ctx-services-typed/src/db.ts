// census: ctx_di (SPEC R18; call-chain break class 1, "a service read out of the framework context")
// A request chain handler -> service -> repository -> db, where the handler reaches the service ONLY through the
// framework context: `c.get(k)`, `c.var.k`, a destructured `c.get(k)`, a `const x = c.var.k`, with the key's type
// declared by each Env form (inline generic, type alias, interface, createFactory<Env>, MiddlewareHandler<Env>,
// Context<Env> parameter).
export class Db {
  query(sql: string): string[] {
    return [sql]
  }
}
