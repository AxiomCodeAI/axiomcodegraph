declare const process: { env: Record<string, string | undefined> }

export async function register(apiUrl: string) {
  return fetch(`${apiUrl}/api/oauth/register`, { method: 'POST' })
}

export async function project(base: string, id: string) {
  return fetch(new URL(`/api/projects/${id}`, base))
}

export async function health() {
  return fetch((process.env.API_URL ?? 'http://localhost:3003') + '/api/health')
}

export async function upstream() {
  return fetch('https://status.example.com/api/health')
}
