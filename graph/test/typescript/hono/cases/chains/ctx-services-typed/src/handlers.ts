import type { Context } from 'hono'
import type { Env, IEnv } from './env'

// Context<Env> parameter, destructured c.get
export async function verifyKey(c: Context<Env>) {
  const { keys } = c.get('services')
  return c.json({ ok: keys.verify(c.req.param('key') ?? '') })
}

// Context<IEnv> (an interface Env), `const x = c.var.k`
export async function showUser(c: Context<IEnv>) {
  const users = c.var.users
  return c.json(users.find(c.req.param('id') ?? ''))
}
