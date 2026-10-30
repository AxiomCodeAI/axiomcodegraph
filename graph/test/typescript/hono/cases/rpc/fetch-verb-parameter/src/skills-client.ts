// the verb travels in an options object the helper is handed (and never inspects)
export async function skillRequest(baseUrl: string, path: string, options?: RequestInit) {
  return fetch(`${baseUrl}/api/skills${path}`, options)
}

// the verb is a parameter written into the init
export async function call(method: string, id: string) {
  return fetch(`http://localhost:8787/api/skills/${id}`, { method, headers: { accept: 'application/json' } })
}

// control: a literal verb joins only its own route
export async function remove(id: string) {
  return fetch(`http://localhost:8787/api/skills/${id}`, { method: 'DELETE' })
}
