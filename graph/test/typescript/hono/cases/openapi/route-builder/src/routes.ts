import { z } from '@hono/zod-openapi'
import { defineEndpoint, versioned } from './builder'

const v1 = versioned('v1')

export const getItem = defineEndpoint({
  method: 'get',
  path: '/items/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'one item' } },
}).handler(async (c) => c.json({ id: c.req.valid('param').id }, 200))

export const listItems = v1.define({
  method: 'get',
  path: '/v1/items',
  responses: { 200: { description: 'every item' } },
}).handler(async (c) => c.json([], 200))

// built but never registered: no route
export const draft = defineEndpoint({
  method: 'post',
  path: '/drafts',
  responses: { 201: { description: 'made' } },
}).handler(async (c) => c.json({}, 201))
