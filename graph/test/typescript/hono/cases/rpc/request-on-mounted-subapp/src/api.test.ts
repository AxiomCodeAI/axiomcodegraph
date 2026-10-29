import { hc } from 'hono/client'
import worker, { todos } from './api'

export async function postsViaRequest() {
  return worker.request('/posts', {}, {})
}

export async function todosViaClient() {
  return hc<typeof todos>('/api').todos.$get()
}
