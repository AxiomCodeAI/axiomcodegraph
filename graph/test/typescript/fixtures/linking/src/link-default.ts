// DEFAULT EXPORT AND STATIC MEMBERS.
//
// The name `Codec` is chosen HERE. It appears nowhere in the library, so the only path
// from these call sites to `default-codec.d.ts` is the default-export binding — a link
// keyed on the identifier at the call site has nothing to match.
import Codec, { describeCodec } from '@tt/default';

export function transformOnce(input: string): string {
  const codec = new Codec();
  return codec.transform(input);           // -> default-codec.d.ts  Codec.transform
}

// A STATIC on a default-exported class: the receiver is the class itself rather than an
// instance, and the member is in the static declaration space.
export function transformViaStatic(input: string): string {
  return Codec.of('seed').transform(input); // -> Codec.of, then Codec.transform
}

export function describe(): string {
  return describeCodec(new Codec());       // -> default-codec.d.ts  describeCodec
}
