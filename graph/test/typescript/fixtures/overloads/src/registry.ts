import type { Circle, Square } from '@fixture/shapes';

// Overloaded METHODS on a class, and an overloaded CONSTRUCTOR. Both are called from
// other files, so resolving them exercises the import path as well as the overload set.
export class Registry {
  private readonly items: string[] = [];

  constructor();
  constructor(seed: string);
  constructor(seed: readonly string[]);
  constructor(seed?: string | readonly string[]) {
    if (typeof seed === 'string') this.items.push(seed);
    else if (seed) this.items.push(...seed);
  }

  add(item: string): this;
  add(item: number): this;
  add(item: Circle): this;
  add(item: Square): this;
  add(item: string | number | Circle | Square): this {
    this.items.push(typeof item === 'object' ? item.kind : String(item));
    return this;
  }

  size(): number {
    return this.items.length;
  }
}
