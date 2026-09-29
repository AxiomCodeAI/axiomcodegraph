// TWO FORMS OF THE SAME CONSTRUCT, and both are calls.
//
// A decorator is a function the runtime invokes with (target, key, descriptor), and the
// compiler resolves the application in both forms. The FACTORY form is a CallExpression
// and always had a call site; the BARE form is only a name, and until #233 it had no call
// site at all, so the application was absent from the IR. On a codebase that decorates
// most public methods that was 191 sites, 89% of one project's whole conservation loss.
export function guarded(_t: unknown, _k: string, d: PropertyDescriptor): PropertyDescriptor {
  return d;
}

export function timed(): MethodDecorator {
  return (_t, _k, d) => d;
}

export function sealed(ctor: Function): void {
  Object.seal(ctor);
}

export class Guards {
  static disposed(_t: unknown, _k: string, d: PropertyDescriptor): PropertyDescriptor {
    return d;
  }
}

@sealed
export class Svc {
  // BARE, a name: the application is a call to `guarded`.
  @guarded
  a(): string {
    return "a";
  }

  // THE CONTROL: the factory form. ONE call site, for `timed()`; the name inside it is
  // that call's callee and must not become a second call.
  @timed()
  b(): string {
    return "b";
  }

  // BARE, a member of a class: `Guards.disposed` is called, not read.
  @Guards.disposed
  c(): string {
    return "c";
  }

  // BARE, parenthesised: the parentheses are punctuation, still one call.
  @(guarded)
  d(): string {
    return "d";
  }
}

// THE CONTROL: the same name outside a decorator is a reference, not a call.
export const alias = guarded;
