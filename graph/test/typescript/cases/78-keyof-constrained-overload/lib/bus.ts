// The declarations live in the case's LIBRARY, parsed separately and handed to the engine
// with --library. Every overload pair here is ONE member with two signatures, so the
// parser gives both the same declarationGroupKey and the group rules can fire (#334).
export interface OpenEvent { at: number; }
export interface CloseEvent { code: number; }
export interface EventMap { open: OpenEvent; close: CloseEvent; }
export interface Handlers { start(): void; stop(): void; }

export interface Bus {
  // A typed map's keys are its FIELDS.
  emit<K extends keyof EventMap>(type: K): EventMap[K];
  emit(type: string): unknown;
  // …and its METHODS are keys too.
  run<K extends keyof Handlers>(name: K): void;
  run(name: string): void;
  // Control: the WIDENING signature is declared first, so it is the first applicable
  // one for any string and the compiler takes it even for a key.
  pick(type: string): void;
  pick<K extends keyof EventMap>(type: K): void;
}
