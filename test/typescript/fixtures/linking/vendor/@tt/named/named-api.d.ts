// PLAIN NAMED EXPORTS — the baseline every other form is measured against. If a call
// into this file does not land, nothing below it is worth reading.
//
// `encode` is deliberately ALSO the name of an export of @tt/collide, with a different
// parameter type, so a client that imports both makes "did the engine pick the right
// PACKAGE" a decidable question rather than a name match.
export declare function encode(input: string): string;

// A class whose interface is REOPENED by the client through module augmentation
// (see src/link-merged.ts). `write` is declared here; `flush` is declared in the
// client. A receiver of type Sink must reach both, in the two different files.
export declare class Sink {
  write(chunk: string): number;
  close(): void;
}
export interface Sink {
  readonly name: string;
}
