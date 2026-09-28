// The shapes a component is DECLARED in, each rendered from app.tsx as a JSX tag.
// `<X/>` is an invocation of X whatever X is bound to: a function, an arrow held by
// a const, a default export, a class, or a wrapper's result around one of those.
//
// No React dependency: the wrappers are declared here with the signatures that matter.
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
export declare function lazy<P>(load: () => Promise<{ default: Fc<P> }>): Fc<P>;
export declare function makeFactory<T>(build: () => T): () => T;

export function formatName(n: string): string {
  return n.toUpperCase();
}

export function trackClick(id: string): string {
  return id;
}

// memo() around a NAMED function expression.
export const UserCard = memo(function UserCard(p: { id: string }): string {
  return formatName(p.id);
});

// forwardRef() around a function declared elsewhere, passed by name.
function FieldImpl(p: { label: string }, ref: unknown): string {
  return trackClick(p.label) + String(ref);
}
export const Field = forwardRef(FieldImpl);

// An arrow held by a typed const.
export const Badge: Fc<{ n: number }> = (p) => String(p.n);

// A default export.
export default function Avatar(p: { src: string }): string {
  return p.src;
}

// A class component: the constructor is the nameable target.
export class Panel {
  props: { title: string };
  constructor(props: { title: string }) {
    this.props = props;
  }
  render(): string {
    return this.props.title;
  }
}

export const ui = {
  Chip(p: { text: string }): string {
    return p.text;
  },
};

// CONTROL: a non-JSX wrapper. A factory's argument 0 is not what its product runs
// when called, so `factory()` must not become a call to buildDefault.
export function buildDefault(): number {
  return 1;
}
export const factory = makeFactory(buildDefault);
