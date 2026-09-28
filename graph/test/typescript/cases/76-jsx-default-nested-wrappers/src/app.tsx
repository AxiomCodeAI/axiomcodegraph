import { lazy, memo, pickOther, MemoFwd, NestedPickedInner } from "./parts";
import DefMemo from "./defmemo";
import DefPicked from "./defpicked";

// The usual way to lazy-load a named export: a concise arrow returning `{ default }`.
const LazyNamedObj = lazy(() => import("./objparts").then((m) => ({ default: m.ObjNamed })));
// CONTROL: the loader returning the module still renders its default export.
const LazyDefault = lazy(() => import("./objparts"));
// CONTROL: a non-wrapper between two wrappers stops the unwrapping.
const MemoPicked = memo(pickOther(NestedPickedInner));

export function App(): string {
  return (
    <main>
      <DefMemo />
      <MemoFwd />
      <LazyNamedObj />
      <LazyDefault />
      <DefPicked />
      <MemoPicked />
    </main>
  );
}

// A concise arrow body is what the arrow returns, for an ordinary function too.
export const makeName = (n: number) => String(n).padStart(3);
export function useName(): number {
  return makeName(4).length;
}
