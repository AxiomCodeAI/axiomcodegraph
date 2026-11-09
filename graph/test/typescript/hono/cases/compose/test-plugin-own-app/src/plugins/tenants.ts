import { Hono } from 'hono'
import { definePlugin } from '../sdk'

function tenantRoutes() {
  const r = new Hono()
  r.get('/', (c) => c.text('tenants'))
  return r
}

export const tenantsPlugin = definePlugin({
  id: 'tenants',
  register(app) {
    app.route('/admin/tenants', tenantRoutes())
  },
})
