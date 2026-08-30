// The "library": parsed separately, handed to the engine as --library IR.
export abstract class Drawable {
  abstract draw(): string;
  outline(): string {
    return "outline";
  }
}
export class Palette {
  static default(): Palette {
    return new Palette();
  }
  pick(n: number): string {
    return "c" + n;
  }
}
