'use strict';
const { promisify } = require('util');

class Repo {
  append(x) { return x; }
  find(k) { return k; }
}
class Other {
  append(x) { return x; }
}

// (a) a field or variable assigned from x.m.bind(x) is x.m
class Service {
  constructor(r) {
    this.repo = r;
    this.add = this.repo.append.bind(this.repo);
    this.lookup = promisify(r.find.bind(r));
  }
  go() { return this.add(1); }
  get(k) { return this.lookup(k); }
}
function makeService() { return new Service(new Repo()); }
const repo = new Repo();
const bound = repo.append.bind(repo);
function viaVariable() { return bound(2); }
const wrapped = promisify(repo.find.bind(repo));
function viaPromisified() { return wrapped('k'); }
const util = require('util');
const viaNamespace = util.promisify(repo.find.bind(repo));
function viaNamespaceCall() { return viaNamespace('n'); }

// (b) a function bound to an object literal sees its keys through `this`
function onEvent(e) { return this.repo.append(e); }
const handler = onEvent.bind({ repo: new Repo() });
function fire() { return handler(1); }
const handlers = {
  created: function onCreated(e) { return this.store.append(e); },
};
const onCreatedBound = handlers.created.bind({ store: new Other() });

// controls: none of these changes
function unbound(e) { return this.repo.append(e); }
function callsUnbound() { return unbound.call({ repo: new Repo() }, 1); }
const snapshot = repo.find.bind(null);
function openBind(fn) { const g = fn.bind(repo); return g(); }
const own = { promisify(f) { return () => f; } };
const notUtil = own.promisify(repo.find);
function viaOwnPromisify() { return notUtil(); }

module.exports = { makeService, viaVariable, viaPromisified, fire, onCreatedBound, callsUnbound, snapshot, openBind, viaNamespaceCall, viaOwnPromisify };
