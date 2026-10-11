import { defineComponent } from "vue";
import { makeStore } from "store-kit";
import DefVue from "./def";

export function leaf() { return 1; }
export function renderLeaf() { return 2; }
export function fnLeaf() { return 3; }
export function bothLeaf() { return 4; }
export function storeLeaf() { return 5; }

// A tag bound to a Vue definer renders the options object's setup…
export const SetupVue = defineComponent({ setup() { leaf(); return () => "v"; } });
// …or its render when there is no setup…
export const RenderVue = defineComponent({ render() { renderLeaf(); return "r"; } });
// …or, in the function form, argument 0 itself.
export const FnVue = defineComponent((props) => { fnLeaf(); return () => "f"; });
// Setup and render both: setup is what the tag invokes; render is reached from it.
export const BothVue = defineComponent({ setup() { bothLeaf(); return () => "b"; }, render() { return "x"; } });

// CONTROL: the same options object handed to a call that is not a definer.
export const Store = makeStore({ setup() { storeLeaf(); return () => "s"; } });

export function App() {
  return (
    <div>
      <SetupVue />
      <RenderVue />
      <FnVue />
      <BothVue />
      <DefVue />
      <Store />
    </div>
  );
}
