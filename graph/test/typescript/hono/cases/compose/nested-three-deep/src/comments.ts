import { Hono } from 'hono'

export const comments = new Hono()

comments.get('/', (c) => c.json([]))
comments.delete('/:commentId', (c) => c.body(null, 204))
