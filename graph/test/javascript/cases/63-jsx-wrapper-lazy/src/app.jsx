import React, { memo, lazy } from "react";
import { observer } from "mobx-react";
import { makeThing } from "thing-kit";
import DefMemo from "./defmemo";
import { MemoFwd, PlainInner, ObservedInner, Plain } from "./parts";
import { Forwarded } from "./reexport";

// A tag bound to a wrapper renders the wrapper's argument.
const Card = memo(PlainInner);
const Observed = observer(ObservedInner);
const Dotted = React.memo(function DottedInner() { return <u />; });
// A tag bound to a loader renders what the loader settles to.
const LazyBlock = lazy(() => import("./heavy").then((m) => { return { default: m.ObjNamed }; }));
const LazyConcise = lazy(() => import("./heavy").then((m) => ({ default: m.ObjNamed })));
const LazyDefault = lazy(() => import("./heavy"));

// CONTROL: an unstaged factory that is not a wrapper — argument 0 is not what renders.
export function thingBody() { return 1; }
const Thing = makeThing(() => thingBody());

export function App() {
  return (
    <>
      <Card />
      <DefMemo />
      <MemoFwd />
      <Forwarded />
      <Observed />
      <Dotted />
      <LazyBlock />
      <LazyConcise />
      <LazyDefault />
      <Thing />
    </>
  );
}

// CONTROL: a plain tag and a plain call keep resolving; a wrapper value called as a
// function is not claimed.
export function Controls() {
  PlainInner();
  Card();
  return <Plain />;
}
