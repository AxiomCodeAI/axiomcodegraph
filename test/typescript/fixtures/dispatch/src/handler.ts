// The interface every dispatch question below is asked about. It has no
// implementation of its own, so a call on a `Handler`-typed receiver resolves — for
// the compiler — to the SIGNATURE here. Which BODY runs is the dispatch question.
export interface Handler {
  handle(input: string): number;
}

// A second interface that NOTHING declares itself an implementation of. Every class
// that satisfies it does so structurally, which is the 60.4% case.
export interface Probe {
  measure(): number;
}
