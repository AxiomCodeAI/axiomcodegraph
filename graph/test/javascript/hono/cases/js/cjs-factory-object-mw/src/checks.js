// Two middleware in one returned object: each read must take its own property's function.
function makeChecks(realm) {
  const auth = async (c, next) => {
    if (!c.req.header('authorization')) return c.text(realm, 401)
    await next()
  }
  return {
    auth,
    audit: async (c, next) => {
      await next()
      console.log(realm, c.req.path)
    },
  }
}

module.exports = { makeChecks }
