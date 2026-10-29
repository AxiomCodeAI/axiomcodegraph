import { Hono } from 'hono'

export function buildStockRoutes(label) {
  const stock = new Hono()
  stock.get('/', (c) => c.text(label()))
  stock.delete('/:sku', (c) => c.text('removed'))
  return stock
}
