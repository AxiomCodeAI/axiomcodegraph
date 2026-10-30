import { Hono } from 'hono'
import { definePlugin } from '../sdk'

const apiRoutes = new Hono()
apiRoutes.get('/:key', (c) => c.json({ key: c.req.param('key') }))

const adminRoutes = new Hono()
adminRoutes.post('/', (c) => c.text('saved', 201))

export const variablesPlugin = definePlugin({
  id: 'variables',
  register: (app) => {
    app.route('/api/variables', apiRoutes)
    app.route('/admin/variables', adminRoutes)
  },
})

export { apiRoutes as variablesApiRoutes }
