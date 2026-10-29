import { Hono } from 'hono'

const store = new Hono()
store.get('/legacy', (c) => c.text('legacy'))

export default store
