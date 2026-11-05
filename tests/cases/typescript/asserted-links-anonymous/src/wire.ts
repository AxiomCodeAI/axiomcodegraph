import { Bus } from "./bus";

export function created(x: string): void {}
export function updated(x: string): void {}
export function onCreated(x: string): void { created(x); }
export function onUpdated(x: string): void { updated(x); }

export function wire(bus: Bus): void {
  bus.on((x) => created(x));
  bus.on((x) => updated(x));
  bus.on(onCreated);
  bus.on(onUpdated);
}
