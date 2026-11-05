import { createRoute } from '@hono/zod-openapi'

export const listNotes = createRoute({ method: 'get', path: '/notes', responses: { 200: { description: 'notes' } } })
export const getNote = createRoute({ method: 'get', path: '/notes/{id}', responses: { 200: { description: 'note' } } })
