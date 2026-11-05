module.exports.authenticate = async (c, next) => {
  c.set('user', { id: 'u' })
  await next()
}
module.exports.isAdmin = async (c, next) => {
  await next()
}
