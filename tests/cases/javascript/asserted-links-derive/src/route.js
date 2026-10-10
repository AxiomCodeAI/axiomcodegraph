import * as views from './views';

export function handle(name, req) {
  const handler = views['make' + name];
  return handler(req).render();
}

export function handleLocal(name, req) {
  const handler = views['make' + name];
  const resp = handler(req);
  const text = resp.render();
  resp.close();
  return text;
}

export function handleOptional(name, req) {
  const handler = views['make' + name];
  return handler(req)?.render();
}

export function handleBuilder(name, req) {
  const handler = views['make' + name];
  return handler(req).step().done().render();
}

export function handleUntyped(name, req) {
  const handler = views['un' + name];
  const out = handler(req);
  return out.render();
}

export async function handleAsync(name, req) {
  const handler = views['fetch' + name];
  const resp = await handler(req);
  return resp.render();
}
