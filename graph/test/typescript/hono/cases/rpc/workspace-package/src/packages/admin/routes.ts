import { Hono } from 'hono'

export const admin = new Hono().get('/users', (c) => c.json([]))
