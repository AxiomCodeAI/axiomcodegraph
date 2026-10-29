import { createRoute } from '@hono/zod-openapi'

export const login = createRoute({ path: `${'/auth'}/login`, method: 'post', responses: { 200: { description: 'ok' } } })
