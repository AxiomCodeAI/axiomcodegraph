// exports.x = function / arrow: CommonJS controller shape
exports.getUser = function (req, res) {
  return lookup(req.id);
};
exports.postUser = (req, res) => {
  return lookup(req.body.id);
};
module.exports.slugify = function (s) {
  return s.toLowerCase();
};

function lookup(id) {
  return id;
}

// an object literal key bound to an arrow or a function expression
const Articles = {
  all: page => request('/articles', page),
  get: function (slug) {
    return request('/articles/' + slug);
  },
  // CONTROL: method shorthand already keeps its name
  del(slug) {
    return request('/articles/' + slug, 'DELETE');
  },
};

// obj.x = function
const helpers = {};
helpers.titleCase = function (s) {
  return s.toUpperCase();
};

// CONTROL: a named function expression keeps its OWN name, not the key's
exports.alias = function realName(s) {
  return s;
};

// CONTROL: an arrow passed as an argument has no name to take
[1, 2].map(n => lookup(n));

function request(url, arg) {
  return url + arg;
}

module.exports.Articles = Articles;
