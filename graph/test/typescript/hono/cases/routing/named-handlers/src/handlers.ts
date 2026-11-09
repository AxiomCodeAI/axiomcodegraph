import type { Context } from 'hono'

export function listProjects(c: Context) {
  return c.json([])
}

export const getProject = (c: Context) => c.json({ id: c.req.param('id') })

export default async function deleteProject(c: Context) {
  return c.body(null, 204)
}
