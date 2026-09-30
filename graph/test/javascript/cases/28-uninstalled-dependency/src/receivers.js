'use strict';
// A member call whose receiver is a value of a package no IR declares: what calling it,
// constructing from it, or chaining on it returns is the package's object, so the
// project's own `get` is not what these call (library_receiver in the diagnostics).
const request = require('never-staged');
const wire = require('alpha/missing');
class Repo { get(id) { return id; } }
class Service {
  constructor(repo) { this.repo = repo; }
  load(id) { return this.repo.get(id); }
}
async function probe(app) {
  await request(app).get('/x').expect(200);
  const res = await request(app).get('/y');
  const md = new wire.Metadata();
  md.get('k');
  return res.body;
}
// controls: none of these is a package's value
function untyped(obj) { return obj.get(1); }
function wrapped(repo) { return request.mocked(new Repo()).get(1); }
function reassigned() {
  let c = request.agent();
  c = untyped;
  return c.get(2);
}
module.exports = { Repo, Service, probe, untyped, wrapped, reassigned };
