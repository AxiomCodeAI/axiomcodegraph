import { Outer } from "./ns";

// A namespace declared BESIDE its use, which is how a file groups helpers.
export namespace Local {
  export function f(): string {
    return "l";
  }
  export namespace Deep {
    export function g(): string {
      return "g";
    }
  }
}

export function sameModule(): string {
  return Local.f();
}
export function sameModuleDepth(): string {
  return Local.Deep.g();
}

// CONTROLS: through an import, which resolved before.
export function viaImport(): string {
  return Outer.inner();
}
export function viaImportDepth(): string {
  return Outer.Nested.deeper();
}
export function viaImportClass(): string {
  return new Outer.C().go();
}
