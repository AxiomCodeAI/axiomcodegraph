// This package exists ONLY inside the pnpm store. It is never hoisted to the top
// level of node_modules, so a resolver that looks only at the project's own
// node_modules roots cannot find it — which is how a transitive dependency silently
// fails to stage, and every call into it goes unresolved.
export declare function deepCall(tag: string): string;

// A VARIABLE whose type carries the call signature, rather than a function. This is
// how a fluent API publishes a callable, and it needs a different rule from a plain
// function declaration: there is no method row to bind, the callable is a member of
// the variable's type.
export interface DeepStatic {
  (actual: number): string;
  extend(name: string): void;
}
export declare const deepStatic: DeepStatic;
