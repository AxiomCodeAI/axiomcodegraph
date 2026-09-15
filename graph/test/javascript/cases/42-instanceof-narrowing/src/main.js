// An instanceof guard types its subject (#687): the guarded call resolves on a
// value the engine could not otherwise name.
const { Remote } = require('./remote');
class Document { toObject() { return {}; } }
class Query { toObject() { return []; } exec() { return 1; } }

function viaIf(doc) {
  if (doc instanceof Document) { return doc.toObject(); }
  return doc;
}
function viaTernary(doc) { return doc instanceof Document ? doc.toObject() : doc; }
function viaEarlyReturn(q) {
  if (!(q instanceof Query)) { return null; }
  return q.exec();
}
function viaImported(r) {
  if (r instanceof Remote) { return r.ping(); }
  return null;
}
// A member subject is not narrowed: the member keeps its own values.
function viaMember(holder) {
  if (holder.doc instanceof Document) { return holder.doc.toObject(); }
  return null;
}
function viaCallback(items) {
  return [].concat(items).map(function (item) {
    return item instanceof Document ? item.toObject() : item;
  });
}
// A platform class makes the subject the platform's: the guarded call is an ambient terminal.
function viaPlatform(value) {
  if (value instanceof Date) { return value.getTime(); }
  return value;
}
// The control: a subject that already resolves keeps its target and gains the
// tested class beside it only where the two differ.
function viaTyped(q) {
  if (q instanceof Query) { return q.toObject(); }
  return q.exec();
}
function run() { viaTyped(new Query()); viaMember({ doc: undefined }); }
module.exports = { run, viaIf, viaTernary, viaEarlyReturn, viaImported, viaMember, viaCallback, viaPlatform };
