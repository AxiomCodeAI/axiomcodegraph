const { Hono } = require('hono')

function buildStockRoutes(label) {
  const stock = new Hono()
  stock.get('/', (c) => c.text(label()))
  stock.delete('/:sku', (c) => c.text('removed'))
  return stock
}

module.exports = { buildStockRoutes }
