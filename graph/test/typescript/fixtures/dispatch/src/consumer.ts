import type { Handler, Probe } from '@d/handler';
import { UpperHandler, LowerHandler } from '@d/nominal';
import { SilentHandler, Ruler, Caliper } from '@d/structural';
import { LeafNode, TaggedLeaf, Node } from '@d/inherit';

// (1) INTERFACE-TYPED receiver, nominal implementations. The compiler names
//     Handler.handle; the bodies that can run are UpperHandler.handle,
//     LowerHandler.handle, NeverBuiltHandler.handle (CHA) — of which the first two are
//     constructed anywhere (RTA).
export function viaInterface(h: Handler): number {
  return h.handle('x');
}

// (2) EXACTLY-TYPED receiver. `new UpperHandler()` is a UpperHandler and nothing else,
//     so this must NOT fan: one target, or the fan is wrong rather than imprecise.
export function exactReceiver(): number {
  return new UpperHandler().handle('x');
}

// (3) A local whose declared type is the interface but whose value is a known class.
//     Flow beats the declaration: the body that runs is LowerHandler's.
export function monomorphicLocal(): number {
  const h: Handler = new LowerHandler();
  return h.handle('x');
}

// (4) STRUCTURAL conformance — SilentHandler declares no `implements`, and `tsc`
//     accepts it here. A nominal fan reaches nothing.
export function viaStructural(): number {
  const h: Handler = new SilentHandler();
  return h.handle('x');
}

// (5) A parameter typed by an interface NOTHING declares itself an implementation of.
//     Ruler and Caliper both satisfy Probe structurally.
export function viaProbe(p: Probe): number {
  return p.measure();
}

export function buildProbes(): Probe[] {
  return [new Ruler(), new Caliper()];
}

// (6) ABSTRACT base: `this.describe()` inside `label()` dispatches to whichever
//     subclass is running.
export function viaAbstract(n: Node): string {
  return n.label();
}

export function buildNodes(): Node[] {
  return [new LeafNode(), new TaggedLeaf()];
}

// (7) The class-typed receiver of a class that HAS a subclass overriding the member.
export function viaLeaf(l: LeafNode): string {
  return l.describe();
}

// Constructed so RTA can tell the built classes from the merely declared one.
export function build(): Handler[] {
  return [new UpperHandler(), new LowerHandler(), new SilentHandler()];
}
