import { Hono } from 'hono'

export function makeApp(opts?: { base?: string }) {
  const r = new Hono()
  if (opts?.base) {
    r.basePath(opts.base)
  }
  return r
}
