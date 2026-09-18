export class Util {
  static inSorted(needle: string, haystack: readonly string[]): boolean {
    return haystack.includes(needle);
  }
}

export class Wide extends Util {
  static other(): number { return 1; }
}

export function plain(x: number): number { return x + 1; }
