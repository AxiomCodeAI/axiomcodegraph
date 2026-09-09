// TWO FORMS OF THE SAME CONSTRUCT, and the parser treats them differently.
//
// A decorator is a function the runtime invokes with (target, key, descriptor), and the
// compiler resolves the application in both forms. The parser emits a ts_call_site for
// the FACTORY form only; the bare form gets a ts_decorator row with kind = MARKER and no
// call site at all, so the application is absent from the IR and cannot be scored. See
// parser#82 — re-priced there on 15 sites inside one repository, which is not what it
// costs on a codebase that decorates most public methods (191 sites, 89% of one
// project's whole conservation loss).
export function guarded(_t: unknown, _k: string, d: PropertyDescriptor): PropertyDescriptor {
  return d;
}

export function timed(): MethodDecorator {
  return (_t, _k, d) => d;
}

export class Svc {
  // BARE — the gap. No call site of any kind is emitted for this.
  @guarded
  a(): string {
    return "a";
  }

  // THE CONTROL: the factory form, which does emit a call site for the factory call.
  @timed()
  b(): string {
    return "b";
  }
}
