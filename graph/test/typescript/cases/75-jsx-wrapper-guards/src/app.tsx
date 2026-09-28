import { dynamic, lazy, makeThing, memo, observer, useMemoLike, type Fc } from "./parts";
import { Button } from "./ui/Button";

export function factoryArgBody(): number {
  return 3;
}
export function memoBody(): number {
  return 4;
}
function ObservedImpl(): string {
  return "observed";
}

// A loader that projects a NAMED export: the component is NamedHeavy, never Heavy.
const LazyNamed = lazy(() => import("./heavy").then((m) => ({ default: m.NamedHeavy })));
const DynNamed = dynamic(() => import("./heavy").then((m) => m.NamedHeavy));
// …and the same projections written with a block body, where the returned value is a row.
const LazyBlock = lazy(() => import("./heavy").then((m) => { return { default: m.NamedHeavy }; }));
const DynAwait = dynamic(async () => { const m = await import("./heavy"); return m.NamedHeavy; });
// CONTROL: a loader returning the module itself renders its default export.
const LazyDefault = lazy(() => import("./heavy"));
const DynDefault = dynamic(() => import("./heavy"));

// NOT wrappers: argument 0 is not what the product renders.
const Thing = makeThing(() => factoryArgBody());
const Made = useMemoLike(() => function MadeInner(): string { return "made"; }, []);

// CONTROL: real wrappers still reach their argument.
const Memoed = memo(function MemoInner(): string { return String(memoBody()); });
const Observed = observer(ObservedImpl);

export function Page(): string {
  return (
    <main>
      <LazyNamed />
      <DynNamed />
      <LazyBlock />
      <DynAwait />
      <LazyDefault />
      <DynDefault />
      <Thing />
      <Made />
      <Memoed />
      <Observed />
    </main>
  );
}

// A destructured prop SHADOWS the imported Button: none of these render ui/Button.
export function ShorthandTag({ Button }: { Button: Fc<{}> }): string {
  return <Button />;
}
export function RenameTag({ icon: Button }: { icon: Fc<{}> }): string {
  return <Button />;
}
export function ArrowRenameTag(xs: { icon: Fc<{}> }[]): string[] {
  return xs.map(({ icon: Button }) => <Button />);
}
export function PlainParamTag(Button: Fc<{}>): string {
  return <Button />;
}
// …and the same for ordinary calls.
export function ShorthandCall({ Button }: { Button: () => string }): string {
  return Button();
}
export function RenameCall({ run: Button }: { run: () => string }): string {
  return Button();
}

// CONTROL: with nothing shadowing it, the tag is the imported component.
export function UsesButton(): string {
  return <Button label="ok" />;
}
