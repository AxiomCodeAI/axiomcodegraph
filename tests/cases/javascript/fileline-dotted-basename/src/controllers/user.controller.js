const { placeOrder } = require('../services/order.service');

function createOrder(req, res) {
  res.json(placeOrder(req.params.id, req.body));
}

module.exports = { createOrder };
