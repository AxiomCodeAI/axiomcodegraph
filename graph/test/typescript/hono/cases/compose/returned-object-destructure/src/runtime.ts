import { buildStockRoutes } from './routes/stock'
import { buildOrderRoutes } from './routes/orders'
import { buildAuditRoutes } from './routes/audit'

// The factory hands back several sub-apps in one object literal: shorthand properties, one written-out
// property, and a non-app property. Each read below must take only its own property's value.
export function createRuntime(region: string) {
  const stockRoutes = buildStockRoutes(() => region)
  const orderRoutes = buildOrderRoutes(() => region)
  return { region, stockRoutes, orderRoutes, auditRoutes: buildAuditRoutes() }
}
