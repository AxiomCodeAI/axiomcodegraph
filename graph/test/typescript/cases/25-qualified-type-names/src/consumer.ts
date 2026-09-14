import { geo } from "./shapes";

// ONE hop: the annotation is `geo.Point`, so the receiver's type — and therefore
// the target of `move` — is reachable only by walking the dotted name.
export function slide(p: geo.Point): string {
  return p.move(1);
}

// TWO hops through a nested namespace.
export function pack(b: geo.deep.Box): string {
  return b.fit(new geo.Origin());
}

export function drive(): string {
  // A local whose DECLARED type is dotted; the call on it is a member lookup that
  // only resolves if the walk produced the interface.
  const impl: geo.deep.Box = new geo.deep.Impl();
  const o: geo.Point = new geo.Origin();
  return slide(o) + pack(impl) + impl.fit(o);
}

// THREE hops, and through a namespace IMPORT qualifier rather than a namespace
// declaration — the separate `qualified_name_binds` rule that reads the module's
// export table instead of namespace_member.
import * as shapes from "./shapes";

export function viaQualifier(p: shapes.geo.Point): string {
  return p.move(2);
}
