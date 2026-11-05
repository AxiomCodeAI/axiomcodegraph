// census: route_mount_literal, basepath
// Three levels of route() across modules, named exports, a basePath at the middle level, mounted at /.
import { Hono } from 'hono'
import { api } from './api'

const app = new Hono()

app.route('/', api)

export default app
