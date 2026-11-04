const { buildStockRoutes } = require('./routes/stock')
const { buildOrderRoutes } = require('./routes/orders')

// One object literal of sub-apps, shorthand and written-out properties: each read takes only its own property.
function createRuntime(region) {
  const stockRoutes = buildStockRoutes(() => region)
  return { region, stockRoutes, orderRoutes: buildOrderRoutes(() => region) }
}

module.exports = { createRuntime }
