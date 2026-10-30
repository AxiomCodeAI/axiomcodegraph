// census: request_fetch (stress-5 mutation m39 shape; violation hono-5-07)
// A segment that mixes literal text and a hole (`/api/skills${path}`) matches routes whose segment starts with that
// text (/api/skills/:id), never a sibling (/api/agents).
import { Hono } from 'hono'

const app = new Hono()
app.get('/api/agents', (c) => c.json([]))
app.get('/api/skills/:id', (c) => c.json({}))
export default app

export async function skillsApi(base: string, path: string) {
  return fetch(`${base}/api/skills${path}`)
}
export async function skillsLocal(path: string) {
  return fetch(`http://localhost:3000/api/skills${path}`)
}
