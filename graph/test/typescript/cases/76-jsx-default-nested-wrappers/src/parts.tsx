// Wrappers and loaders, declared with the signatures that matter. No React dependency.
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
export declare function forwardRef<P>(render: (props: P, ref: unknown) => string): Fc<P>;
export declare function lazy(load: () => Promise<{ default: Fc<any> }>): Fc<any>;

// NOT a component wrapper: what it returns is not argument 0.
export function pickOther(c: Fc<{}>): Fc<{}> {
  return () => String(c === undefined);
}

export function leafA(): number {
  return 1;
}
export function leafB(): number {
  return 2;
}
export function DefaultMemoInner(): string {
  return String(leafA());
}
export function PickedInner(): string {
  return "picked";
}
export function NestedPickedInner(): string {
  return "nested-picked";
}
export const MemoFwd = memo(forwardRef(function MemoFwdInner(p: {}, ref: unknown): string {
  return String(leafB());
}));
