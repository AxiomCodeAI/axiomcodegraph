// census: strict_false, new_hono_options
// `strict: false` changes matching, not the registered path: the route table keeps what is written.
import { Hono } from 'hono'

const app = new Hono({ strict: false })

app.get('/about/', (c) => c.text('about'))
app.get('/contact', (c) => c.text('contact'))

export default app
