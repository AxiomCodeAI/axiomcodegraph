import { Hono } from 'hono'

const store = new Hono()
store.get('/disk', (c) => c.text('disk-store'))

export default store
