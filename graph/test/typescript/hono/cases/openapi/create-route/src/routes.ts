import { createRoute, z } from '@hono/zod-openapi'

export const Task = z.object({ id: z.string(), done: z.boolean() }).openapi('Task')

export const listTasks = createRoute({
  method: 'get',
  path: '/tasks',
  responses: { 200: { description: 'tasks', content: { 'application/json': { schema: z.array(Task) } } } },
})

export const getTask = createRoute({
  method: 'get',
  path: '/tasks/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'task', content: { 'application/json': { schema: Task } } } },
})
