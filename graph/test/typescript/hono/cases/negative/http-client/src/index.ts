// census: neg_verb_literal_nonhono (SPEC N2): the one real app beside it
import { Hono } from 'hono'

const app = new Hono()
app.get('/only', (c) => c.text('the only route'))

export default app
