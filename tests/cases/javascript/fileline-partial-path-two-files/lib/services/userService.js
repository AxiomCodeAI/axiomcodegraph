function findUser(id) {
  const key = String(id);
  const row = { id: key };
  return row;
}
module.exports = { findUser };
