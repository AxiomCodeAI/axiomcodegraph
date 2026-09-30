import { TOPICS, LIMITS, QUEUES, HANDLERS, helpers } from './topics.js';

export function create(bus) {
  bus.publish(TOPICS.CREATED, {});
}

export function remove(bus) {
  bus.publish(TOPICS.DELETED, {});
}

export function enqueue(q) {
  q.send(QUEUES.CREATED);
}

export function pageSize() {
  return LIMITS.page + LIMITS.nested.depth;
}

export function loud(s) {
  return helpers.shout(s);
}

export function local() {
  const counts = { page: 1 };
  return counts.page;
}

export function dispatch(job) {
  return HANDLERS.run(job);
}

export function closeLater(open) {
  const api = open();
  return () => api.close();
}

export function mirror(settings) {
  return settings.page;
}
