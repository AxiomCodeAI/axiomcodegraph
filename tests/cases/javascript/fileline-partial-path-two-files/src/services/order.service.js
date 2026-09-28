const { findUser } = require('./userService');
async function placeOrder(userId) {
  const user = findUser(userId);
  return { user };
}
module.exports = { placeOrder };
