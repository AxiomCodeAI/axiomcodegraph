import { Hono } from 'hono'

// not matched by the glob (*.index.ts): an app nothing mounts stays what it is (a root)
const scratch = new Hono()
scratch.get('/scratch', (c) => c.text('scratch'))

export default scratch
