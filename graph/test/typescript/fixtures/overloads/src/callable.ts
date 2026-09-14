// A CALLABLE INTERFACE with overloaded call signatures, and a CONSTRUCTABLE one with
// overloaded construct signatures. This is how a published package presents a callable
// API, and the signature the compiler picks is a member of a type rather than a
// function declaration.

export interface Formatter {
  (value: number): string;
  (value: number, digits: number): string;
  (value: string, upper: boolean): string;
}

export interface BoxConstructor {
  new (): Box;
  new (initial: string): Box;
}

export interface Box {
  readonly value: string;
}

export const format: Formatter = ((value: number | string, arg?: number | boolean) => {
  if (typeof value === 'string') return arg === true ? value.toUpperCase() : value;
  return typeof arg === 'number' ? value.toFixed(arg) : String(value);
}) as Formatter;

class BoxImpl implements Box {
  readonly value: string;
  constructor(initial = '') {
    this.value = initial;
  }
}

export const Box: BoxConstructor = BoxImpl as unknown as BoxConstructor;
