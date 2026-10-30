import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

export const profileRoutes = new Hono().post(
  '/:id/rename',
  zValidator('param', z.object({ id: z.string() })),
  zValidator('json', z.object({ name: z.string() })),
  (c) => c.json({ ok: true }),
)
