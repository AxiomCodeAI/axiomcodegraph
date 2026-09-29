'use strict';

function deleteItem(request, reply) { reply.code(204).send(); }
function readItem(key) { return key; }

module.exports = async function items(fastify) {
  fastify.route({ method: 'DELETE', url: '/items/:id', handler: deleteItem });
  const v = readItem(fastify.cache.get({ key: '/items' }));
  return v;
};
