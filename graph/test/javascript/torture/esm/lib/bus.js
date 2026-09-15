import { EventEmitter } from 'node:events';
export class Bus extends EventEmitter {
  constructor() { super(); this.on('tick', (v) => this.onTick(v)); }
  onTick(v) { return v + 1; }
  start() { this.emit('tick', 1); this.emit('done'); return this; }
}
export const onDone = () => 'done';
