// THE CALL CHAIN, AND THE CLIENT/LIBRARY BOUNDARY IT CROSSES.
//
// The scoring harness adjudicates one site at a time. This file exists for the question
// a per-site score cannot answer: from an entry point, does the chain hold together for
// four hops and does it cross into the library at the right hop?
//
//   entryPoint -> stageOne -> stageTwo -> stageThree -> @tt/named encode
//     client       client      client       client        LIBRARY
//
// Three client-to-client edges then exactly one client-to-library edge. An engine that
// classifies the boundary by the callee's NAME rather than by which IR root declares it
// gets a different answer here, and the two are distinguishable by construction.
import { encode, Sink } from '@tt/named';
import { leafFn } from '@tt/chain/chain-leaf';

export function stageThree(input: string): string {
  return encode(input);                    // THE boundary crossing: client -> library
}

export function stageTwo(input: string): string {
  return stageThree(input.trim());         // client -> client, plus a call into lib.es5
}

export function stageOne(input: string): string {
  return stageTwo(input);                  // client -> client
}

export function entryPoint(input: string): string {
  return stageOne(input);                  // client -> client
}

// RECURSION. A chain that closes on itself: an engine that walks the chain without a
// fixpoint either loops or stops one hop early.
export function countDown(n: number, sink: Sink): number {
  if (n <= 0) return sink.write('done');
  return countDown(n - 1, sink);
}

// MUTUAL RECURSION across two declarations.
export function pingPong(n: number): string {
  return n <= 0 ? 'x' : pongPing(n - 1);
}
export function pongPing(n: number): string {
  return n <= 0 ? 'y' : pingPong(n - 1);
}

// AN INDIRECT CALL through a client higher-order function. The callee at the `fn(input)`
// site is a PARAMETER, and what can run there is whatever is passed in — both of which
// are in this file and are known by construction.
export function apply(fn: (input: string) => string, input: string): string {
  return fn(input);
}

export function applyLeaf(input: string): string {
  return apply(leafFn, input);             // the argument is a LIBRARY function
}

export function applyLocal(input: string): string {
  return apply(stageThree, input);         // the argument is a CLIENT function
}

// A METHOD REFERENCE detached from its receiver, then called. The declaration is in the
// library; nothing at the call site names it.
export function detached(sink: Sink): number {
  const write = sink.write.bind(sink);
  return write('detached');
}
