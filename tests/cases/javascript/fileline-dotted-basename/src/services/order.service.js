const { findUser } = require('./userService');
function placeOrder(userId, item) {
  const user = findUser(userId);
  return { user, item };
}
module.exports = { placeOrder };
