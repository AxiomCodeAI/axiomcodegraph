export class Bag {
  items: string[] = [];
  add(item: string): void { this.items.push(item); }
}

export class Explicit {
  constructor() {}
}

// A subclass with no constructor runs the nearest DECLARED base constructor.
export class Named extends Explicit {
  label = 'n';
}

// No class in this chain declares one: the root's implicit constructor runs.
export class Tagged extends Bag {
  tag = 't';
}

export function make(): Bag {
  const bag = new Bag();
  bag.add('x');
  return bag;
}

export function make2(): Explicit {
  return new Explicit();
}

export function make3(): Named {
  return new Named();
}

export function make4(): Tagged {
  return new Tagged();
}
