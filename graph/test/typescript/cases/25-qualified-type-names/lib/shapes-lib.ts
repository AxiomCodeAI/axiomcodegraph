// The same shape on the LIBRARY side: a dotted type reference that crosses the
// client/library boundary.
export namespace vend {
  export interface Handle {
    open(): string;
  }
  export class Std implements Handle {
    open(): string {
      return "std";
    }
  }
  export namespace inner {
    export interface Deep {
      read(h: vend.Handle): string;
    }
  }
}
