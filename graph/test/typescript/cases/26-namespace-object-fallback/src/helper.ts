// A namespace whose exports are function VALUES bound to names — the ordinary way a
// file groups helpers, and the shape that does not register as a callable member (#229).
export namespace text {
  // Named like an Object.prototype member, ON PURPOSE.
  export const toString = (m: string): string => m;
  // Not named like one.
  export const unique = (m: string): string => m;
}

// THE CONTROL. This namespace declares no `toString`, so `plain.toString()` really is
// Object.prototype.toString and the compiler resolves it there. Suppressing the Object
// fallback for namespace receivers wholesale would turn this CORRECT answer into a
// miss, which is why the fix keys on whether the scope declares the name and not on
// whether the receiver is a namespace.
export namespace plain {
  export const other = (m: string): string => m;
}
