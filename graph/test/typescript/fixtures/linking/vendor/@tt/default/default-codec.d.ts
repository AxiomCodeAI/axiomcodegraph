// DEFAULT EXPORT. The imported name at the call site is chosen by the CLIENT and
// appears nowhere in this file, so an engine that links by name has nothing to match
// on: the only path from `Codec.transform` back to here runs through the default
// export binding.
export default class Codec {
  transform(input: string): string;
  static of(seed: string): Codec;
}

// A named export alongside the default, so "the module has a default" cannot be used
// as a shortcut for "every import of this module is the default".
export declare function describeCodec(c: Codec): string;
