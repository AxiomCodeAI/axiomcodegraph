// census: verb_const_path, verb_template_path
// A path built from consts (local, imported, a const-object member, a template over consts) is decidable.
import { Hono } from 'hono'
import { USERS, PATHS } from './paths'

const ID = ':id'
const app = new Hono()

app.get(USERS, (c) => c.text('users'))
app.get(`${USERS}/${ID}`, (c) => c.text('one user'))
app.get(PATHS.health, (c) => c.text('ok'))
app.get('/api' + PATHS.version, (c) => c.text('1'))

export default app
