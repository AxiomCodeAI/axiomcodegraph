import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { Ledger, Role } from './model'
import { describeRoles, topRank, latestName, staticProviders, byName, makePairs, makeIndex } from './report'

const app = new Hono()
const ledger = new Ledger()

app.get('/roles', (c) => c.json(describeRoles(ledger)))
app.get('/rank', (c) => c.json({ top: topRank(ledger) }))
app.get('/latest', async (c) => c.json(await latestName(ledger)))
app.get('/providers', (c) => c.json(staticProviders(makePairs())))
app.get('/names', (c) => c.json(byName(makeIndex())))

// a validator hook: the value is typed by the library's generic
app.post(
  '/roles',
  validator('json', (value) => new Role(String(value))),
  (c) => {
    const role = c.req.valid('json')
    return c.json(role.toJSON())
  },
)

export default app
