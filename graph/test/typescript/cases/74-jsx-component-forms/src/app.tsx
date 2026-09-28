import Avatar, { Badge, Field, lazy, Panel, UserCard, factory, ui } from "./parts";

// lazy() around a dynamic import: the component is the module's default export.
const Settings = lazy(() => import("./settings"));

export function App(): string {
  return (
    <section>
      <UserCard id="1" />
      <Field label="name" />
      <Badge n={2} />
      <Avatar src="x" />
      <Panel title="t" />
      <Settings />
      <ui.Chip text="c" />
      <div>plain</div>
    </section>
  );
}

// CONTROL: the factory product is called, never its argument.
export function useFactory(): unknown {
  return factory();
}
