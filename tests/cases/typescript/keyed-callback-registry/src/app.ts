import { ANY, Bus, MiniBus } from './bus';
import { TOPIC } from './topics';

export const bus = new Bus();

export function onCreated(p: unknown): void {
  console.log('created', p);
}
export function onRemoved(p: unknown): void {
  console.log('removed', p);
}
export function onAnything(p: unknown): void {
  console.log('any', p);
}

export class Indexer {
  constructor(private readonly b: Bus) {}

  start(): void {
    this.b.subscribeAll({
      [TOPIC.created]: (p) => this.indexed(p),
      [TOPIC.removed]: (p) => this.dropped(p),
    });
  }

  indexed(p: unknown): void {
    console.log('indexed', p);
  }
  dropped(p: unknown): void {
    console.log('dropped', p);
  }
}

bus.subscribe(TOPIC.created, onCreated);
bus.subscribe('item.removed', onRemoved);
bus.subscribe(ANY, onAnything);
new Indexer(bus).start();

export function create(): void {
  bus.publish(TOPIC.created, { id: 1 });
}
export function remove(): void {
  bus.publish('item.removed', { id: 1 });
}
// the name is only known at run time: every handler of the registry may run
export function relay(evt: { type: string }): void {
  bus.publish(evt.type, evt);
}
export function size(): number {
  return bus.count(TOPIC.created);
}

const mini = new MiniBus();
export function onA(): void {
  console.log('a');
}
export function onAll(): void {
  console.log('all');
}
export function onB(): void {
  console.log('b');
}
mini.on('a', onA);
mini.on('*', onAll);
mini.on('b', onB);
export function go(): void {
  mini.fire('a', 1);
}
