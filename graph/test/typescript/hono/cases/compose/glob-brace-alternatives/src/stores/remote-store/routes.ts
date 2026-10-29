import { Hono } from 'hono'

const store = new Hono()
store.get('/remote', (c) => c.text('remote-store'))

export default store
