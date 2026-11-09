import { Hono } from 'hono'

const status = new Hono()
status.get('/status', (c) => c.text('up'))

export default status
