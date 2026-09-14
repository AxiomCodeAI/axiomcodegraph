import type { Handler } from '@d/handler';

// NOMINAL conformance: both classes say `implements Handler`, so the inheritance graph
// alone reaches them from a Handler-typed receiver.
export class UpperHandler implements Handler {
  handle(input: string): number {
    return input.toUpperCase().length;
  }
}

export class LowerHandler implements Handler {
  handle(input: string): number {
    return input.toLowerCase().length;
  }
}

// Declared but never constructed anywhere — inside CHA, outside RTA. A fan that
// cannot tell the two apart is strictly less useful than one that can.
export class NeverBuiltHandler implements Handler {
  handle(input: string): number {
    return input.length * 2;
  }
}
