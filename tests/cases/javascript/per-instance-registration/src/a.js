import { Bus } from './bus.js';
export function check(e) { return e; }
export function handleA(e) { return e; }
const b = new Bus({ validate: check });
b.on(handleA);
export const runA = () => b.emit(1);
