export async function open(host) {
  return fetch(`${host}/api/sessions`, { method: 'POST' })
}

export async function read(base, id) {
  return fetch(new URL(`/api/sessions/${id}`, base))
}

export async function viaService() {
  return fetch('http://sessions:8080/api/sessions/1')
}

export async function upstream() {
  return fetch('https://example.org/api/sessions')
}
