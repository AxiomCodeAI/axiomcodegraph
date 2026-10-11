import * as views from './views';

export function handle(name: string, req: unknown) {
  const handler = (views as any)[name];
  return handler(req).render();
}

export function handleLocal(name: string, req: unknown) {
  const handler = (views as any)[name];
  const resp = handler(req);
  const text = resp.render();
  resp.close();
  return text;
}

export function handleOptional(name: string, req: unknown) {
  const handler = (views as any)[name];
  return handler(req)?.render();
}

export function handleBuilder(name: string, req: unknown) {
  const handler = (views as any)[name];
  return handler(req).step().done().render();
}

export function handleUntyped(name: string, req: unknown) {
  const handler = (views as any)[name];
  const out = handler(req);
  return out.render();
}

export async function handleAsync(name: string, req: unknown) {
  const handler = (views as any)[name];
  const resp = await handler(req);
  return resp.render();
}

export function handleMany(name: string, req: unknown) {
  const handler = (views as any)[name];
  for (const r of handler(req)) {
    r.render();
  }
}
