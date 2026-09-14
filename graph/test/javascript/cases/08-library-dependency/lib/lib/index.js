'use strict';
class Client { get(url) { return this.request('GET', url); } request(m, u) { return m + u; } }
function create(opts) { return new Client(opts); }
module.exports = create;
module.exports.Client = Client;
module.exports.helper = function helper() { return 1; };
