import { Hono } from 'hono'

const orders = new Hono()
orders.post('/orders', (c) => c.json({ ok: true }, 201))

export default orders
