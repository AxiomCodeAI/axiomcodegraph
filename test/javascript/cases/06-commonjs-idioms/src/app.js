'use strict';
var common = require('./lib/common');
var Router = require('./lib/router');
var Layer = require('./lib/router').Layer;
var methods = ['get', 'post'];
var app = exports = module.exports = {};
app.init = function init() { this.defaultConfiguration(); };
app.defaultConfiguration = function () { return common.clone(this); };
app.lazyrouter = function () {
  if (!this._router) { this._router = new Router({ strict: true }); this._router.use(function () {}); }
};
methods.forEach(function (method) {
  app[method] = function (path) { this.lazyrouter(); return this; };
});
var l = new Layer('/');
l.match('/');
common.both();
Router.dispatch({});
var r = Router({});
r.options;
var Selector = { apply(node) { return node; }, call(x) { return x; } };
Selector.apply(1);
Selector.call(2);
function plain(a) { return a; }
plain.call(null, 1);
plain.apply(null, [1]);
