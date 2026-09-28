const { placeOrder } = require('../services/order.service');

async function createOrder(req, res) {
  res.json(await placeOrder(req.params.id));
}

module.exports = { createOrder };
