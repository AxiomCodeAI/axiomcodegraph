import { Hono } from 'hono'

const books = new Hono()
books.get('/', (c) => c.json([]))

export default books
