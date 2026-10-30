import { Hono } from 'hono'
import { orderModule, invoiceModule } from './modules'

function attach(host: Hono, mod: { http: Hono; name: string }) {
  const { http } = mod
  host.route('/', http)
  return host
}

const orders = attach(new Hono(), orderModule())
const invoices = attach(new Hono(), invoiceModule())

const app = new Hono()
app.route('/orders', orders)
app.route('/invoices', invoices)

export default app
