// STRUCTURAL conformance: no `implements` clause anywhere in this file. `tsc` accepts
// both of these wherever a `Handler` or a `Probe` is required, and the inheritance
// graph says nothing at all about them. This is the case a Java-shaped CHA cannot see.
export class SilentHandler {
  handle(input: string): number {
    return input.trim().length;
  }
}

export class Ruler {
  measure(): number {
    return 42;
  }
}

export class Caliper {
  measure(): number {
    return 7;
  }
}
