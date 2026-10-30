import { Hono } from 'hono'
import { definePlugin } from '../sdk'

function buildMediaApi() {
  const api = new Hono()
  api.get('/', (c) => c.json([]))
  api.delete('/:id', (c) => c.body(null, 204))
  return api
}

export const mediaPlugin = definePlugin({
  id: 'media',
  register(app) {
    app.route('/api/media', buildMediaApi())
  },
  menu: [{ label: 'Media', path: '/admin/media' }],
})
