export async function listUsers(base: string) {
  return fetch(`${base}/api/users`)
}

export async function probe(base: string) {
  return fetch(`${base}/__test/probe`)
}

export async function landing(base: string) {
  return fetch(`${base}/pricing/enterprise`)
}

export async function loadFont() {
  return fetch(new URL('./fonts/inter.woff2', import.meta.url))
}

export async function byKey(base: string, key: string) {
  return fetch(`${base}/${key}`)
}
