import { Hono } from 'hono'

const store = new Hono()
store.get('/memory', (c) => c.text('memory'))

export default store
