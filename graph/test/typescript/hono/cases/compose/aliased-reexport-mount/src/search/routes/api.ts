import { Hono } from 'hono'

const searchApi = new Hono()
searchApi.post('/', (c) => c.json({ hits: [] }))
searchApi.get('/suggest', (c) => c.json({ terms: [] }))

export default searchApi
