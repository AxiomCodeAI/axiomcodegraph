// NAMED IMPORTS, AND A NAME THAT EXISTS IN TWO PACKAGES.
//
// `encode` is exported by @tt/named (string -> string) and by @tt/collide
// (number -> number). Both are imported here, one of them renamed. Every call below has
// exactly one right declaration and one plausible wrong one in another package, so a
// link that matches on the callee's NAME scores 50% here by construction and cannot
// tell which half it got.
import { encode, Sink } from '@tt/named';
import { encode as encodeNumber, Sink as NumberSink } from '@tt/collide';

export function encodeText(input: string): string {
  return encode(input);                    // -> named-api.d.ts  encode(string)
}

export function encodeCount(input: number): number {
  return encodeNumber(input);              // -> collide-api.d.ts  encode(number)
}

// Two receivers whose classes share a member name and share nothing else. Member lookup
// that is not anchored to the receiver's resolved TYPE crosses these two.
export function writeText(sink: Sink, chunk: string): number {
  return sink.write(chunk);                // -> named-api.d.ts  Sink.write
}

export function writeCount(sink: NumberSink, chunk: number): number {
  return sink.write(chunk);                // -> collide-api.d.ts  Sink.write
}

// A constructed library class, then a call on it: `new` has to produce a receiver type
// before the member lookup can happen at all.
export function closeFresh(): void {
  const sink = new Sink();
  sink.close();                            // -> named-api.d.ts  Sink.close
}
