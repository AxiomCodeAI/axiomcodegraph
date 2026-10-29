import { Hono } from 'hono'
import { comments } from './comments'

export const posts = new Hono()

posts.get('/:postId', (c) => c.json({}))
posts.route('/:postId/comments', comments)
