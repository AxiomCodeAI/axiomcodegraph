// census: request_fetch (stress-5 mutation m37 shape; violation hono-5-08, SPEC R14a)
// A literal single-label host (a service name inside the deployment) may reach this program's routes: joined with
// confidence base_unknown. A dotted external host never joins; an unknown base joins as base_unknown.
import { Hono } from 'hono'

const app = new Hono()
app.get('/api/invoices', (c) => c.json([]))
app.get('/api/health', (c) => c.text('ok'))
export default app

export async function listInvoices() {
  return fetch('http://billing:9000/api/invoices')
}
export async function external() {
  return fetch('https://api.example.com/api/health')
}
export async function viaBase(base: string) {
  return fetch(`${base}/api/health`)
}
