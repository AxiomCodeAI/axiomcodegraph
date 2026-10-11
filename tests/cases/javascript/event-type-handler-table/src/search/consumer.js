export async function consume(handlers, msg) {
  const handler = handlers[msg.headers.type];
  if (handler) await handler(msg);
}
