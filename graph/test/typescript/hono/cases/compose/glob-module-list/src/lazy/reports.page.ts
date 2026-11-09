import { Hono } from 'hono'

const reports = new Hono()
reports.get('/daily', (c) => c.json([]))

export default reports
