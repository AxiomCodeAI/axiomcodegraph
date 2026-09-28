// Wrappers, loaders and ordinary factories, declared with the signatures that matter.
// No React dependency.
declare global {
  namespace JSX {
    type Element = string;
    interface ElementAttributesProperty {
      props: unknown;
    }
    interface IntrinsicElements {
      [name: string]: unknown;
    }
  }
}

export type Fc<P> = (props: P) => string;
export declare function memo<P>(component: Fc<P>): Fc<P>;
export declare function observer<P>(component: Fc<P>): Fc<P>;
export declare function lazy(load: () => Promise<{ default: Fc<any> }>): Fc<any>;
export declare function dynamic(load: () => Promise<Fc<any> | { default: Fc<any> }>): Fc<any>;

// NOT component wrappers: what they return is not argument 0.
export function makeThing(f: () => number): Fc<{}> {
  f();
  return () => "thing";
}
export function useMemoLike<T>(f: () => T, deps: unknown[]): T {
  return f();
}
