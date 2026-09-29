import { defineComponent } from "../lib/vue";
import Card from "./card";
import { Child, Panel, FnForm, NuxtCard, Store } from "./parts";
import { Button, Local } from "./reg";

function helper(): number {
  return 42;
}

export const App = defineComponent({
  setup() {
    const onPing = () => helper();
    return () => (
      <div>
        <Card />
        <Child msg="x" onPing={onPing} />
        <Panel />
        <FnForm />
        <NuxtCard />
        <Store />
        <Button />
        <Local />
      </div>
    );
  },
});
