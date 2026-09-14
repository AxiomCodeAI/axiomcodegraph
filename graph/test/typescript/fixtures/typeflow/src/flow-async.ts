// THE RECEIVER IS BEHIND A PROMISE. Every call below needs the promise unwrapped first,
// and the three ways of unwrapping one — await, `.then`, and a for-await loop — are three
// different rules that an engine can implement one of and appear to handle all.
import { Alpha, Beta, Gamma } from '@f/shapes';

export async function makeAlpha(): Promise<Alpha> {
  return new Gamma();
}

export async function viaAwait(): Promise<string> {
  const a = await makeAlpha();
  return a.tag();                              // Alpha.tag  (declared type wins over the Gamma value)
}

// The callback's parameter is typed by `Promise<Alpha>.then`, so the receiver comes from
// a standard-library signature with the type argument substituted in.
export function viaThen(): Promise<string> {
  return makeAlpha().then((a) => a.tag());     // Alpha.tag
}

// Chained: the second `.then` sees the FIRST callback's return type, not the original.
export function viaChainedThen(): Promise<number> {
  return makeAlpha()
    .then((a) => new Beta())
    .then((b) => b.only_beta());               // Beta.only_beta
}

// An await INSIDE the argument list of another call: the receiver of the outer call is
// produced by the inner await.
export async function awaitInArgument(): Promise<string> {
  return (await makeAlpha()).tag();            // Alpha.tag
}

// `Promise.all` — the result is a TUPLE of unwrapped types, and the two elements have
// different types. An engine that unwraps to a single element type gets one of them wrong.
export async function viaPromiseAll(): Promise<string> {
  const [a, b] = await Promise.all([makeAlpha(), Promise.resolve(new Beta())]);
  return a.tag() + b.tag();                    // Alpha.tag, Beta.tag
}

// An ASYNC GENERATOR consumed by for-await: the loop variable's type is the generator's
// YIELD type, two type arguments deep.
export async function* streamAlphas(): AsyncGenerator<Alpha> {
  yield new Gamma();
}

export async function viaForAwait(): Promise<string> {
  let out = '';
  for await (const a of streamAlphas()) {
    out += a.tag();                            // Alpha.tag
  }
  return out;
}

// A plain generator and a for-of loop — the synchronous twin of the case above.
export function* streamBetas(): Generator<Beta> {
  yield new Beta();
}

export function viaForOf(): string {
  let out = '';
  for (const b of streamBetas()) {
    out += b.tag();                            // Beta.tag
  }
  return out;
}
