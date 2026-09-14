// A CALLBACK WHOSE OWN PARAMETER IS A CALLBACK. The k-th child of the outer signature's
// FUNCTION_TYPE is another FUNCTION_TYPE rather than a named type, so resolving it as a
// named type finds nothing and the inner callback carries no type at all.
export class Payload {
  describe(): string {
    return "p";
  }
}

// THE LIBRARY-DECLARED SHAPE — `new Promise((resolve, reject) => ...)`.
export function viaExecutor(): Made<Payload> {
  return new Maker<Payload>((resolve, reject) => {
    resolve(new Payload());
    reject("no");
  });
}

// The parameter NAMES are arbitrary; nothing may key on `resolve`/`reject`.
export function viaRenamedExecutor(): Made<Payload> {
  return new Maker<Payload>((ok, fail) => {
    ok(new Payload());
    fail("no");
  });
}

// THE CLIENT-DECLARED SHAPE, so the mechanism is not specific to a library.
export type Sink = (value: Payload) => void;
export function withSink(run: (emit: Sink) => void): void {
  run(() => undefined);
}
export function viaClientCallbackOfCallback(): void {
  withSink((emit) => {
    emit(new Payload());
  });
}

// CONTROL: a callback whose parameter is a NAMED type must keep resolving through the
// clause that already existed.
export function viaNamedParam(items: Payload[]): string[] {
  return items.map((p) => p.describe());
}
