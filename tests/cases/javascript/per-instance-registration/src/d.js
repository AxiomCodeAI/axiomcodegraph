import { Bus, Registry } from './bus.js';
import { handleA } from './a.js';

// control: a bus whose allocation the graph does not know (a documented parameter) keeps every registration.
/** @param {Bus} bus */
export const runD = (bus) => bus.emit(3);

// control: the same allocation reached through a field of another object.
export class Svc {
  constructor() { this.bus = new Bus(); this.bus.on(handleA); }
  run() { this.bus.emit(4); }
}

// control: an allocation passed on as an argument is still that allocation.
const shared = new Bus();
shared.on(handleA);
function relay(bus) { bus.emit(5); }
export const runE = () => relay(shared);

const r1 = new Registry();
const r2 = new Registry();
export const runR1 = () => r1.run(1);
export const runR2 = () => r2.run(2);
