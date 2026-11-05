// census: verb_literal_path, export_default_app
// Handlers declared elsewhere (function declaration, const arrow, default export) are the route handlers.
import { Hono } from 'hono'
import deleteProject, { listProjects, getProject } from './handlers'

const app = new Hono()

app.get('/projects', listProjects)
app.get('/projects/:id', getProject)
app.delete('/projects/:id', deleteProject)

export default app
