// A string-literal-typed overload beside a `string` fallback is how event-emitter
// typings declare one signature per event. TypeScript tries these SPECIALIZED
// signatures FIRST, whatever order they are declared in, so both classes below must
// select the literal signature for a `"close"` argument.
export class LiteralFirst {
  on(event: "close", listener: (hadError: boolean) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  on(_event: string, _listener: (...args: any[]) => void): this { return this; }
}

// The SAME signatures, declared the other way round. This is the half a declaration-order
// tie-break cannot get right, and the half that stayed wrong when only the literal
// argument was made to match concretely: both signatures match a literal at position 0,
// so specificity has to prefer the specialized one outright.
export class StringFirst {
  on(event: string, listener: (...args: unknown[]) => void): this;
  on(event: "close", listener: (hadError: boolean) => void): this;
  on(_event: string, _listener: (...args: any[]) => void): this { return this; }
}

export function use(a: LiteralFirst, b: StringFirst): void {
  a.on("close", hadError => {});   // literal signature, declared first
  b.on("close", hadError => {});   // literal signature, declared SECOND
  a.on("other", () => {});         // control: no literal matches, the fallback is right
}
