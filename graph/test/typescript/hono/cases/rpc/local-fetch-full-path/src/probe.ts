declare const process: { env: Record<string, string | undefined> }

export async function waitReady(): Promise<boolean> {
  const port = process.env.PORT ?? '3000'
  const res = await fetch(`http://localhost:${port}/ready`)
  return res.ok
}

export async function apiVersion(): Promise<unknown> {
  const res = await fetch('http://127.0.0.1:3000/api/version')
  return res.json()
}

export async function notServedHere(): Promise<boolean> {
  const res = await fetch('http://localhost:3000/version')
  return res.ok
}
