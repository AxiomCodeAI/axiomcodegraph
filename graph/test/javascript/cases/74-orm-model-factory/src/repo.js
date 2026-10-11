'use strict';
const { registerModels } = require('./models');

class DocRepository {
  constructor(models) { this.Doc = models.Doc; this.Job = models.Job; this.Other = models.Other; }
  list() { return this.Doc.findLive(); }
  take() { return this.Doc.claim(); }
  purge() { return this.Doc.purge(); }
  due() { return this.Job.due(); }
  record() { return new this.Doc({}).touch(); }
  save() { return this.Doc.create({}); }         // the package's own member: stays unknown
  other() { return this.Other.findLive(); }      // control: the unmodelled package
}

// Control: an unrelated repository with same-named methods, reached by nothing above.
class MemoryRepository {
  findLive() { return []; }
  claim() { return null; }
}

// Control: a project `.model(name, x)` whose second argument is not a schema keeps
// its own return value.
const registry = { model(name, def) { return def; } };
const plain = registry.model('x', { findLive() { return 3; } });

function start(connection) {
  const repo = new DocRepository(registerModels(connection));
  return [repo.list(), repo.take(), repo.purge(), repo.due(), repo.record(), repo.save(), repo.other(),
    plain.findLive(), new MemoryRepository()];
}
module.exports = { start };
