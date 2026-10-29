import { Hono } from 'hono'

export const api = new Hono()
api.get('/status', (c) => c.text('up'))
