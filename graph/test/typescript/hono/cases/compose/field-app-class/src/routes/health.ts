import { Hono } from 'hono'

export const health = new Hono().get('/', (c) => c.text('ok'))
