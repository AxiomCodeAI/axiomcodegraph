// census: neg_other_router_import (SPEC N3)
// Another router in the same project: none of its registrations is a Hono route or middleware.
import { Hono } from 'hono'
import { Router } from './minirouter'

const legacy = new Router()
legacy.use((req, res) => {})
legacy.get('/legacy/users', (req, res) => {})
legacy.post('/legacy/users', (req, res) => {})
const outer = new Router()
outer.route('/v0', legacy)

const app = new Hono()
app.get('/hono', (c) => c.text('hono'))

export default app
