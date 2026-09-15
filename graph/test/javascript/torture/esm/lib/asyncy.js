import { Circle } from './shapes.js';
export async function make() { return new Circle(1); }
export function later(fn) { return new Promise((resolve) => setTimeout(() => resolve(fn()), 1)); }
export async function loadShapes() { const m = await import('./shapes.js'); return m.Shape.create('dyn'); }
export async function pipeline() {
  const c = await make();
  const d = await make().then((x) => x.describe());
  const [e] = await Promise.all([make()]);
  return c.area() + d + e.area() + await later(() => c.describe()) + (await loadShapes()).describe();
}
export const ready = await make();
