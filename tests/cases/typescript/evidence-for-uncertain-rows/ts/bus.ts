import { ORDER_PLACED } from './callers';

type Handler = (id: string) => void;

export class Bus {
  private readonly handlers: Record<string, Handler> = {};
  on(topic: string, handler: Handler): void {
    this.handlers[topic] = handler;
  }
  emit(topic: string, id: string): void {
    this.handlers[topic](id);
  }
}

export function onPlaced(id: string): void {
  console.log(id);
}

export function wire(bus: Bus): void {
  bus.on(ORDER_PLACED, onPlaced);
}
