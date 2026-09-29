// The Vue entry points that matter, declared with their shapes. No Vue dependency.
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

export interface ComponentOptions {
  name?: string;
  props?: Record<string, unknown>;
  setup?: (props: any) => unknown;
  render?: () => string;
}
// A constructor type, as Vue's own DefineComponent is: nothing here says what renders.
export interface Component {
  new (...args: any[]): { props: any };
}
export declare function defineComponent(options: ComponentOptions): Component;
export declare function defineComponent(setup: (props: any) => () => string): Component;
export declare function defineNuxtComponent(options: ComponentOptions): Component;

// NOT a component definer: it takes an options-shaped object and returns something else.
export declare function makeStore(options: ComponentOptions): Component;
