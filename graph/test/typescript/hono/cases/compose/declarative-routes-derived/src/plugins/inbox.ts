import { Hono } from 'hono'
import type { MountablePlugin } from '../mount'

const inboxApi = new Hono().get('/', (c) => c.json([]))

export const inboxPlugin: MountablePlugin = {
  name: 'inbox',
  routes: [{ path: '/api/inbox', handler: inboxApi }],
  menu: [{ path: '/admin/inbox', label: 'Inbox' }],
}
