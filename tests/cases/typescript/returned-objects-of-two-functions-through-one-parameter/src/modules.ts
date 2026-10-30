import { orderRoutes } from './routes/orders'
import { invoiceRoutes } from './routes/invoices'

export function orderModule() {
  return { http: orderRoutes(), name: 'orders' }
}
export function invoiceModule() {
  return { http: invoiceRoutes(), name: 'invoices' }
}
