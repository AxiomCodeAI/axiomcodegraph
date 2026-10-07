import { handlers } from './handlers.js';

export async function consume(table, msg) {
  const handler = table[msg.type];
  if (handler) return handler(msg);
}

export function start() {
  return (msg) => consume(handlers, msg);
}
