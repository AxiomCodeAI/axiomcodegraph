// Each call reaches a LIBRARY overload set with an argument the engine can only type
// because of a recent improvement. If a typing change ever prunes the true signature
// again, it fails here rather than 1,045 times on remeda.
import { tag, each, shape, widen, Store, Row, Cell } from "../lib/api";

// The argument's type comes from an UNANNOTATED return — return inference.
function makeCount() {
  return 42;
}
function makeLabel() {
  return 'label';
}

export function viaInferredReturn(): string[] {
  return [
    tag(makeCount()),                    // tag #1 (number)  NON-FIRST
    tag(makeLabel()),                    // tag #2 (string)  NON-FIRST
  ];
}

// The arrow's parameter type comes from the library signature — contextual typing.
export function viaContextualCallback(rows: readonly Row[]): number {
  return each(rows, (r) => {
    void r.id;                           // r is Row, from each's own signature
  });
}

export function viaArityOnly(rows: readonly Row[]): number {
  return each(rows);                     // each #0, arity 1
}

// The argument is typed through a mapped utility type.
export function viaMappedType(c: Readonly<Cell>): string {
  return shape(c);                       // shape #0 (Cell)
}

export function viaRequired(r: Required<Row>): number {
  return shape(r);                       // shape #1 (Row)  NON-FIRST
}

// A constrained type variable meeting a concrete sibling — the regression pair.
export function viaConstrained<T extends Row>(t: T): T {
  return widen(t);                       // widen #0 (T extends Row)
}

export function viaConcreteSibling(s: string): string {
  return widen(s);                       // widen #1 (string)  NON-FIRST
}

// An overloaded METHOD on a library class, reached through the receiver.
export function viaReceiver(st: Store, r: Row, c: Cell): void {
  st.put('a', r);                        // put #0 (Row)
  st.put('b', c);                        // put #1 (Cell)  NON-FIRST
}
