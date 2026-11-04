import type { Context } from 'hono'

export const getTicket = async (c: Context) => c.json({ id: String(c.req.param('id')), title: 't' }, 200)
export const createTicket = async (c: Context) => c.json({ id: '2', title: 'new' }, 201)
