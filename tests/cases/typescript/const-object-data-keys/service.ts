import { TOPICS, QUEUES, LIMITS, HANDLERS, helpers } from './topics';

interface Bus { publish(topic: string, body: object): void; }

export function create(bus: Bus) {
  bus.publish(TOPICS.CREATED, {});
}

export function enqueue(bus: Bus) {
  bus.publish(QUEUES.CREATED, {});
}

export function nestedDepth(): number {
  return LIMITS.nested.depth;
}

export function dispatch(id: string) {
  return HANDLERS.run(id);
}

export function loud(s: string) {
  return helpers.shout(s);
}

export function local() {
  const counts = { page: 1 };
  return counts.page;
}
