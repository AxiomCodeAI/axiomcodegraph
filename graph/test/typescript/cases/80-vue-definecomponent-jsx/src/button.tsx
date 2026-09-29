import { defineComponent } from "../lib/vue";

export function leafButton(): number {
  return 8;
}

export default defineComponent({
  name: "Button",
  setup() {
    return () => <b>{leafButton()}</b>;
  },
});
