// census: neg_verb_literal_nonhono (SPEC N2)
// An HTTP client spelled like a router: verbs with literal paths and callbacks. Not a Hono app.
type Cb = (body: unknown) => void

export const api = {
  get(url: string, cb?: Cb) { cb?.(url) },
  post(url: string, body: unknown, cb?: Cb) { cb?.(body) },
}

export function loadUsers() {
  api.get('/users', (body) => { console.log(body) })
  api.post('/users', { name: 'x' }, (res) => { console.log(res) })
}
