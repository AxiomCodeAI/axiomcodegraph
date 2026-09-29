import { defineComponent } from "../lib/vue";
import { Child } from "./parts";

export function leafCard(): number {
  return 7;
}

// the module's default export, rendered through a default import
export default defineComponent({
  name: "Card",
  render() {
    leafCard();
    return <Child msg="in card" />;
  },
});
