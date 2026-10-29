// census: new_hono, verb_literal_path (an .mts module)
import { Hono } from 'hono'

export const app = new Hono()

app.get('/mts', (c) => c.text('from an mts module'))
app.post('/mts', (c) => c.text('posted'))
