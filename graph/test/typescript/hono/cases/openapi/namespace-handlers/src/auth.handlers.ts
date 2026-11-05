import type { Context } from 'hono'

export const login = async (c: Context) => c.json({ ok: true }, 200)
