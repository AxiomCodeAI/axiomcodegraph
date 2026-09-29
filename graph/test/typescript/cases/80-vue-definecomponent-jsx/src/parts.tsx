import { defineComponent, defineNuxtComponent, makeStore } from "../lib/vue";

export function leafSetup(): number {
  return 1;
}
export function leafRendered(): number {
  return 2;
}
export function leafRender(): number {
  return 3;
}
export function leafFn(): number {
  return 4;
}
export function leafNuxt(): number {
  return 5;
}
export function leafStore(): number {
  return 6;
}

// setup() returns the render function
export const Child = defineComponent({
  props: { msg: String },
  setup(props) {
    leafSetup();
    return () => String(leafRendered());
  },
});

// the render option, no setup
export const Panel = defineComponent({
  name: "Panel",
  render() {
    return String(leafRender());
  },
});

// the function form: the function IS setup
export const FnForm = defineComponent((props) => () => String(leafFn()));

export const NuxtCard = defineNuxtComponent({
  setup() {
    return () => String(leafNuxt());
  },
});

// CONTROL: the same object handed to another function is not a component
export const Store = makeStore({
  setup() {
    return () => String(leafStore());
  },
});
