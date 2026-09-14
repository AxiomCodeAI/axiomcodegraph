export namespace Outer {
  export function inner(): string {
    return "i";
  }
  export namespace Nested {
    export function deeper(): string {
      return "d";
    }
  }
  export class C {
    go(): string {
      return "g";
    }
  }
}
