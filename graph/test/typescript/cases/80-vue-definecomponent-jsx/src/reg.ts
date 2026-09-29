import { defineComponent } from "../lib/vue";
import _Button from "./button";

export function leafLocal(): number {
  return 9;
}

// the registration idiom: a component library re-exports each component through an
// installer that returns its argument
export function withInstall<T>(component: T): T {
  return component;
}

// …of a component default-imported from its own module
export const Button = withInstall(_Button);

// …and of one defined in this module
const _Local = defineComponent({
  setup() {
    leafLocal();
    return () => "local";
  },
});
export const Local = withInstall(_Local);
