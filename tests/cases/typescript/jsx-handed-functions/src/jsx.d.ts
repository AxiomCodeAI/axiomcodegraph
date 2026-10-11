// the project supplies its own JSX namespace and component base, so the case needs no framework installed
declare global {
  namespace JSX {
    type Element = unknown
    interface ElementClass { render(): unknown }
    interface ElementAttributesProperty { props: unknown }
    interface IntrinsicElements { [name: string]: unknown }
  }
}
export class Component<P> {
  props: P
  constructor(props: P) { this.props = props }
}
