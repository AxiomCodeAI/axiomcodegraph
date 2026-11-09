import { Hono } from 'hono'
import { posts } from './posts'

export const api = new Hono().basePath('/api')

api.route('/posts', posts)
