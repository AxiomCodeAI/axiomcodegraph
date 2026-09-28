import { memo, forwardRef } from "react";

export function PlainInner() { return <i />; }
export function DefaultMemoInner() { return <p />; }
export function ObservedInner() { return <em />; }
export const MemoFwd = memo(forwardRef(function MemoFwdInner(p, ref) { return <div />; }));
export function Plain() { return <b />; }
