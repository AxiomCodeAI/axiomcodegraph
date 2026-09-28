const api = require('./api');

function run(req, res) {
  api.getUser(req, res);
  api.postUser(req, res);
  api.slugify('A B');
  api.Articles.all(1);
  api.Articles.get('x');
  api.Articles.del('x');
}

module.exports = { run };
