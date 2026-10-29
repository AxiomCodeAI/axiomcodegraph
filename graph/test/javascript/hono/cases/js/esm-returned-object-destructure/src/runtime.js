import { buildStockRoutes } from './routes/stock.js'
import { buildOrderRoutes } from './routes/orders.js'

// One object literal of sub-apps, shorthand and written-out properties: each read takes only its own property.
export function createRuntime(region) {
  const stockRoutes = buildStockRoutes(() => region)
  return { region, stockRoutes, orderRoutes: buildOrderRoutes(() => region) }
}
