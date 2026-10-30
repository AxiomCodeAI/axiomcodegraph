import { Hono } from 'hono'

export const monitorsApi = new Hono()

export function registerMonitorRoutes(api: typeof monitorsApi) {
  api.get('/monitors', (c) => c.json([]))
}
